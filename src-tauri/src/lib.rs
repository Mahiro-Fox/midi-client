mod commands;
mod midi;
mod settings;
mod toast;
mod tray;
mod updater;

use midi::Engine;
use settings::SettingsState;
use std::sync::Mutex;
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单例必须最先注册：再次启动只唤起已有窗口，否则会出现两个托盘图标抢同一个 MIDI 端口
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tray::show_main(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Engine::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_ports,
            commands::list_remote_files,
            commands::list_celestia_songs,
            commands::play_remote,
            commands::play_celestia,
            commands::play_local,
            commands::stop_playback,
            commands::playback_state,
            commands::get_settings,
            commands::save_settings,
            commands::check_update,
            commands::install_update,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // 设置要在建托盘之前进内存：关窗逻辑和托盘菜单都直接读它
            let loaded = settings::load(&handle);
            // 首次启动落一份默认值，也顺手把旧版本/手改的文件归一化
            if let Err(e) = settings::save(&handle, &loaded) {
                eprintln!("[settings] 初始化失败：{e}");
            }
            app.manage(SettingsState(Mutex::new(loaded)));
            tray::build(&handle)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            let WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };

            // 关窗前读一次设置：是收进托盘还是真正退出
            let current = settings::snapshot(window.app_handle());
            if current.close_to_tray {
                api.prevent_close();
                if current.stop_on_hide {
                    tray::stop_playback(window.app_handle());
                }
                // 用 Windows 原生通知交代去向：窗口一藏，界面里的 toast 就没人看得见。
                // 通知是系统进程弹的，先弹再隐藏，不受窗口可见性影响。
                toast::hide_to_tray(window.app_handle());
                let _ = window.hide();
            } else {
                // 真正退出前释放 MIDI 端口并清音，避免残留卡音符
                tray::stop_playback(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("启动 midi-client 失败");
}
