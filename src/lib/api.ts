import { invoke } from "@tauri-apps/api/core";

export type PortInfo = { index: number; name: string };

export type PlaybackState = {
  playing: boolean;
  title: string | null;
  duration: number;
};

export type Progress = { position: number; duration: number };

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

export const listRemoteFiles = () => invoke<string[]>("list_remote_files");

export const playRemote = (fileName: string, portIndex: number) =>
  invoke<void>("play_remote", { fileName, portIndex });

export const playLocal = (path: string, portIndex: number) =>
  invoke<void>("play_local", { path, portIndex });

export const stopPlayback = () => invoke<boolean>("stop_playback");

export const getPlaybackState = () => invoke<PlaybackState>("playback_state");

export const checkUpdate = () => invoke<UpdateInfo | null>("check_update");

export const installUpdate = () => invoke<void>("install_update");
