import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import type { TrackItem } from "@/lib/tracks";

type Props = {
  items: TrackItem[];
  /** 当前播放条目的 key */
  activeKey: string | null;
  playing: boolean;
  /** 正在加载的条目 key */
  busyKey: string | null;
  /** 每次 +1 表示「滚到当前播放曲目」，0 表示还没触发过 */
  locateTick: number;
  onPlay: (item: TrackItem) => void;
  /** 滚动接近底部时触发，用于分页拉取 */
  onReachEnd?: () => void;
  /** 滚动位置变化，用于切源后恢复（只上报，不参与渲染） */
  onScrollTop?: (top: number) => void;
  /** 挂载时要恢复的滚动位置（切回某个源时用） */
  initialScrollTop?: number;
  /** 列表底部的状态行（加载更多 / 已全部加载） */
  footer?: ReactNode;
  loading?: boolean;
  emptyText?: string;
};

/** 行高固定，虚拟列表才能精确算总高度与滚动位置 */
const ROW_HEIGHT = 44;
const ROW_INNER = 40;
/** 距底部多少像素开始预取下一页 */
const REACH_END_OFFSET = 420;

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
  items,
  activeKey,
  playing,
  busyKey,
  locateTick,
  onPlay,
  onReachEnd,
  onScrollTop,
  initialScrollTop = 0,
  footer,
  loading = false,
  emptyText = "没有匹配的曲目",
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [flash, setFlash] = useState(false);
  /** 恢复位置期间忽略 scroll 事件，避免「一进来就贴着底部」被当成用户想加载更多 */
  const ignoreScrollUntil = useRef(0);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // 恢复上次的滚动位置。等列表真正有数据（items 到位、容器高度算出来）再做，
  // 否则会把 scrollTop 设在旧内容的高度上，被浏览器夹到 0。
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current) return;
    const el = scrollRef.current;
    if (!el || items.length === 0) return;
    restored.current = true;
    if (initialScrollTop > 0) {
      ignoreScrollUntil.current = performance.now() + 200;
      el.scrollTop = initialScrollTop;
    }
  }, [items.length, initialScrollTop]);

  // 定位：只处理「还没成功过」的那次请求。
  // 目标行可能因为搜索过滤或分页还没进列表，此时不记为已处理，
  // 等 items 变化后这个 effect 会再跑一次。
  const lastLocated = useRef(0);

  useEffect(() => {
    if (locateTick === 0 || locateTick === lastLocated.current) return;
    const index = activeKey
      ? items.findIndex((item) => item.key === activeKey)
      : -1;
    if (index < 0) return;

    lastLocated.current = locateTick;
    // 虚拟列表里目标行可能还没挂载，不能靠 scrollIntoView
    virtualizer.scrollToIndex(index, { align: "center", behavior: "smooth" });
    setFlash(true);
  }, [locateTick, items, activeKey, virtualizer]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(false), 1300);
    return () => clearTimeout(timer);
  }, [flash]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    onScrollTop?.(el.scrollTop);
    if (!onReachEnd) return;
    if (performance.now() < ignoreScrollUntil.current) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < REACH_END_OFFSET) {
      onReachEnd();
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
        {loading ? "加载中…" : emptyText}
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto px-3 pb-2"
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index];
          const active = item.key === activeKey;
          const busy = busyKey === item.key;

          return (
            <div
              key={virtualItem.key}
              className="absolute top-0 left-0 w-full py-0.5"
              style={{
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
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
                  {String(virtualItem.index + 1).padStart(2, "0")}
                </span>

                <span
                  className={`min-w-0 flex-1 truncate text-[13.5px] ${
                    active
                      ? "text-brand-300"
                      : "text-zinc-300 group-hover:text-foreground"
                  }`}
                >
                  {item.title}
                </span>

                {item.sub && (
                  <span className="hidden max-w-32.5 shrink-0 truncate text-[11px] text-muted-foreground/60 sm:inline">
                    {item.sub}
                  </span>
                )}

                {item.sec != null && (
                  <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/60">
                    {formatTime(item.sec)}
                  </span>
                )}

                {/* 播放只由这个按钮触发，行本身不可点 */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onPlay(item)}
                  disabled={busy}
                  title={`播放 ${item.title}`}
                  aria-label={`播放 ${item.title}`}
                  className={`shrink-0 rounded-full hover:bg-primary/15 hover:text-brand-300 ${
                    active
                      ? "text-primary"
                      : "text-muted-foreground group-hover:text-brand-300"
                  }`}
                >
                  {busy ? (
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

      {footer}
    </div>
  );
}
