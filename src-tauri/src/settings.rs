// 设置持久化：结构对齐 lan-room 的做法，存 config 目录下的 settings.json。
// 内存里保留一份，托盘菜单 / 关窗逻辑 / 前端命令都读这份，避免每次读盘。
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct SettingsState(pub Mutex<Settings>);

/// 每页条数的允许区间：两个曲库的接口 limit 上限都是 100
pub const MIN_PAGE_SIZE: u32 = 20;
pub const MAX_PAGE_SIZE: u32 = 100;
pub const DEFAULT_PAGE_SIZE: u32 = 40;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// 点关闭按钮时收进托盘而不是退出
    pub close_to_tray: bool,
    /// 收进托盘时是否停止播放（默认继续播，方便挂着听）
    pub stop_on_hide: bool,
    /// 记住上次选择的输出端口（端口序号会变，所以按名字记）
    pub remember_port: bool,
    /// 上次使用的端口名，仅在 remember_port 为真时使用
    pub port_name: String,
    /// 上次浏览的曲库：midisongs / celestia
    pub last_source: String,
    /// 每页条数
    pub page_size: u32,
    /// 启动后自动检查更新
    pub auto_check_update: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            stop_on_hide: false,
            remember_port: true,
            port_name: String::new(),
            last_source: "midisongs".to_string(),
            page_size: DEFAULT_PAGE_SIZE,
            auto_check_update: true,
        }
    }
}

impl Settings {
    /// 归一化：脏数据（手动改坏的 json、旧版本残留）不许进内存
    pub fn normalize(&mut self) {
        self.page_size = self
            .page_size
            .clamp(MIN_PAGE_SIZE, MAX_PAGE_SIZE);
        self.port_name = self.port_name.trim().chars().take(200).collect();
        if !matches!(self.last_source.as_str(), "midisongs" | "celestia") {
            self.last_source = Settings::default().last_source;
        }
        if !self.remember_port {
            self.port_name.clear();
        }
    }
}

fn settings_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&dir);
    dir.join("settings.json")
}

pub fn load(app: &AppHandle) -> Settings {
    let path = settings_path(app);
    match fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<Settings>(&text) {
            Ok(mut s) => {
                s.normalize();
                s
            }
            Err(e) => {
                eprintln!("[settings] 解析失败，使用默认值：{e}");
                Settings::default()
            }
        },
        Err(_) => Settings::default(),
    }
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app);
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| format!("写入设置失败：{e}"))
}

/// 读一份快照，锁中毒（panic 过）也不影响使用
pub fn snapshot(handle: &AppHandle) -> Settings {
    handle
        .try_state::<SettingsState>()
        .map(|state| {
            state
                .0
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
        })
        .unwrap_or_default()
}
