// 系统通知（Windows 通知中心）。收进托盘时窗口已经藏起来了，
// 界面内的 sonner toast 根本看不见，只能交给系统通知去说。
// 用法与 lan-room 一致：tauri-plugin-notification 的 Rust 侧 builder。
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// 弹一条系统通知。
/// 失败只打日志：系统通知被用户在 Windows 设置里关掉是很常见的情况，
/// 不能让它连带影响「隐藏窗口」这条主流程。
pub fn show(app: &AppHandle, title: &str, body: &str) {
    let result = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
    if let Err(e) = result {
        eprintln!("[toast] 系统通知发送失败：{e}");
    }
}

/// 收进托盘时的固定文案
pub fn hide_to_tray(app: &AppHandle) {
    show(
        app,
        "midi-client 还在后台运行",
        "已最小化到系统托盘。点托盘图标或再次启动就能回到界面，右键菜单里可以退出。",
    );
}
