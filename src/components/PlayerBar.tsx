import { FolderOpen, Play, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTime } from "@/lib/format";

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
    <footer className="flex h-20 shrink-0 items-center gap-4 border-t border-border bg-card px-4">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-lg"
            variant={playing ? "default" : "secondary"}
            onClick={onStop}
            disabled={!playing}
            aria-label={playing ? "停止播放" : "当前未播放"}
            className="rounded-full"
          >
            {playing ? <Square className="fill-current" /> : <Play className="fill-current" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{playing ? "停止播放" : "当前未播放"}</TooltipContent>
      </Tooltip>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`min-w-0 truncate text-[13px] ${
              playing ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {title ?? "未在播放"}
          </span>
          {busy && <span className="shrink-0 text-[11px] text-primary">正在加载…</span>}
        </div>

        <div className="mt-2 flex items-center gap-3">
          <Progress value={percent} className="h-1 bg-primary/15" />
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatTime(position)} / {formatTime(duration)}
          </span>
        </div>
      </div>

      <Button variant="outline" size="sm" onClick={onPickLocal}>
        <FolderOpen />
        本地文件
      </Button>
    </footer>
  );
}
