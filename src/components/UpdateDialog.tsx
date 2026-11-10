import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import type { UpdateInfo } from "@/lib/api";

type Props = {
  info: UpdateInfo | null;
  installing: boolean;
  percent: number | null;
  onClose: () => void;
  onInstall: () => void;
};

export default function UpdateDialog({ info, installing, percent, onClose, onInstall }: Props) {
  return (
    <Dialog
      open={Boolean(info)}
      onOpenChange={(open) => {
        if (!open && !installing) onClose();
      }}
    >
      <DialogContent
        className="bg-card sm:max-w-[460px]"
        // 下载安装期间不允许点外部关闭，避免更新到一半丢了对话框
        onInteractOutside={(event) => {
          if (installing) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-medium">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-brand-400">
              <Sparkles className="size-4" />
            </span>
            发现新版本
          </DialogTitle>
          <DialogDescription className="text-xs">
            v{info?.current} → <span className="text-brand-300">v{info?.version}</span>
            {info?.date && <span className="ml-2 text-muted-foreground/70">{info.date}</span>}
          </DialogDescription>
        </DialogHeader>

        {info?.notes && (
          <div className="max-h-40 overflow-y-auto rounded-lg bg-secondary/60 p-3 text-xs leading-relaxed whitespace-pre-wrap text-zinc-400">
            {info.notes}
          </div>
        )}

        {installing && (
          <div className="space-y-1.5">
            <Progress value={percent ?? 0} className="h-1" />
            <p className="text-[11px] text-muted-foreground">
              {percent === null ? "正在准备下载…" : `下载中 ${percent}%`}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={installing}>
            稍后
          </Button>
          <Button size="sm" onClick={onInstall} disabled={installing}>
            {installing ? "更新中…" : "立即更新"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
