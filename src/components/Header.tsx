import { RefreshCw, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PortInfo } from "@/lib/api";
import { Logo } from "./logo";

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
  const hasPorts = ports.length > 0;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
      <Logo className="size-7" />
      <div className="flex items-baseline gap-2">
        <span className="text-[15px] font-medium tracking-wide text-foreground">MIDITOOL</span>
        {version && (
          <Badge
            variant="secondary"
            className="h-4 rounded px-1.5 text-[10px] font-normal text-muted-foreground"
          >
            v{version}
          </Badge>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={`size-1.5 rounded-full ${hasPorts ? "bg-emerald-400" : "bg-amber-400"}`}
            />
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {hasPorts ? `已检测到 ${ports.length} 个 MIDI 端口` : "未检测到 MIDI 端口"}
          </TooltipContent>
        </Tooltip>

        <span className="text-xs text-muted-foreground">输出端口</span>

        <Select
          value={portIndex !== null ? String(portIndex) : undefined}
          onValueChange={(value) => onPortChange(Number(value))}
          disabled={!hasPorts}
        >
          <SelectTrigger size="sm" className="w-55 text-xs">
            <SelectValue placeholder="未找到端口" />
          </SelectTrigger>
          <SelectContent
            position="popper"
            sideOffset={6}
            className="min-w-(--radix-select-trigger-width)"
          >
            {ports.map((port) => (
              <SelectItem key={port.index} value={String(port.index)} className="text-xs">
                {port.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={onRefreshPorts}
              aria-label="刷新端口"
            >
              <RefreshCw />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">刷新端口列表</TooltipContent>
        </Tooltip>

        <Button variant="outline" size="sm" onClick={onCheckUpdate} disabled={checking}>
          <Sparkles className={checking ? "animate-pulse" : undefined} />
          {checking ? "检查中" : "检查更新"}
        </Button>
      </div>
    </header>
  );
}
