import { prettyName } from "../lib/format";
import { IconPlay } from "./icons";

type Props = {
  files: string[];
  playingTitle: string | null;
  playing: boolean;
  busy: string | null;
  onPlay: (fileName: string) => void;
};

function Equalizer() {
  return (
    <span className="flex h-3.5 items-end gap-[2px]">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="w-[2px] origin-bottom rounded-full bg-brand-400"
          style={{
            height: "100%",
            animation: `pulse-bar 900ms ease-in-out ${i * 130}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

export default function FileList({ files, playingTitle, playing, busy, onPlay }: Props) {
  if (files.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-zinc-600">
        没有匹配的曲目
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
      {files.map((file, index) => {
        const name = prettyName(file);
        const active = playingTitle === name;
        const loading = busy === file || busy === name;

        return (
          <button
            key={file}
            onClick={() => onPlay(file)}
            className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
              active
                ? "bg-brand-500/12 ring-1 ring-brand-500/25"
                : "hover:bg-ink-850 active:bg-ink-800"
            }`}
          >
            <span
              className={`w-7 shrink-0 text-right text-[11px] tabular-nums ${
                active ? "text-brand-400" : "text-zinc-600"
              }`}
            >
              {String(index + 1).padStart(2, "0")}
            </span>

            <span
              className={`flex-1 truncate text-[13.5px] ${
                active ? "text-brand-200" : "text-zinc-300 group-hover:text-zinc-100"
              }`}
            >
              {name}
            </span>

            <span className="flex w-6 shrink-0 items-center justify-center">
              {loading ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-brand-500/30 border-t-brand-400" />
              ) : active && playing ? (
                <Equalizer />
              ) : (
                <IconPlay className="h-3 w-3 text-brand-400 opacity-0 transition-opacity group-hover:opacity-100" />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
