import type { PortInfo } from "../lib/api";
import { IconRefresh, IconSparkle, Logo } from "./icons";

type Props = {
  ports: PortInfo[];
  portIndex: number | null;
  version: string;
  checking: boolean;
  onPortChange: (index: number) => void;
  onRefreshPorts: () => void;
  onCheckUpdate: () => void;
};

export default function Header({
  ports,
  portIndex,
  version,
  checking,
  onPortChange,
  onRefreshPorts,
  onCheckUpdate,
}: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ink-800 bg-ink-900 px-4">
      <Logo className="h-7 w-7" />
      <div className="flex items-baseline gap-2">
        <span className="text-[15px] font-medium tracking-wide text-zinc-100">MIDITOOL</span>
        {version && (
          <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] leading-none text-zinc-500">
            v{version}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            ports.length > 0 ? "bg-emerald-400" : "bg-amber-400"
          }`}
          title={ports.length > 0 ? "已检测到 MIDI 端口" : "未检测到 MIDI 端口"}
        />
        <label className="text-[12px] text-zinc-500" htmlFor="port">
          输出端口
        </label>
        <select
          id="port"
          value={portIndex ?? ""}
          onChange={(event) => onPortChange(Number(event.target.value))}
          className="h-8 max-w-[240px] min-w-[150px] rounded-lg border border-ink-700 bg-ink-800 px-2.5 text-[13px] text-zinc-200 outline-none transition-colors hover:border-ink-600 focus:border-brand-500"
        >
          {ports.length === 0 && <option value="">未找到端口</option>}
          {ports.map((port) => (
            <option key={port.index} value={port.index}>
              {port.name}
            </option>
          ))}
        </select>

        <button
          onClick={onRefreshPorts}
          title="刷新端口"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink-700 text-zinc-400 transition-colors hover:border-ink-600 hover:text-zinc-100 active:scale-95"
        >
          <IconRefresh className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={onCheckUpdate}
          disabled={checking}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-ink-700 px-3 text-[12px] text-zinc-300 transition-colors hover:border-brand-600 hover:text-brand-300 disabled:opacity-50 active:scale-95"
        >
          <IconSparkle className={`h-3.5 w-3.5 ${checking ? "animate-pulse" : ""}`} />
          {checking ? "检查中" : "检查更新"}
        </button>
      </div>
    </header>
  );
}
