import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";

import FileList from "./components/FileList";
import Header from "./components/Header";
import PlayerBar from "./components/PlayerBar";
import Toast from "./components/Toast";
import UpdateDialog from "./components/UpdateDialog";
import { IconRefresh, IconSearch } from "./components/icons";
import {
  checkUpdate,
  getPlaybackState,
  installUpdate,
  listPorts,
  listRemoteFiles,
  playLocal,
  playRemote,
  stopPlayback,
  type PlaybackState,
  type PortInfo,
  type Progress,
  type UpdateInfo,
  type UpdateProgress,
} from "./lib/api";
import { errorText } from "./lib/format";

const EMPTY_STATE: PlaybackState = { playing: false, title: null, duration: 0 };

export default function App() {
  const [version, setVersion] = useState("");
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [portIndex, setPortIndex] = useState<number | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [state, setState] = useState<PlaybackState>(EMPTY_STATE);
  const [progress, setProgress] = useState<Progress>({ position: 0, duration: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [updatePercent, setUpdatePercent] = useState<number | null>(null);

  const refreshPorts = useCallback(async () => {
    try {
      const list = await listPorts();
      setPorts(list);
      setPortIndex((prev) => {
        if (prev !== null && list.some((p) => p.index === prev)) return prev;
        const preferred = list.find((p) => /loopmidi|midi\s*through|virtual/i.test(p.name));
        return preferred?.index ?? list[0]?.index ?? null;
      });
    } catch (error) {
      setToast(errorText(error));
    }
  }, []);

  const refreshFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      setFiles(await listRemoteFiles());
    } catch (error) {
      setToast(errorText(error));
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => setVersion(""));
    void refreshPorts();
    void refreshFiles();
    void getPlaybackState()
      .then((s) => {
        setState(s);
        if (s.duration > 0) setProgress({ position: 0, duration: s.duration });
      })
      .catch(() => undefined);
  }, [refreshPorts, refreshFiles]);

  useEffect(() => {
    const disposers: Array<() => void> = [];
    let active = true;

    void (async () => {
      const registered = await Promise.all([
        listen<Progress>("playback://progress", (event) => setProgress(event.payload)),
        listen<PlaybackState>("playback://state", (event) => setState(event.payload)),
        listen<string>("playback://error", (event) => setToast(event.payload)),
        listen<UpdateProgress>("update-progress", (event) => {
          const { downloaded = 0, total } = event.payload;
          setUpdatePercent(total ? Math.min(100, Math.round((downloaded / total) * 100)) : null);
        }),
      ]);
      if (active) disposers.push(...registered);
      else registered.forEach((dispose) => dispose());
    })();

    return () => {
      active = false;
      disposers.forEach((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? files.filter((file) => file.toLowerCase().includes(q)) : files;
  }, [files, query]);

  const requirePort = useCallback(() => {
    if (portIndex === null) {
      setToast("请先选择一个 MIDI 输出端口");
      return false;
    }
    return true;
  }, [portIndex]);

  const handlePlay = useCallback(
    async (fileName: string) => {
      if (!requirePort()) return;
      setBusy(fileName);
      try {
        await playRemote(fileName, portIndex as number);
      } catch (error) {
        setToast(errorText(error));
      } finally {
        setBusy(null);
      }
    },
    [portIndex, requirePort],
  );

  const handleStop = useCallback(async () => {
    try {
      await stopPlayback();
      setProgress((prev) => ({ position: 0, duration: prev.duration }));
    } catch (error) {
      setToast(errorText(error));
    }
  }, []);

  const handlePickLocal = useCallback(async () => {
    if (!requirePort()) return;
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        title: "选择本地 MIDI 文件",
        filters: [{ name: "MIDI 文件", extensions: ["mid", "midi"] }],
      });
      const path = typeof picked === "string" ? picked : Array.isArray(picked) ? picked[0] : null;
      if (!path) return;

      setBusy(path.split(/[\\/]/).pop() ?? path);
      await playLocal(path, portIndex as number);
    } catch (error) {
      setToast(errorText(error));
    } finally {
      setBusy(null);
    }
  }, [portIndex, requirePort]);

  const handleCheckUpdate = useCallback(async () => {
    setChecking(true);
    try {
      const info = await checkUpdate();
      if (!info) {
        setToast(`已是最新版本${version ? `（v${version}）` : ""}`);
        return;
      }
      setUpdate(info);
      setUpdatePercent(null);
    } catch (error) {
      setToast(errorText(error));
    } finally {
      setChecking(false);
    }
  }, [version]);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    try {
      await installUpdate();
    } catch (error) {
      setToast(errorText(error));
      setInstalling(false);
    }
  }, []);

  return (
    <div className="flex h-full flex-col bg-ink-950">
      <Header
        ports={ports}
        portIndex={portIndex}
        version={version}
        checking={checking}
        onPortChange={setPortIndex}
        onRefreshPorts={() => void refreshPorts()}
        onCheckUpdate={() => void handleCheckUpdate()}
      />

      <div className="flex shrink-0 items-center gap-3 px-4 py-3">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索曲目（本地过滤）"
            spellCheck={false}
            className="h-9 w-full rounded-lg border border-ink-800 bg-ink-900 pr-3 pl-9 text-[13px] text-zinc-200 placeholder:text-zinc-600 outline-none transition-colors focus:border-brand-600"
          />
        </div>

        <span className="shrink-0 text-[11.5px] tabular-nums text-zinc-600">
          {loadingFiles ? "加载中…" : `${filtered.length} / ${files.length}`}
        </span>

        <button
          onClick={() => void refreshFiles()}
          disabled={loadingFiles}
          title="刷新曲库"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-ink-800 px-3 text-[12px] text-zinc-400 transition-colors hover:border-ink-700 hover:text-zinc-100 disabled:opacity-50 active:scale-95"
        >
          <IconRefresh className={`h-3.5 w-3.5 ${loadingFiles ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      <FileList
        files={filtered}
        playingTitle={state.title}
        playing={state.playing}
        busy={busy}
        onPlay={(fileName) => void handlePlay(fileName)}
      />

      <PlayerBar
        playing={state.playing}
        title={state.title}
        position={progress.position}
        duration={progress.duration || state.duration}
        busy={busy}
        onStop={() => void handleStop()}
        onPickLocal={() => void handlePickLocal()}
      />

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      <UpdateDialog
        info={update}
        installing={installing}
        percent={updatePercent}
        onClose={() => {
          if (!installing) setUpdate(null);
        }}
        onInstall={() => void handleInstall()}
      />
    </div>
  );
}
