import type { UpdateInfo } from "../lib/api";
import { IconClose, IconSparkle } from "./icons";

type Props = {
  info: UpdateInfo | null;
  installing: boolean;
  percent: number | null;
  onClose: () => void;
  onInstall: () => void;
};

export default function UpdateDialog({ info, installing, percent, onClose, onInstall }: Props) {
  if (!info) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6">
      <div className="animate-rise w-full max-w-[460px] rounded-2xl border border-ink-700 bg-ink-900 p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
            <IconSparkle className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <h2 className="text-[14px] font-medium text-zinc-100">发现新版本</h2>
            <p className="mt-1 text-[12px] text-zinc-500">
              v{info.current} → <span className="text-brand-300">v{info.version}</span>
              {info.date && <span className="ml-2 text-zinc-600">{info.date}</span>}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={installing}
            className="text-zinc-500 transition-colors hover:text-zinc-200 disabled:opacity-40"
          >
            <IconClose className="h-3.5 w-3.5" />
          </button>
        </div>

        {info.notes && (
          <div className="mt-4 max-h-40 overflow-y-auto rounded-lg bg-ink-850 p-3 text-[12px] leading-relaxed whitespace-pre-wrap text-zinc-400">
            {info.notes}
          </div>
        )}

        {installing && (
          <div className="mt-4">
            <div className="h-1 overflow-hidden rounded-full bg-ink-700">
              <div
                className="h-full rounded-full bg-brand-500 transition-[width] duration-200"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-zinc-500">
              {percent === null ? "正在准备下载…" : `下载中 ${percent}%`}
            </p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={installing}
            className="h-8 rounded-lg border border-ink-700 px-3.5 text-[12px] text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-40"
          >
            稍后
          </button>
          <button
            onClick={onInstall}
            disabled={installing}
            className="h-8 rounded-lg bg-brand-500 px-4 text-[12px] font-medium text-ink-950 transition-colors hover:bg-brand-400 disabled:opacity-60"
          >
            {installing ? "更新中…" : "立即更新"}
          </button>
        </div>
      </div>
    </div>
  );
}
