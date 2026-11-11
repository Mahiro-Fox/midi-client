use std::path::Path;

use tauri::{AppHandle, State};

use crate::midi::{self, Engine, MidiPage, PlaybackState, PortInfo, SongPage};
use crate::settings::{self, Settings, SettingsState};
use crate::updater::{self, UpdateInfo};

#[tauri::command]
pub fn list_ports() -> Result<Vec<PortInfo>, String> {
    midi::list_ports()
}

/// 原曲库分页列表（服务端搜索 + 分页）
#[tauri::command]
pub async fn list_remote_files(search: String, page: u32, limit: u32) -> Result<MidiPage, String> {
    midi::fetch_remote_files(&search, page, limit).await
}

#[tauri::command]
pub async fn play_remote(
    app: AppHandle,
    engine: State<'_, Engine>,
    file_name: String,
    port_index: usize,
) -> Result<(), String> {
    let bytes = midi::download_remote(&file_name).await?;
    engine.play(app, bytes, display_title(&file_name), port_index)
}

/// 星穹音乐厅曲库分页列表
#[tauri::command]
pub async fn list_celestia_songs(
    q: String,
    sort: String,
    offset: u32,
    limit: u32,
) -> Result<SongPage, String> {
    midi::fetch_celestia_songs(&q, &sort, offset, limit).await
}

/// 播放星穹音乐厅曲目（DPS1 格式，由 Engine 按内容嗅探）
#[tauri::command]
pub async fn play_celestia(
    app: AppHandle,
    engine: State<'_, Engine>,
    id: u32,
    title: String,
    port_index: usize,
) -> Result<(), String> {
    let bytes = midi::download_celestia(id).await?;
    let name = if title.trim().is_empty() {
        format!("Celestia #{id}")
    } else {
        title
    };
    engine.play(app, bytes, name, port_index)
}

#[tauri::command]
pub fn play_local(
    app: AppHandle,
    engine: State<'_, Engine>,
    path: String,
    port_index: usize,
) -> Result<(), String> {
    let file = Path::new(&path);
    let bytes = std::fs::read(file).map_err(|e| format!("读取本地文件失败：{e}"))?;
    let name = file
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    engine.play(app, bytes, display_title(&name), port_index)
}

#[tauri::command]
pub fn stop_playback(engine: State<'_, Engine>) -> bool {
    engine.stop()
}

#[tauri::command]
pub fn playback_state(engine: State<'_, Engine>) -> PlaybackState {
    engine.state()
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    updater::check(app).await
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    updater::install(app).await
}

#[tauri::command]
pub fn get_settings(state: State<'_, SettingsState>) -> Settings {
    state.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// 前端每次改动都整份提交，后端归一化后再落盘并更新内存副本
#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, SettingsState>,
    next: Settings,
) -> Result<Settings, String> {
    let mut normalized = next;
    normalized.normalize();
    settings::save(&app, &normalized)?;
    *state.0.lock().unwrap_or_else(|e| e.into_inner()) = normalized.clone();
    Ok(normalized)
}

/// 去掉扩展名作为界面标题
fn display_title(file_name: &str) -> String {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".midi") {
        file_name[..file_name.len() - 5].to_string()
    } else if lower.ends_with(".mid") {
        file_name[..file_name.len() - 4].to_string()
    } else {
        file_name.to_string()
    }
}
