// 从 lan-room 项目移植的自动更新模块，接口保持原样。
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

fn init(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    app.updater()
        .map_err(|e| format!("更新模块初始化失败：{e}"))
}

pub async fn check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = init(&app)?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("检查更新失败：{e}"))?;
    Ok(update.map(|u| UpdateInfo {
        current: u.current_version.clone(),
        version: u.version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    }))
}

pub async fn install(app: AppHandle) -> Result<(), String> {
    let updater = init(&app)?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("检查更新失败：{e}"))?
        .ok_or("当前已是最新版本")?;

    let emitter = app.clone();
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = emitter.emit(
                    "update-progress",
                    serde_json::json!({ "downloaded": downloaded, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| format!("下载或安装更新失败：{e}"))?;

    let _ = app.emit("update-progress", serde_json::json!({ "done": true }));
    app.restart();
}
