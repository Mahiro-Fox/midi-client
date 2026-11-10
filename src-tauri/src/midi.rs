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
/// 星穹音乐厅（Celestia）曲库根地址。
pub const CELESTIA_BASE: &str = "https://celestia.chiooone.com";
const CLIENT_NAME: &str = "midi-client";
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

/// 原曲库列表接口允许的最大每页条数（与 Go 端上限一致）。
const REMOTE_MAX_LIMIT: u32 = 100;

/// 原曲库条目，字段与 Go 端 `MidiFileItem` 对应。
#[derive(Deserialize, Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MidiFileItem {
    /// 去扩展名的文件名
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub name: String,
    pub file_name: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub last_modified: String,
}

/// 原曲库分页结果。字段和星穹音乐厅的 `SongPage` 对齐（`total` + `items`），
/// 前端两个源才能共用同一套分页逻辑。
#[derive(Deserialize, Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MidiPage {
    /// 当前页码（从 1 开始）
    pub page: u32,
    pub limit: u32,
    pub total: u32,
    pub total_pages: u32,
    pub has_more: bool,
    pub items: Vec<MidiFileItem>,
}

#[derive(Deserialize)]
struct RemotePayload {
    #[serde(default)]
    files: Vec<serde_json::Value>,
    /// 老版本部署没有这个字段，需要就地模拟分页
    #[serde(default)]
    pagination: Option<RemotePagination>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemotePagination {
    page: u32,
    limit: u32,
    total: u32,
    #[serde(default)]
    total_pages: u32,
    #[serde(default)]
    has_more: bool,
}

/// 星穹音乐厅的曲目条目，字段名与接口一致。
#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SongSummary {
    pub id: u32,
    pub title: String,
    #[serde(default)]
    pub uploader: String,
    /// 时长（秒）
    #[serde(default)]
    pub sec: u32,
    #[serde(default)]
    pub events: u32,
    #[serde(default)]
    pub notes: u32,
    #[serde(default)]
    pub created: i64,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SongPage {
    pub total: u32,
    pub items: Vec<SongSummary>,
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

/// 去掉 .mid / .midi 后缀（字节长度相减是安全的：扩展名都是 ASCII）。
fn strip_ext(file_name: &str) -> String {
    let lower = file_name.to_lowercase();
    for ext in [".midi", ".mid"] {
        if lower.ends_with(ext) {
            return file_name[..file_name.len() - ext.len()].to_string();
        }
    }
    file_name.to_string()
}

fn json_str(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// 归一单个条目，兼容 `"a.mid"` 与 `{"fileName": "a.mid"}` 两种历史格式。
fn file_item_from_value(value: &serde_json::Value) -> Option<MidiFileItem> {
    if let Some(file_name) = value.as_str() {
        let name = strip_ext(file_name);
        return Some(MidiFileItem {
            slug: name.clone(),
            name,
            file_name: file_name.to_string(),
            ..Default::default()
        });
    }

    let file_name = json_str(value, "fileName")?;
    let name = json_str(value, "name").unwrap_or_else(|| strip_ext(&file_name));
    Some(MidiFileItem {
        slug: json_str(value, "slug").unwrap_or_else(|| name.clone()),
        name,
        file_name,
        size: value.get("size").and_then(serde_json::Value::as_u64).unwrap_or(0),
        last_modified: json_str(value, "lastModified").unwrap_or_default(),
    })
}

/// 老部署一次返回全量数组且没有 `pagination` 字段，这里就地完成过滤与切片，
/// 让前端拿到的结构与新版接口完全一致（搜索匹配去扩展名的文件名，大小写不敏感）。
fn page_from_legacy(items: Vec<MidiFileItem>, search: &str, page: u32, limit: u32) -> MidiPage {
    let needle = search.trim().to_lowercase();
    let files: Vec<MidiFileItem> = if needle.is_empty() {
        items
    } else {
        items
            .into_iter()
            .filter(|item| item.name.to_lowercase().contains(&needle))
            .collect()
    };

    let total = files.len() as u32;
    let total_pages = total.div_ceil(limit).max(1);
    let page = page.clamp(1, total_pages);
    let start = (((page - 1) * limit) as usize).min(files.len());
    let end = start.saturating_add(limit as usize).min(files.len());

    MidiPage {
        page,
        limit,
        total,
        total_pages: if total == 0 { 0 } else { total_pages },
        has_more: page < total_pages,
        items: files[start..end].to_vec(),
    }
}

/// 把接口响应转成分页结构：优先信任服务端分页，缺失时回落到本地切片。
fn page_from_payload(payload: RemotePayload, search: &str, page: u32, limit: u32) -> MidiPage {
    let items: Vec<MidiFileItem> = payload
        .files
        .iter()
        .filter_map(file_item_from_value)
        .collect();

    match payload.pagination {
        Some(p) => MidiPage {
            page: p.page,
            limit: p.limit,
            total: p.total,
            total_pages: p.total_pages,
            has_more: p.has_more,
            items,
        },
        None => page_from_legacy(items, search, page, limit),
    }
}

/// 拉取原曲库分页：`GET /api/midi?search=&page=&limit=`。
/// `page` 从 1 开始，`limit` 上限 100（与 Go 端一致）。
pub async fn fetch_remote_files(search: &str, page: u32, limit: u32) -> Result<MidiPage, String> {
    let limit = limit.clamp(1, REMOTE_MAX_LIMIT);
    let page = page.max(1);
    let page_text = page.to_string();
    let limit_text = limit.to_string();

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败：{e}"))?;
    let resp = client
        .get(format!("{BASE_URL}/api/midi"))
        .query(&[
            ("search", search.trim()),
            ("page", page_text.as_str()),
            ("limit", limit_text.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("获取曲库列表失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("曲库接口返回错误：{e}"))?;

    let payload: RemotePayload = resp
        .json()
        .await
        .map_err(|e| format!("曲库数据解析失败：{e}"))?;

    Ok(page_from_payload(payload, search, page, limit))
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

// ---------------------------------------------------------------- 星穹音乐厅

fn celestia_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // 该站点会拒绝部分默认 UA，带一个常规标识更稳妥
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) midi-client")
        .timeout(timeout)
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败：{e}"))
}

/// 拉取星穹音乐厅曲库分页。`offset` 是条目偏移（接口按条数而非页码计算）。
pub async fn fetch_celestia_songs(
    q: &str,
    sort: &str,
    offset: u32,
    limit: u32,
) -> Result<SongPage, String> {
    // 只允许接口明确支持的排序值，避免把前端输入直接透传给上游
    let sort = match sort {
        "old" | "title" | "long" => sort,
        _ => "new",
    };
    let limit = limit.clamp(1, 100);
    let offset_text = offset.to_string();
    let limit_text = limit.to_string();

    let resp = celestia_client(Duration::from_secs(15))?
        .get(format!("{CELESTIA_BASE}/concert/api/songs"))
        .query(&[
            ("q", q),
            ("sort", sort),
            ("offset", offset_text.as_str()),
            ("limit", limit_text.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("获取星穹曲库失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("星穹曲库接口返回错误：{e}"))?;

    resp.json::<SongPage>()
        .await
        .map_err(|e| format!("星穹曲库数据解析失败：{e}"))
}

/// 下载 DPS1 曲谱文本。
pub async fn download_celestia(id: u32) -> Result<Vec<u8>, String> {
    let resp = celestia_client(Duration::from_secs(40))?
        .get(format!("{CELESTIA_BASE}/concert/api/songs/{id}/dps"))
        .send()
        .await
        .map_err(|e| format!("下载曲谱失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("曲谱不存在或无法访问：{e}"))?;

    let bytes = resp.bytes().await.map_err(|e| format!("读取曲谱内容失败：{e}"))?;
    if bytes.is_empty() {
        return Err("下载到的曲谱为空".into());
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

fn parse_int_list(line: &str, label: &str) -> Result<Vec<u32>, String> {
    let mut out = Vec::new();
    for token in line.split(',') {
        let token = token.trim();
        if token.is_empty() {
            continue;
        }
        out.push(
            token
                .parse::<u32>()
                .map_err(|_| format!("DPS {label}列含非法数值：{token}"))?,
        );
    }
    Ok(out)
}

/// 解析星穹音乐厅的 DPS1 文本格式。
///
/// 结构：首行 `DPS1\t<id>\t<title>\t<事件数>`，第二行逐事件毫秒增量，
/// 第三行逐事件打包值 `类型<<16 | 数据1<<8 | 数据2`：
///
/// | 类型 | 含义 | 数据1 | 数据2 |
/// |---|---|---|---|
/// | 1 | NoteOn | 音高 | 力度 |
/// | 2 | NoteOff | 音高 | 恒为 0 |
/// | 3 | 控制器 | 控制器号（如 64 延音踏板） | 值 |
///
/// 和 SMF 最大的不同是时间已经是毫秒，不需要 tempo map 换算。
fn build_dps_timeline(text: &str) -> Result<(Vec<TimedEvent>, f64), String> {
    let mut lines = text.lines();
    let header = lines.next().ok_or("曲谱内容为空")?;
    let header_fields: Vec<&str> = header.split('\t').collect();
    if header_fields.first() != Some(&"DPS1") {
        return Err("不是 DPS1 曲谱".into());
    }
    let declared: usize = header_fields
        .get(3)
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(0);

    let deltas = parse_int_list(lines.next().ok_or("DPS 缺少时间列")?, "时间")?;
    let packed = parse_int_list(lines.next().ok_or("DPS 缺少事件列")?, "事件")?;
    if deltas.len() != packed.len() {
        return Err(format!(
            "DPS 时间列与事件列长度不一致（{} / {}）",
            deltas.len(),
            packed.len()
        ));
    }
    if declared > 0 && declared != packed.len() {
        // 只是提示性信息，不影响解析，长度以实际为准
        eprintln!("[dps] 头部声明 {declared} 个事件，实际解析到 {}", packed.len());
    }

    let mut events: Vec<TimedEvent> = Vec::with_capacity(packed.len());
    let mut t_ms: u64 = 0;
    for (delta, value) in deltas.iter().zip(packed.iter()) {
        t_ms += u64::from(*delta);
        let data1 = ((value >> 8) & 0x7F) as u8;
        let data2 = (value & 0x7F) as u8;
        let bytes = match value >> 16 {
            1 => vec![0x90, data1, data2],
            2 => vec![0x80, data1, data2],
            3 => vec![0xB0, data1, data2],
            _ => continue,
        };
        events.push(TimedEvent {
            at: t_ms as f64 / 1000.0,
            bytes,
        });
    }

    if events.is_empty() {
        return Err("该曲谱没有可播放的音符事件".into());
    }

    Ok((events, t_ms as f64 / 1000.0))
}

/// 把 SMF 展开成按绝对时间排序的事件序列，并返回总时长（秒）。
///
/// 这一步替代了 mido 的 `MidiFile.length`：midly 只给 delta tick，
/// 需要自己按 tempo map 把 tick 换算成秒。
fn build_timeline(bytes: &[u8]) -> Result<(Vec<TimedEvent>, f64), String> {
    // 两个曲库格式不同：标准 MIDI 文件，以及星穹音乐厅的 DPS1 文本
    if bytes.starts_with(b"DPS1") {
        let text = std::str::from_utf8(bytes).map_err(|e| format!("曲谱文本编码错误：{e}"))?;
        return build_dps_timeline(text);
    }

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
            .connect(port, "midi-client-out")
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

#[cfg(test)]
mod tests {
    use super::*;

    fn pack(kind: u32, data1: u32, data2: u32) -> u32 {
        (kind << 16) | (data1 << 8) | data2
    }

    /// DPS1 的类型解包与毫秒时间轴
    #[test]
    fn dps_decodes_events_and_times() {
        let packed = [
            pack(1, 60, 100), // 0ms    NoteOn  C4
            pack(2, 60, 0),   // 500ms  NoteOff C4
            pack(3, 64, 127), // 750ms  延音踏板踩下
            pack(1, 64, 80),  // 1000ms NoteOn  E4
        ];
        let deltas = [0, 500, 250, 250];
        let values = packed
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let text = format!(
            "DPS1\t42\t测试曲目\t{}\n{}\n{}\n",
            packed.len(),
            deltas
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(","),
            values
        );

        let (events, duration) = build_dps_timeline(&text).expect("应能解析");
        assert_eq!(events.len(), 4);
        assert_eq!(duration, 1.0);

        assert_eq!(events[0].at, 0.0);
        assert_eq!(events[0].bytes, vec![0x90, 60, 100]);
        assert_eq!(events[1].at, 0.5);
        assert_eq!(events[1].bytes, vec![0x80, 60, 0]);
        assert_eq!(events[2].at, 0.75);
        assert_eq!(events[2].bytes, vec![0xB0, 64, 127]);
        assert_eq!(events[3].at, 1.0);
        assert_eq!(events[3].bytes, vec![0x90, 64, 80]);
    }

    /// 整个文件入口按内容嗅探：DPS1 文本与 SMF 走不同解析器
    #[test]
    fn build_timeline_sniffs_dps() {
        let text = b"DPS1\t7\tx\t1\n0\n".to_vec();
        let mut raw = text.clone();
        raw.extend_from_slice(format!("{}\n", pack(1, 72, 90)).as_bytes());
        let (events, duration) = build_timeline(&raw).expect("应识别为 DPS1");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].bytes, vec![0x90, 72, 90]);
        assert_eq!(duration, 0.0);
    }

    /// 时间列与事件列长度不一致时报错，而不是错位播放
    #[test]
    fn dps_rejects_length_mismatch() {
        let text = "DPS1\t1\tt\t2\n0,100\n123\n";
        assert!(build_dps_timeline(text).is_err());
    }

    /// 新版接口带 pagination，直接采用服务端的分页结果
    #[test]
    fn payload_uses_server_pagination() {
        let raw = r#"{
            "success": true,
            "files": [
                {"slug": "a", "fileName": "a.mid", "name": "a", "size": 10, "lastModified": "2026-11-01T15:01:45Z"},
                {"slug": "", "fileName": "b.MID", "name": ""}
            ],
            "pagination": {"page": 2, "limit": 2, "total": 9, "totalPages": 5, "hasMore": true}
        }"#;
        let payload: RemotePayload = serde_json::from_str(raw).expect("应能解析");
        let page = page_from_payload(payload, "ignored", 2, 2);

        assert_eq!(page.page, 2);
        assert_eq!(page.total, 9);
        assert!(page.has_more);
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.items[0].file_name, "a.mid");
        // name 缺失时用去扩展名的文件名兜底
        assert_eq!(page.items[1].name, "b");
        assert_eq!(page.items[1].slug, "b");
    }

    /// 老部署没有 pagination：就地过滤 + 切片，保证分页语义一致
    #[test]
    fn legacy_payload_slices_locally() {
        let raw = r#"["Piano Sonata.mid", "Love Story.mid", "love me.MIDI"]"#;
        let payload: RemotePayload =
            serde_json::from_str(&format!(r#"{{"files": {raw}}}"#)).expect("应能解析");

        let first = page_from_payload(payload, "LOVE", 1, 2);
        assert_eq!(first.total, 2);
        assert_eq!(first.total_pages, 1);
        assert!(!first.has_more);
        let titles: Vec<&str> = first.items.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(titles, ["Love Story", "love me"]);

        // 搜索为空时按 limit 切片，页码越界收敛到最后一页
        let payload: RemotePayload =
            serde_json::from_str(&format!(r#"{{"files": {raw}}}"#)).expect("应能解析");
        let last = page_from_payload(payload, "", 9, 2);
        assert_eq!(last.page, 2);
        assert_eq!(last.total, 3);
        assert!(!last.has_more);
        assert_eq!(last.items.len(), 1);

        // 越界到 3 页以外仍返回最后一页，且空曲库不会 panic
        let empty: RemotePayload = serde_json::from_str(r#"{"files": []}"#).expect("应能解析");
        let page = page_from_payload(empty, "x", 3, 20);
        assert_eq!(page.total, 0);
        assert_eq!(page.total_pages, 0);
        assert!(page.items.is_empty());
    }
}
