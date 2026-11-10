import { formatTime } from "../lib/format";
import { IconFolder, IconPlay, IconStop } from "./icons";

type Props = {
  playing: boolean;
  title: string | null;
  position: number;
  duration: number;
  busy: string | null;
  onStop: () => void;
  onPickLocal: () => void;
};

export default function PlayerBar({
  playing,
  title,
  position,
  duration,
  busy,
  onStop,
  onPickLocal,
}: Props) {
  const percent = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <footer className="flex h-20 shrink-0 items-center gap-4 border-t border-ink-800 bg-ink-900 px-4">
      <button
        onClick={onStop}
        disabled={!playing}
        title={playing ? "停止播放" : "当前未播放"}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all active:scale-95 ${
          playing
            ? "bg-brand-500 text-ink-950 hover:bg-brand-400"
            : "bg-ink-800 text-zinc-600"
        }`}
      >
        {playing ? <IconStop className="h-4 w-4" /> : <IconPlay className="h-4 w-4" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={`truncate text-[13px] ${playing ? "text-zinc-100" : "text-zinc-500"}`}
          >
            {title ?? "未在播放"}
          </span>
          {busy && (
            <span className="shrink-0 text-[11px] text-brand-400">正在加载…</span>
          )}
        </div>

        <div className="mt-2 flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-700">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400 transition-[width] duration-150 ease-linear"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
            {formatTime(position)} / {formatTime(duration)}
          </span>
        </div>
      </div>

      <button
        onClick={onPickLocal}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-ink-700 px-3 text-[12px] text-zinc-300 transition-colors hover:border-brand-600 hover:text-brand-300 active:scale-95"
      >
        <IconFolder className="h-3.5 w-3.5" />
        本地文件
      </button>
    </footer>
  );
}
