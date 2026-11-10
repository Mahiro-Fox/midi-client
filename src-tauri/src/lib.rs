mod commands;
mod midi;
mod updater;

use midi::Engine;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Engine::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_ports,
            commands::list_remote_files,
            commands::play_remote,
            commands::play_local,
            commands::stop_playback,
            commands::playback_state,
            commands::check_update,
            commands::install_update,
        ])
        .on_window_event(|window, event| {
            // 关窗时主动释放 MIDI 端口并清音，避免残留卡音符留在软音源里
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(engine) = window.app_handle().try_state::<Engine>() {
                    engine.stop();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("启动 midi-client 失败");
}
