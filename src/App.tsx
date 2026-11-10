import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { Library, LocateFixed, Music4, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import FileList from "@/components/FileList";
import Header from "@/components/Header";
import PlayerBar from "@/components/PlayerBar";
import UpdateDialog from "@/components/UpdateDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  checkUpdate,
  getPlaybackState,
  installUpdate,
  listPorts,
  playCelestia,
  playLocal,
  playRemote,
  stopPlayback,
  type PlaybackState,
  type PortInfo,
  type Progress,
  type SongSort,
  type UpdateInfo,
  type UpdateProgress,
} from "@/lib/api";
import { errorText } from "@/lib/format";
import { loadTrackPage } from "@/lib/library";
import {
  SOURCES,
  keySource,
  type SourceId,
  type TrackItem,
} from "@/lib/tracks";

const EMPTY_STATE: PlaybackState = { playing: false, title: null, duration: 0 };
/** 每页条数（原曲库上限 100，星穹上限 100） */
const PAGE_SIZE = 40;
/** 搜索防抖：现在是服务端搜索，逐字打接口太浪费 */
const SEARCH_DELAY = 260;

const SORTS: { value: SongSort; label: string }[] = [
  { value: "new", label: "最新上传" },
  { value: "old", label: "最早上传" },
  { value: "title", label: "标题排序" },
  { value: "long", label: "时长从长到短" },
];

export default function App() {
  const [version, setVersion] = useState("");
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [portIndex, setPortIndex] = useState<number | null>(null);

  const [source, setSource] = useState<SourceId>("midisongs");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SongSort>("new");

  // 两个源都是「服务端搜索 + 分页」，所以共用同一套列表状态
  const [items, setItems] = useState<TrackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  /** 已加载到第几页（从 1 开始），换源/换条件后由首屏加载重置 */
  const pageRef = useRef(0);
  /** 每次重置拉取 +1，用于丢弃过期响应 */
  const listToken = useRef(0);
  /** 点了定位但目标还没加载出来时记在这里，首屏数据到了再决定是否滚过去 */
  const pendingLocate = useRef<string | null>(null);

  const [state, setState] = useState<PlaybackState>(EMPTY_STATE);
  const [progress, setProgress] = useState<Progress>({ position: 0, duration: 0 });
  /** 正在加载的条目 key */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /** 当前播放条目 key，用于高亮与定位 */
  const [activeKey, setActiveKey] = useState<string | null>(null);
  /** 每次点击「定位」+1，FileList 据此滚动到当前曲目 */
  const [locateTick, setLocateTick] = useState(0);

  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [updatePercent, setUpdatePercent] = useState<number | null>(null);

  const refreshPorts = useCallback(async () => {
    try {
      const list = await listPorts();
      setPorts(list);
      setPortIndex((prev) => {
        if (prev !== null && list.some((p) => p.index === prev)) return prev;
        const preferred = list.find((p) =>
          /loopmidi|midi\s*through|virtual/i.test(p.name),
        );
        return preferred?.index ?? list[0]?.index ?? null;
      });
    } catch (error) {
      toast.error(errorText(error));
    }
  }, []);

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
    void refreshPorts();
    void getPlaybackState()
      .then((s) => {
        setState(s);
        if (s.duration > 0) setProgress({ position: 0, duration: s.duration });
      })
      .catch(() => undefined);
  }, [refreshPorts]);

  // 换源时先清空，避免短暂显示另一个曲库的内容
  useEffect(() => {
    pageRef.current = 0;
    pendingLocate.current = null;
    setItems([]);
    setTotal(0);
    setHasMore(false);
  }, [source]);

  // 首屏 / 条件变化：拉第一页
  useEffect(() => {
    const token = ++listToken.current;
    setLoading(true);
    setHasMore(false);
    // 条件变了，还在飞的「加载更多」已经作废：它的 finally 会因为 token 不符而跳过重置，
    // 这里必须一起清掉，否则列表再也翻不了页
    setLoadingMore(false);

    const timer = setTimeout(() => {
      void loadTrackPage(source, { query, sort, page: 1, limit: PAGE_SIZE })
        .then((page) => {
          if (token !== listToken.current) return;
          pageRef.current = 1;
          setItems(page.items);
          setTotal(page.total);
          setHasMore(page.hasMore);

          // 点了定位且期间清空过搜索词：数据回来了再决定要不要滚过去
          const target = pendingLocate.current;
          if (!target) return;
          pendingLocate.current = null;
          if (page.items.some((item) => item.key === target)) {
            setLocateTick((tick) => tick + 1);
          } else {
            toast.info("该曲目不在已加载的列表里，继续向下滚动即可找到");
          }
        })
        .catch((error) => {
          if (token !== listToken.current) return;
          // 旧列表已经不匹配当前条件，清空比显示错的更清楚
          pageRef.current = 0;
          setItems([]);
          setTotal(0);
          toast.error(errorText(error));
        })
        .finally(() => {
          if (token === listToken.current) setLoading(false);
        });
    }, SEARCH_DELAY);

    return () => clearTimeout(timer);
  }, [source, query, sort, refreshTick]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    const token = listToken.current;
    const nextPage = pageRef.current + 1;

    setLoadingMore(true);
    void loadTrackPage(source, { query, sort, page: nextPage, limit: PAGE_SIZE })
      .then((page) => {
        if (token !== listToken.current) return;
        pageRef.current = nextPage;
        setItems((prev) => {
          // 期间可能有新曲目插到前面，分页边界会重复，按 key 去重
          const seen = new Set(prev.map((item) => item.key));
          return [...prev, ...page.items.filter((item) => !seen.has(item.key))];
        });
        setTotal(page.total);
        setHasMore(page.hasMore);
      })
      .catch((error) => {
        if (token === listToken.current) toast.error(errorText(error));
      })
      .finally(() => {
        if (token === listToken.current) setLoadingMore(false);
      });
  }, [loading, loadingMore, hasMore, source, query, sort]);

  useEffect(() => {
    const disposers: Array<() => void> = [];
    let active = true;

    void (async () => {
      const registered = await Promise.all([
        listen<Progress>("playback://progress", (event) =>
          setProgress(event.payload),
        ),
        listen<PlaybackState>("playback://state", (event) =>
          setState(event.payload),
        ),
        listen<string>("playback://error", (event) =>
          toast.error(event.payload),
        ),
        listen<UpdateProgress>("update-progress", (event) => {
          const { downloaded = 0, total } = event.payload;
          setUpdatePercent(
            total
              ? Math.min(100, Math.round((downloaded / total) * 100))
              : null,
          );
        }),
      ]);
      if (active) disposers.push(...registered);
      else registered.forEach((dispose) => dispose());
    })();

    return () => {
      active = false;
      disposers.forEach((dispose) => dispose());
    };
  }, []);

  // 播放结束后清掉高亮，避免停在上一次的曲目上
  useEffect(() => {
    if (!state.playing) setActiveKey(null);
  }, [state.playing]);

  // 当前曲目是否属于正在浏览的源（分页后它不一定已经加载出来）
  const activeInSource = activeKey !== null && keySource(activeKey) === source;

  const requirePort = useCallback(() => {
    if (portIndex === null) {
      toast.error("请先选择一个 MIDI 输出端口");
      return false;
    }
    return true;
  }, [portIndex]);

  const handlePlay = useCallback(
    async (item: TrackItem) => {
      if (!requirePort()) return;
      setBusyKey(item.key);
      setActiveKey(item.key);
      try {
        if (item.source === "celestia" && item.songId != null) {
          await playCelestia(item.songId, item.title, portIndex as number);
        } else if (item.fileName) {
          await playRemote(item.fileName, portIndex as number);
        }
      } catch (error) {
        toast.error(errorText(error));
        setActiveKey(null);
      } finally {
        setBusyKey(null);
      }
    },
    [portIndex, requirePort],
  );

  const handleStop = useCallback(async () => {
    try {
      await stopPlayback();
      setProgress((prev) => ({ position: 0, duration: prev.duration }));
    } catch (error) {
      toast.error(errorText(error));
    }
  }, []);

  const handleLocate = useCallback(() => {
    if (!activeKey) return;
    if (items.some((item) => item.key === activeKey)) {
      setLocateTick((tick) => tick + 1);
      return;
    }
    // 服务端搜索把目标挡在结果之外：清空关键字重拉第一页，
    // 数据回来后由上面的 then 决定是否滚动（目标可能仍在后面的页里）
    if (query.trim()) {
      pendingLocate.current = activeKey;
      setQuery("");
      return;
    }
    toast.info("该曲目不在已加载的列表里，继续向下滚动即可找到");
  }, [activeKey, items, query]);

  const handleRefresh = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  const handlePickLocal = useCallback(async () => {
    if (!requirePort()) return;
    setBusyKey("local");
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        title: "选择本地 MIDI 文件",
        filters: [{ name: "MIDI 文件", extensions: ["mid", "midi"] }],
      });
      const path =
        typeof picked === "string"
          ? picked
          : Array.isArray(picked)
            ? picked[0]
            : null;
      if (!path) return;

      await playLocal(path, portIndex as number);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusyKey(null);
    }
  }, [portIndex, requirePort]);

  const handleCheckUpdate = useCallback(async () => {
    setChecking(true);
    try {
      const info = await checkUpdate();
      if (!info) {
        toast.success(`已是最新版本${version ? `（v${version}）` : ""}`);
        return;
      }
      setUpdate(info);
      setUpdatePercent(null);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setChecking(false);
    }
  }, [version]);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    try {
      await installUpdate();
    } catch (error) {
      toast.error(errorText(error));
      setInstalling(false);
    }
  }, []);

  const countLabel = `${items.length} / ${total}`;

  const footer = (
    <div className="py-3 text-center text-[11px] text-muted-foreground/60">
      {loadingMore
        ? "加载中…"
        : hasMore
          ? "继续向下滚动加载更多"
          : `已全部加载 · 共 ${total} 首`}
    </div>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col bg-background">
        <Header
          ports={ports}
          portIndex={portIndex}
          version={version}
          checking={checking}
          onPortChange={setPortIndex}
          onRefreshPorts={() => void refreshPorts()}
          onCheckUpdate={() => void handleCheckUpdate()}
        />

        <div className="flex shrink-0 items-center gap-2 px-4 py-2.5">
          <Tabs value={source} onValueChange={(value) => setSource(value as SourceId)}>
            <TabsList>
              {SOURCES.map((entry) => (
                <TabsTrigger key={entry.id} value={entry.id} title={entry.host}>
                  {entry.id === "midisongs" ? <Library /> : <Music4 />}
                  {entry.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                source === "midisongs" ? "搜索曲名" : "搜索星穹曲库"
              }
              spellCheck={false}
              className="h-9 pl-9 text-[13px]"
            />
          </div>

          {source === "celestia" && (
            <Select value={sort} onValueChange={(value) => setSort(value as SongSort)}>
              <SelectTrigger size="sm" className="w-[104px] shrink-0 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={6} align="end">
                {SORTS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground/70">
            {loading ? "加载中…" : countLabel}
          </span>

          {activeInSource && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleLocate}
                  aria-label="定位到当前曲目"
                  className="rounded-md text-muted-foreground hover:text-brand-300"
                >
                  <LocateFixed />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">定位到当前曲目</TooltipContent>
            </Tooltip>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={loading}
            className="shrink-0"
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
            刷新
          </Button>
        </div>

        <FileList
          // 换源时重挂载，顺带把滚动位置和虚拟列表状态复位
          key={source}
          items={items}
          activeKey={activeKey}
          playing={state.playing}
          busyKey={busyKey}
          locateTick={locateTick}
          loading={loading}
          onPlay={(item) => void handlePlay(item)}
          onReachEnd={loadMore}
          footer={footer}
          emptyText={query.trim() ? "没有匹配的曲目" : "曲库为空"}
        />

        <PlayerBar
          playing={state.playing}
          title={state.title}
          position={progress.position}
          duration={progress.duration || state.duration}
          busy={busyKey}
          onStop={() => void handleStop()}
          onPickLocal={() => void handlePickLocal()}
        />

        <UpdateDialog
          info={update}
          installing={installing}
          percent={updatePercent}
          onClose={() => {
            if (!installing) setUpdate(null);
          }}
          onInstall={() => void handleInstall()}
        />

        <Toaster position="bottom-right" />
      </div>
    </TooltipProvider>
  );
}
