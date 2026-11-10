use std::path::Path;

use tauri::{AppHandle, State};

use crate::midi::{self, Engine, PlaybackState, PortInfo};
use crate::updater::{self, UpdateInfo};

#[tauri::command]
pub fn list_ports() -> Result<Vec<PortInfo>, String> {
    midi::list_ports()
}

#[tauri::command]
pub async fn list_remote_files() -> Result<Vec<String>, String> {
    midi::fetch_remote_files().await
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
