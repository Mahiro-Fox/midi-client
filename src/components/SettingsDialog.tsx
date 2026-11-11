import type { ReactNode } from "react";
import { Loader2, RefreshCw, Settings2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PAGE_SIZES, type Settings } from "@/lib/settings";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  /** 局部更新，改动即时落盘（后端保存） */
  onChange: (patch: Partial<Settings>) => void;
  version: string;
  checking: boolean;
  onCheckUpdate: () => void;
};

export default function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
  version,
  checking,
  onCheckUpdate,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden bg-card p-0 sm:max-w-130">
        <DialogHeader className="border-b border-border/70 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-sm font-medium">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-brand-400">
              <Settings2 className="size-4" />
            </span>
            设置
          </DialogTitle>
          <DialogDescription className="text-xs">
            所有改动即时保存，下次启动自动生效。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] overflow-y-auto px-5 py-1">
          <Section title="窗口">
            <Row
              title="关闭窗口时最小化到托盘"
              desc="点关闭按钮不退出程序，收进托盘继续在后台运行。"
            >
              <Switch
                checked={settings.closeToTray}
                onCheckedChange={(checked) => onChange({ closeToTray: checked })}
              />
            </Row>
            <Row
              title="收进托盘时停止播放"
              desc={
                settings.closeToTray
                  ? "关闭后仍想接着听，保持关闭即可。"
                  : "仅在「最小化到托盘」开启时有效。"
              }
            >
              <Switch
                checked={settings.stopOnHide}
                disabled={!settings.closeToTray}
                onCheckedChange={(checked) => onChange({ stopOnHide: checked })}
              />
            </Row>
          </Section>

          <Section title="播放">
            <Row
              title="记住上次使用的输出端口"
              desc="按端口名记忆，重启后自动选中同一个端口。"
            >
              <Switch
                checked={settings.rememberPort}
                onCheckedChange={(checked) =>
                  // 关掉记忆时顺带清空已存的端口名，避免下次误用
                  onChange({ rememberPort: checked, portName: checked ? settings.portName : "" })
                }
              />
            </Row>
          </Section>

          <Section title="曲库">
            <Row
              title="每页条数"
              desc="滚动到底部自动加载下一页，两个曲库接口上限均为 100。"
            >
              <Select
                value={String(settings.pageSize)}
                onValueChange={(value) => onChange({ pageSize: Number(value) })}
              >
                <SelectTrigger size="sm" className="w-24 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={6} align="end">
                  {PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)} className="text-xs">
                      {size} 首
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          </Section>

          <Section title="更新" last>
            <Row title="启动时自动检查更新" desc="发现新版本会弹出更新提示。">
              <Switch
                checked={settings.autoCheckUpdate}
                onCheckedChange={(checked) => onChange({ autoCheckUpdate: checked })}
              />
            </Row>
            <Row
              title="软件更新"
              desc={version ? `当前版本 v${version}` : "当前版本未知"}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={onCheckUpdate}
                disabled={checking}
                className="shrink-0"
              >
                {checking ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                {checking ? "检查中" : "检查更新"}
              </Button>
            </Row>
          </Section>
        </div>

        <DialogFooter className="flex-row items-center justify-between border-t border-border/70 px-5 py-3 sm:justify-between">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
            <Sparkles className="size-3" />
            改动即时保存，下次启动自动生效
          </span>
          <Button size="sm" variant="secondary" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  last,
  children,
}: {
  title: string;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={last ? "py-1" : "border-b border-border/50 py-1"}>
      <h3 className="pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground/80">
        {title}
      </h3>
      <div className="divide-y divide-border/40">{children}</div>
    </section>
  );
}

/** 一行设置：左侧标题 + 说明，右侧控件 */
function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-[13px] text-foreground">{title}</p>
        {desc && (
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground/75">{desc}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
