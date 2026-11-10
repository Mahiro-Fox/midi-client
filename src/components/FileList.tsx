import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { prettyName } from "@/lib/format";

type Props = {
  files: string[];
  playingTitle: string | null;
  playing: boolean;
  busy: string | null;
  /** 每次 +1 表示「滚到当前播放曲目」，0 表示还没触发过 */
  locateTick: number;
  onPlay: (fileName: string) => void;
};

/** 行高固定，虚拟列表才能精确算总高度与滚动位置 */
const ROW_HEIGHT = 44;
const ROW_INNER = 40;

function Equalizer() {
  return (
    <span className="flex h-3.5 items-end gap-0.5">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="w-0.5 origin-bottom rounded-full bg-primary"
          style={{
            height: "100%",
            animation: `pulse-bar 900ms ease-in-out ${i * 130}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

export default function FileList({
  files,
  playingTitle,
  playing,
  busy,
  locateTick,
  onPlay,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [flash, setFlash] = useState(false);

  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // 当前播放曲目在（可能被过滤过的）列表里的位置
  const activeIndex = useMemo(
    () =>
      playingTitle
        ? files.findIndex((file) => prettyName(file) === playingTitle)
        : -1,
    [files, playingTitle],
  );

  // 只让「点击定位」触发滚动：effect 不依赖 activeIndex，
  // 否则用户手动切歌时列表会被动跳到中间。
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  useEffect(() => {
    if (locateTick === 0) return;
    const index = activeIndexRef.current;
    if (index < 0) return;

    // 虚拟列表里目标行可能还没挂载，不能靠 scrollIntoView
    virtualizer.scrollToIndex(index, { align: "center", behavior: "smooth" });
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 1300);
    return () => clearTimeout(timer);
  }, [locateTick, virtualizer]);

  if (files.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
        没有匹配的曲目
      </div>
    );
  }

  const items = virtualizer.getVirtualItems();

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {items.map((item) => {
          const file = files[item.index];
          const name = prettyName(file);
          const active = item.index === activeIndex;
          const loading = busy === file || busy === name;

          return (
            <div
              key={item.key}
              className="absolute top-0 left-0 w-full py-0.5"
              style={{
                height: `${item.size}px`,
                transform: `translateY(${item.start}px)`,
              }}
            >
              <div
                className={`group flex items-center gap-3 rounded-lg px-2.5 transition-colors ${
                  active
                    ? "bg-primary/10 ring-1 ring-primary/25"
                    : "hover:bg-accent/60"
                } ${active && flash ? "locate-flash" : ""}`}
                style={{ height: `${ROW_INNER}px` }}
              >
                <span
                  className={`w-7 shrink-0 text-right text-[11px] tabular-nums ${
                    active ? "text-primary" : "text-muted-foreground/70"
                  }`}
                >
                  {String(item.index + 1).padStart(2, "0")}
                </span>

                <span
                  className={`flex-1 truncate text-[13.5px] ${
                    active
                      ? "text-brand-300"
                      : "text-zinc-300 group-hover:text-foreground"
                  }`}
                >
                  {name}
                </span>

                {/* 播放只由这个按钮触发，行本身不可点 */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onPlay(file)}
                  disabled={loading}
                  title={`播放 ${name}`}
                  aria-label={`播放 ${name}`}
                  className={`shrink-0 rounded-full hover:bg-primary/15 hover:text-brand-300 ${
                    active
                      ? "text-primary"
                      : "text-muted-foreground group-hover:text-brand-300"
                  }`}
                >
                  {loading ? (
                    <Loader2 className="animate-spin" />
                  ) : active && playing ? (
                    <Equalizer />
                  ) : (
                    <Play className="fill-current" />
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
