import { invoke } from "@tauri-apps/api/core";

/** 与 Rust 侧 `settings::Settings` 一一对应（camelCase 序列化） */
export type Settings = {
  /** 关窗时收进托盘 */
  closeToTray: boolean;
  /** 收进托盘时停止播放 */
  stopOnHide: boolean;
  /** 记住上次的输出端口 */
  rememberPort: boolean;
  /** 上次使用的端口名，rememberPort 为真时才生效 */
  portName: string;
  /** 上次浏览的曲库 */
  lastSource: string;
  /** 每页条数 */
  pageSize: number;
  /** 启动后自动检查更新 */
  autoCheckUpdate: boolean;
};

/** 可选每页条数：两个曲库接口的 limit 上限都是 100 */
export const PAGE_SIZES = [30, 40, 60, 100];

export const DEFAULT_SETTINGS: Settings = {
  closeToTray: true,
  stopOnHide: false,
  rememberPort: true,
  portName: "",
  lastSource: "midisongs",
  pageSize: 40,
  autoCheckUpdate: true,
};

export const getSettings = () => invoke<Settings>("get_settings");

export const saveSettings = (next: Settings) => invoke<Settings>("save_settings", { next });
