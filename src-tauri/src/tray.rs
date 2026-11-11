// 系统托盘：沿用 lan-room 的做法（左键唤起窗口，右键出菜单），
// 菜单位置换成本项目需要的几项，退出时先停播再退出，避免卡音符留在软音源里。
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::midi::Engine;

/// 托盘事件：前端据此打开设置弹窗 / 触发检查更新
pub const EVENT_SETTINGS: &str = "tray://settings";
pub const EVENT_CHECK_UPDATE: &str = "tray://check-update";

/// 显示并聚焦主窗口（托盘点击、再次启动、菜单项都会用到）
pub fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 停掉当前播放；没有播放时是无害的空操作
pub fn stop_playback(app: &AppHandle) {
    if let Some(engine) = app.try_state::<Engine>() {
        engine.stop();
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "打开主界面", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "停止播放", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
    let update = MenuItem::with_id(app, "update", "检查更新", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 midi-client", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[&show, &stop, &sep1, &settings, &update, &sep2, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        // 左键唤起窗口，菜单只在右键出现
        .show_menu_on_left_click(false)
        .tooltip("midi-client · MIDI 远程控制器")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "stop" => stop_playback(app),
            "settings" => {
                show_main(app);
                let _ = app.emit(EVENT_SETTINGS, ());
            }
            "update" => {
                show_main(app);
                let _ = app.emit(EVENT_CHECK_UPDATE, ());
            }
            "quit" => {
                stop_playback(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    } else {
        // 兜底：直接读内嵌 PNG，图标资源被替换坏也能起来
        let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
            .expect("内置托盘图标损坏");
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}
