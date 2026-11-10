import { invoke } from "@tauri-apps/api/core";

export type PortInfo = { index: number; name: string };

export type PlaybackState = {
  playing: boolean;
  title: string | null;
  duration: number;
};

export type Progress = { position: number; duration: number };

/** 原曲库条目（Go 端 /api/midi 的 MidiFileItem） */
export type MidiFileItem = {
  /** 去扩展名的文件名 */
  slug: string;
  /** 带扩展名的文件名，下载用 */
  fileName: string;
  name: string;
  size: number;
  /** RFC3339（UTC） */
  lastModified: string;
};

/** 原曲库分页结果，与 SongPage 对齐（total + items） */
export type MidiPage = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  items: MidiFileItem[];
};

/** 星穹音乐厅曲目 */
export type SongSummary = {
  id: number;
  title: string;
  uploader: string;
  /** 时长（秒） */
  sec: number;
  events: number;
  notes: number;
  created: number;
};

export type SongPage = { total: number; items: SongSummary[] };

/** 与后端白名单一致；未知值后端会回落到 new */
export type SongSort = "new" | "old" | "title" | "long";

export type UpdateInfo = {
  current: string;
  version: string;
  notes: string | null;
  date: string | null;
};

export type UpdateProgress = {
  downloaded?: number;
  total?: number;
  done?: boolean;
};

export const listPorts = () => invoke<PortInfo[]>("list_ports");

/** 原曲库：服务端搜索 + 分页（page 从 1 开始，limit 上限 100） */
export const listRemoteFiles = (search: string, page: number, limit: number) =>
  invoke<MidiPage>("list_remote_files", { search, page, limit });

export const listCelestiaSongs = (
  q: string,
  sort: SongSort,
  offset: number,
  limit: number,
) => invoke<SongPage>("list_celestia_songs", { q, sort, offset, limit });

export const playCelestia = (id: number, title: string, portIndex: number) =>
  invoke<void>("play_celestia", { id, title, portIndex });

export const playRemote = (fileName: string, portIndex: number) =>
  invoke<void>("play_remote", { fileName, portIndex });

export const playLocal = (path: string, portIndex: number) =>
  invoke<void>("play_local", { path, portIndex });

export const stopPlayback = () => invoke<boolean>("stop_playback");

export const getPlaybackState = () => invoke<PlaybackState>("playback_state");

export const checkUpdate = () => invoke<UpdateInfo | null>("check_update");

export const installUpdate = () => invoke<void>("install_update");
