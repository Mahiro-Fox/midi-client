use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use midir::{MidiOutput, MidiOutputConnection};
use midly::{MetaMessage, MidiMessage, Smf, Timing, TrackEventKind};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// 远程曲库根地址，与原 Python 版本保持一致。
pub const BASE_URL: &str = "https://mahirooyama.cn";
const CLIENT_NAME: &str = "MIDITOOL";
/// 进度事件节流间隔：跨进程 emit 每秒最多 10 次，避免打满 IPC。
const EMIT_INTERVAL: Duration = Duration::from_millis(100);
/// 停止标志轮询粒度，决定「停止」按钮的响应延迟。
const SLEEP_SLICE: Duration = Duration::from_millis(10);
/// 高精度等待的最后一段改为自旋，规避 Windows 默认 15.6ms 定时器精度。
const SPIN_WINDOW: Duration = Duration::from_millis(2);

#[cfg(windows)]
#[link(name = "winmm")]
extern "system" {
    fn timeBeginPeriod(period: u32) -> u32;
    fn timeEndPeriod(period: u32) -> u32;
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub index: usize,
    pub name: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    pub playing: bool,
    pub title: Option<String>,
    pub duration: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub position: f64,
    pub duration: f64,
}

#[derive(Deserialize)]
struct RemotePayload {
    files: Vec<serde_json::Value>,
}

struct TimedEvent {
    /// 相对起点的秒数
    at: f64,
    bytes: Vec<u8>,
}

struct PlayerHandle {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

pub struct Engine {
    handle: Mutex<Option<PlayerHandle>>,
    state: Mutex<PlaybackState>,
    /// 播放代次，用于丢弃已失效线程的回调，避免界面状态回跳。
    generation: Arc<AtomicU64>,
}

impl Default for Engine {
    fn default() -> Self {
        Self {
            handle: Mutex::new(None),
            state: Mutex::new(PlaybackState::default()),
            generation: Arc::new(AtomicU64::new(0)),
        }
    }
}

// ---------------------------------------------------------------- 端口

pub fn list_ports() -> Result<Vec<PortInfo>, String> {
    let out = MidiOutput::new(CLIENT_NAME).map_err(|e| format!("初始化 MIDI 输出失败：{e}"))?;
    let ports = out.ports();
    let mut list = Vec::with_capacity(ports.len());
    for (index, port) in ports.iter().enumerate() {
        let name = out
            .port_name(port)
            .unwrap_or_else(|_| format!("MIDI 端口 {index}"));
        list.push(PortInfo { index, name });
    }
    Ok(list)
}

// ---------------------------------------------------------------- 远程曲库

pub async fn fetch_remote_files() -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败：{e}"))?;
    let resp = client
        .get(format!("{BASE_URL}/api/midi"))
        .send()
        .await
        .map_err(|e| format!("获取曲库列表失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("曲库接口返回错误：{e}"))?;

    let payload: RemotePayload = resp
        .json()
        .await
        .map_err(|e| format!("曲库数据解析失败：{e}"))?;

    // 兼容 ["a.mid"] 与 [{"fileName": "a.mid"}] 两种历史返回格式
    let mut names: Vec<String> = payload
        .files
        .iter()
        .filter_map(|f| match f {
            serde_json::Value::String(s) => Some(s.clone()),
            other => other
                .get("fileName")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        })
        .collect();
    names.sort();
    names.dedup();
    Ok(names)
}

fn remote_url(file_name: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(BASE_URL).map_err(|e| format!("地址解析失败：{e}"))?;
    url.path_segments_mut()
        .map_err(|_| "地址不支持路径拼接".to_string())?
        .extend(["uploads", "midisongs", file_name]);
    Ok(url)
}

pub async fn download_remote(file_name: &str) -> Result<Vec<u8>, String> {
    let url = remote_url(file_name)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败：{e}"))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载 MIDI 文件失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("MIDI 文件不存在或无法访问：{e}"))?;
    let bytes = resp.bytes().await.map_err(|e| format!("读取文件内容失败：{e}"))?;
    if bytes.is_empty() {
        return Err("下载到的 MIDI 文件为空".into());
    }
    Ok(bytes.to_vec())
}

// ---------------------------------------------------------------- 时间轴

/// 把 SMF 事件编码成可直接写入 MIDI 端口的原始字节。
/// 非发声事件（meta）返回 None。
fn encode_event(kind: TrackEventKind) -> Option<Vec<u8>> {
    let mut buf = Vec::with_capacity(8);
    match kind {
        TrackEventKind::Midi { channel, message } => {
            let ch = channel.as_int();
            match message {
                MidiMessage::NoteOff { key, vel } => {
                    buf.extend_from_slice(&[0x80 | ch, key.as_int(), vel.as_int()])
                }
                MidiMessage::NoteOn { key, vel } => {
                    buf.extend_from_slice(&[0x90 | ch, key.as_int(), vel.as_int()])
                }
                MidiMessage::Aftertouch { key, vel } => {
                    buf.extend_from_slice(&[0xA0 | ch, key.as_int(), vel.as_int()])
                }
                MidiMessage::Controller { controller, value } => {
                    buf.extend_from_slice(&[0xB0 | ch, controller.as_int(), value.as_int()])
                }
                MidiMessage::ProgramChange { program } => {
                    buf.extend_from_slice(&[0xC0 | ch, program.as_int()])
                }
                MidiMessage::ChannelAftertouch { vel } => {
                    buf.extend_from_slice(&[0xD0 | ch, vel.as_int()])
                }
                MidiMessage::PitchBend { bend } => {
                    let v = bend.0.as_int();
                    buf.extend_from_slice(&[0xE0 | ch, (v & 0x7F) as u8, ((v >> 7) & 0x7F) as u8]);
                }
            }
        }
        // 文件里的 SysEx 数据段不含首尾标记，发送时必须补回
        TrackEventKind::SysEx(data) => {
            buf.push(0xF0);
            buf.extend_from_slice(data);
            buf.push(0xF7);
        }
        // Escape 事件按原始字节直发
        TrackEventKind::Escape(data) => buf.extend_from_slice(data),
        _ => return None,
    }
    Some(buf)
}

fn fps_to_f64(fps: midly::Fps) -> f64 {
    match fps {
        midly::Fps::Fps24 => 24.0,
        midly::Fps::Fps25 => 25.0,
        midly::Fps::Fps29 => 29.97,
        midly::Fps::Fps30 => 30.0,
    }
}

/// 把 SMF 展开成按绝对时间排序的事件序列，并返回总时长（秒）。
///
/// 这一步替代了 mido 的 `MidiFile.length`：midly 只给 delta tick，
/// 需要自己按 tempo map 把 tick 换算成秒。
fn build_timeline(bytes: &[u8]) -> Result<(Vec<TimedEvent>, f64), String> {
    let smf = Smf::parse(bytes).map_err(|e| format!("MIDI 解析失败：{e}"))?;

    // (绝对 tick, 待发送字节；None 表示仅用于确定结束时间的元事件)
    let mut marks: Vec<(u64, Option<Vec<u8>>)> = Vec::new();
    let mut tempos: Vec<(u64, f64)> = vec![(0, 500_000.0)];

    for track in smf.tracks.iter() {
        let mut tick: u64 = 0;
        for ev in track.iter() {
            tick += u64::from(ev.delta.as_int());
            match ev.kind {
                TrackEventKind::Meta(MetaMessage::Tempo(us)) => {
                    tempos.push((tick, f64::from(u32::from(us))));
                    // 只记录时间点，不发送
                    marks.push((tick, None));
                }
                _ => marks.push((tick, encode_event(ev.kind))),
            }
        }
    }

    if marks.is_empty() {
        return Err("MIDI 文件不含任何事件".into());
    }

    // 多轨需要按绝对 tick 归并；stable sort 保证同 tick 事件维持原始先后
    marks.sort_by_key(|(tick, _)| *tick);

    let mut events: Vec<TimedEvent> = Vec::with_capacity(marks.len());
    let mut cursor = 0usize;
    let mut cur_tick = 0u64;
    let mut cur_sec = 0.0f64;
    let mut cur_tempo = 500_000.0f64; // 微秒 / 四分音符
    let mut duration = 0.0f64;

    match smf.header.timing {
        Timing::Metrical(ppq) => {
            let ppq = f64::from(ppq.as_int().max(1));
            tempos.sort_by_key(|(tick, _)| *tick);
            for (tick, payload) in marks {
                while cursor < tempos.len() && tempos[cursor].0 <= tick {
                    let (tempo_tick, tempo) = tempos[cursor];
                    cur_sec += (tempo_tick - cur_tick) as f64 / ppq * (cur_tempo / 1_000_000.0);
                    cur_tick = tempo_tick;
                    cur_tempo = tempo;
                    cursor += 1;
                }
                let at = cur_sec + (tick - cur_tick) as f64 / ppq * (cur_tempo / 1_000_000.0);
                duration = at;
                if let Some(bytes) = payload {
                    if !bytes.is_empty() {
                        events.push(TimedEvent { at, bytes });
                    }
                }
            }
        }
        Timing::Timecode(fps, subframe) => {
            let subframe = f64::from(u8::from(subframe).max(1));
            let per_tick = 1.0 / (fps_to_f64(fps) * subframe);
            for (tick, payload) in marks {
                let at = tick as f64 * per_tick;
                duration = at;
                if let Some(bytes) = payload {
                    if !bytes.is_empty() {
                        events.push(TimedEvent { at, bytes });
                    }
                }
            }
        }
    }

    Ok((events, duration))
}

// ---------------------------------------------------------------- 播放

/// 所有通道清音：CC123 全音符关、CC121 复位控制器、弯音轮回中。
/// 停止或异常结束时必须调用，否则软音源会留下卡住的音符。
fn reset_channels(conn: &mut MidiOutputConnection) {
    for ch in 0..16u8 {
        let _ = conn.send(&[0xB0 | ch, 123, 0]);
        let _ = conn.send(&[0xB0 | ch, 121, 0]);
        let _ = conn.send(&[0xE0 | ch, 0x00, 0x40]);
    }
}

/// 等待到 `target`，期间按 10ms 切片检查停止标志。
/// 返回 false 表示等待途中被要求停止。
fn wait_until(target: Instant, stop: &AtomicBool) -> bool {
    loop {
        if stop.load(Ordering::Relaxed) {
            return false;
        }
        let now = Instant::now();
        if now >= target {
            return true;
        }
        let remain = target - now;
        if remain > SLEEP_SLICE {
            thread::sleep(SLEEP_SLICE);
        } else if remain > SPIN_WINDOW {
            thread::sleep(remain - SPIN_WINDOW);
        } else {
            std::hint::spin_loop();
        }
    }
}

fn run_playback(
    app: AppHandle,
    events: Vec<TimedEvent>,
    duration: f64,
    port_index: usize,
    stop: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
    my_generation: u64,
) {
    #[cfg(windows)]
    unsafe {
        timeBeginPeriod(1);
    }

    let outcome = (|| -> Result<(), String> {
        let out = MidiOutput::new(CLIENT_NAME).map_err(|e| format!("MIDI 输出初始化失败：{e}"))?;
        let ports = out.ports();
        let port = ports
            .get(port_index)
            .ok_or_else(|| "所选 MIDI 端口已不存在，请刷新后重试".to_string())?;
        let mut conn = out
            .connect(port, "miditool-out")
            .map_err(|e| format!("连接 MIDI 端口失败：{e}"))?;

        reset_channels(&mut conn);

        let start = Instant::now();
        let mut last_emit = start;

        for ev in &events {
            if !wait_until(start + Duration::from_secs_f64(ev.at), &stop) {
                break;
            }
            if let Err(e) = conn.send(&ev.bytes) {
                reset_channels(&mut conn);
                return Err(format!("发送 MIDI 消息失败：{e}"));
            }
            if last_emit.elapsed() >= EMIT_INTERVAL {
                last_emit = Instant::now();
                let _ = app.emit(
                    "playback://progress",
                    ProgressEvent {
                        position: ev.at.min(duration),
                        duration,
                    },
                );
            }
        }

        reset_channels(&mut conn);
        Ok(())
    })();

    #[cfg(windows)]
    unsafe {
        timeEndPeriod(1);
    }

    // 只有仍属于当前代次的线程才允许改写界面状态
    if generation.load(Ordering::SeqCst) == my_generation {
        let _ = app.emit(
            "playback://progress",
            ProgressEvent {
                position: 0.0,
                duration,
            },
        );
        let _ = app.emit(
            "playback://state",
            PlaybackState {
                playing: false,
                title: None,
                duration,
            },
        );
    }

    if let Err(msg) = outcome {
        let _ = app.emit("playback://error", msg);
    }
}

impl Engine {
    pub fn state(&self) -> PlaybackState {
        self.state.lock().unwrap().clone()
    }

    /// 立刻停止并等待线程收尾（保证清音消息已发出）。
    pub fn stop(&self) -> bool {
        let player = self.handle.lock().unwrap().take();
        match player {
            Some(mut player) => {
                player.stop.store(true, Ordering::SeqCst);
                if let Some(join) = player.join.take() {
                    let _ = join.join();
                }
                let mut state = self.state.lock().unwrap();
                state.playing = false;
                true
            }
            None => false,
        }
    }

    pub fn play(
        &self,
        app: AppHandle,
        bytes: Vec<u8>,
        title: String,
        port_index: usize,
    ) -> Result<(), String> {
        // 先解析：语法错误能同步返回给界面，而不是在后台线程里静默失败
        let (events, duration) = build_timeline(&bytes)?;
        if events.is_empty() {
            return Err("该 MIDI 文件没有可播放的音符事件".into());
        }

        self.stop();

        let my_generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let stop = Arc::new(AtomicBool::new(false));

        {
            let mut state = self.state.lock().unwrap();
            state.playing = true;
            state.title = Some(title.clone());
            state.duration = duration;
        }

        let app_thread = app.clone();
        let stop_thread = stop.clone();
        let generation = self.generation.clone();
        let join = thread::Builder::new()
            .name("midi-playback".into())
            .spawn(move || {
                run_playback(
                    app_thread,
                    events,
                    duration,
                    port_index,
                    stop_thread,
                    generation,
                    my_generation,
                );
            })
            .map_err(|e| format!("启动播放线程失败：{e}"))?;

        let _ = app.emit(
            "playback://state",
            PlaybackState {
                playing: true,
                title: Some(title),
                duration,
            },
        );

        *self.handle.lock().unwrap() = Some(PlayerHandle {
            stop,
            join: Some(join),
        });
        Ok(())
    }
}
