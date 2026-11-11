import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { Library, LocateFixed, Music4, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import FileList from "@/components/FileList";
import Header from "@/components/Header";
import PlayerBar from "@/components/PlayerBar";
import SettingsDialog from "@/components/SettingsDialog";
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
import { DEFAULT_SETTINGS, getSettings, saveSettings, type Settings } from "@/lib/settings";
import {
  SOURCES,
  keySource,
  type SourceId,
  type TrackItem,
} from "@/lib/tracks";

const EMPTY_STATE: PlaybackState = { playing: false, title: null, duration: 0 };
/** 搜索防抖：现在是服务端搜索，逐字打接口太浪费 */
const SEARCH_DELAY = 260;

const SORTS: { value: SongSort; label: string }[] = [
  { value: "new", label: "最新上传" },
  { value: "old", label: "最早上传" },
  { value: "title", label: "标题排序" },
  { value: "long", label: "时长从长到短" },
];

const toSource = (value: string): SourceId =>
  value === "celestia" ? "celestia" : "midisongs";

/** 每个源各自的关键字与排序：切标签时不该带着另一个源的条件重新请求 */
type SourceFilter = { query: string; sort: SongSort };

/** 每个源缓存一份列表；条件（关键字 / 排序 / 每页条数）一变这份缓存就作废 */
type CachedList = {
  query: string;
  sort: SongSort;
  pageSize: number;
  items: TrackItem[];
  total: number;
  hasMore: boolean;
  /** 已加载到第几页（从 1 开始） */
  page: number;
  /** 上次的滚动位置，切回来时恢复 */
  scrollTop: number;
};

export default function App() {
  const [version, setVersion] = useState("");
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [portIndex, setPortIndex] = useState<number | null>(null);

  /** null 表示还没读到（此时列表不请求，避免用默认值白拉一次） */
  const [settings, setSettings] = useState<Settings | null>(null);
  /** 异步回调里要读到最新设置，state 闭包会过期 */
  const settingsRef = useRef<Settings | null>(null);
  settingsRef.current = settings;
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [source, setSource] = useState<SourceId>("midisongs");
  // 关键字与排序按源各存一份：切标签时不会把 A 源的搜索词带到 B 源，
  // 也就不会因为条件变化把 B 源的缓存顶掉
  const [filters, setFilters] = useState<Record<SourceId, SourceFilter>>({
    midisongs: { query: "", sort: "new" },
    celestia: { query: "", sort: "new" },
  });
  const { query, sort } = filters[source];
  const setQuery = useCallback(
    (value: string) =>
      setFilters((prev) => ({
        ...prev,
        [source]: { ...prev[source], query: value },
      })),
    [source],
  );
  const setSort = useCallback(
    (value: SongSort) =>
      setFilters((prev) => ({
        ...prev,
        [source]: { ...prev[source], sort: value },
      })),
    [source],
  );

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
  /** 每个源缓存一份列表：切标签直接铺数据，只有点「刷新」才重新请求 */
  const listCache = useRef(new Map<SourceId, CachedList>());
  /** 异步回调里要读到最新列表（闭包里的 items 是旧的） */
  const itemsRef = useRef<TrackItem[]>([]);
  itemsRef.current = items;

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

  const ready = settings !== null;
  const pageSize = settings?.pageSize ?? DEFAULT_SETTINGS.pageSize;

  /** 局部更新设置：先落内存（界面立刻响应），再交给后端归一化并保存 */
  const patchSettings = useCallback((patch: Partial<Settings>) => {
    const current = settingsRef.current;
    if (!current) return;
    const next = { ...current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    void saveSettings(next)
      .then((saved) => {
        // 后端可能 clamp 过（如每页条数），以后端返回的为准；
        // 期间用户又改了就不覆盖，等下一轮保存的结果
        if (settingsRef.current === next) {
          settingsRef.current = saved;
          setSettings(saved);
        }
      })
      .catch((error) => toast.error(errorText(error)));
  }, []);

  const refreshPorts = useCallback(async () => {
    try {
      const list = await listPorts();
      setPorts(list);
      const remembered = settingsRef.current?.rememberPort
        ? settingsRef.current.portName.trim()
        : "";
      setPortIndex((prev) => {
        if (prev !== null && list.some((p) => p.index === prev)) return prev;
        // 上次用的端口还在就接着用它（序号会变，所以按名字找）
        if (remembered) {
          const hit = list.find((p) => p.name === remembered);
          if (hit) return hit.index;
        }
        const preferred = list.find((p) =>
          /loopmidi|midi\s*through|virtual/i.test(p.name),
        );
        return preferred?.index ?? list[0]?.index ?? null;
      });
    } catch (error) {
      toast.error(errorText(error));
    }
  }, []);

  // 启动：先读设置（决定默认曲库与端口），再拉端口和播放状态
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let loaded = DEFAULT_SETTINGS;
      try {
        loaded = await getSettings();
      } catch (error) {
        toast.error(errorText(error));
      }
      if (cancelled) return;
      settingsRef.current = loaded;
      setSettings(loaded);
      setSource(toSource(loaded.lastSource));
      void refreshPorts();
    })();

    void getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
    void getPlaybackState()
      .then((s) => {
        setState(s);
        if (s.duration > 0) setProgress({ position: 0, duration: s.duration });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [refreshPorts]);

  /** 条件匹配的缓存；没有、或已被「刷新 / 改每页条数」作废时返回 null */
  const cachedFor = useCallback(
    (id: SourceId, keyword: string, sortValue: SongSort) => {
      const entry = listCache.current.get(id);
      if (!entry) return null;
      if (entry.pageSize !== pageSize) return null;
      if (entry.query !== keyword || entry.sort !== sortValue) return null;
      return entry;
    },
    [pageSize],
  );

  /** 把缓存铺回界面 */
  const applyCached = useCallback((entry: CachedList) => {
    pageRef.current = entry.page;
    setItems(entry.items);
    setTotal(entry.total);
    setHasMore(entry.hasMore);
    setLoading(false);
    setLoadingMore(false);
  }, []);

  /** 数据到手（缓存或请求）后处理「定位」：目标在列表里就滚过去 */
  const settleLocate = useCallback((list: TrackItem[]) => {
    const target = pendingLocate.current;
    if (!target) return;
    pendingLocate.current = null;
    if (list.some((item) => item.key === target)) {
      setLocateTick((tick) => tick + 1);
    } else {
      toast.info("该曲目不在已加载的列表里，继续向下滚动即可找到");
    }
  }, []);

  // 首屏 / 条件变化：命中缓存就直接铺数据，否则才拉第一页。
  // 强制重新请求只有两个入口：点「刷新」（先删缓存再 bump tick），
  // 以及改每页条数（pageSize 变了下面对不上，缓存自然失效）。
  useEffect(() => {
    if (!ready) return;

    const token = ++listToken.current;
    // 条件变了，还在飞的「加载更多」已经作废：它的 finally 会因为 token 不符而跳过重置，
    // 这里必须一起清掉，否则列表再也翻不了页
    setLoadingMore(false);

    const keyword = query.trim();
    const cached = cachedFor(source, keyword, sort);

    if (cached) {
      applyCached(cached);
      settleLocate(cached.items);
      return;
    }

    setLoading(true);
    setHasMore(false);

    const timer = setTimeout(() => {
      void loadTrackPage(source, { query: keyword, sort, page: 1, limit: pageSize })
        .then((page) => {
          if (token !== listToken.current) return;
          pageRef.current = 1;
          setItems(page.items);
          setTotal(page.total);
          setHasMore(page.hasMore);
          listCache.current.set(source, {
            query: keyword,
            sort,
            pageSize,
            items: page.items,
            total: page.total,
            hasMore: page.hasMore,
            page: 1,
            scrollTop: 0,
          });
          settleLocate(page.items);
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
  }, [
    ready,
    source,
    query,
    sort,
    refreshTick,
    pageSize,
    cachedFor,
    applyCached,
    settleLocate,
  ]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    const token = listToken.current;
    const nextPage = pageRef.current + 1;
    const keyword = query.trim();

    setLoadingMore(true);
    void loadTrackPage(source, { query: keyword, sort, page: nextPage, limit: pageSize })
      .then((page) => {
        if (token !== listToken.current) return;
        pageRef.current = nextPage;
        // 期间可能有新曲目插到前面，分页边界会重复，按 key 去重
        const seen = new Set(itemsRef.current.map((item) => item.key));
        const merged = [
          ...itemsRef.current,
          ...page.items.filter((item) => !seen.has(item.key)),
        ];
        setItems(merged);
        setTotal(page.total);
        setHasMore(page.hasMore);
        // 追加进来的页也要写回缓存，否则切回来只剩第一页
        listCache.current.set(source, {
          query: keyword,
          sort,
          pageSize,
          items: merged,
          total: page.total,
          hasMore: page.hasMore,
          page: nextPage,
          scrollTop: listCache.current.get(source)?.scrollTop ?? 0,
        });
      })
      .catch((error) => {
        if (token === listToken.current) toast.error(errorText(error));
      })
      .finally(() => {
        if (token === listToken.current) setLoadingMore(false);
      });
  }, [loading, loadingMore, hasMore, source, query, sort, pageSize]);

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
  }, [activeKey, items, query, setQuery]);

  const handleRefresh = useCallback(() => {
    // 刷新是唯一会强制重新请求的入口：先作废当前源的缓存，再触发首屏 effect。
    // token 立刻 +1，把可能还在飞的「加载更多」就地作废，别让它追加到新列表里
    listCache.current.delete(source);
    listToken.current += 1;
    setRefreshTick((tick) => tick + 1);
  }, [source]);

  /** 滚动位置只写进缓存，不触发重渲染 */
  const handleListScroll = useCallback(
    (top: number) => {
      const entry = listCache.current.get(source);
      if (entry) entry.scrollTop = top;
    },
    [source],
  );

  const handleSourceChange = useCallback(
    (value: string) => {
      const next = toSource(value);
      if (next === source) return;
      // 上一个源的「加载更多」如果还在飞，立刻作废：否则它的响应会追加到新列表里
      listToken.current += 1;

      // 切源前先把目标源的缓存铺进 state，和 setSource 在同一批里提交，
      // 不会出现「标签已经切过去、列表还挂着上一个源」的那一帧
      const filter = filters[next];
      const entry = cachedFor(next, filter.query.trim(), filter.sort);
      pendingLocate.current = null;
      if (entry) {
        applyCached(entry);
      } else {
        pageRef.current = 0;
        setItems([]);
        setTotal(0);
        setHasMore(false);
        setLoading(true);
      }
      setSource(next);

      // 记住上次浏览的曲库，下次启动直接进这里
      if (settingsRef.current && settingsRef.current.lastSource !== next) {
        patchSettings({ lastSource: next });
      }
    },
    [source, filters, cachedFor, applyCached, patchSettings],
  );

  const handlePortChange = useCallback(
    (index: number) => {
      setPortIndex(index);
      const name = ports.find((port) => port.index === index)?.name;
      if (name && settingsRef.current?.rememberPort) {
        patchSettings({ portName: name });
      }
    },
    [ports, patchSettings],
  );

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

  /** silent：启动时自动检查，已是最新就别弹 toast 打扰 */
  const handleCheckUpdate = useCallback(
    async (silent = false) => {
      setChecking(true);
      try {
        const info = await checkUpdate();
        if (!info) {
          if (!silent) toast.success(`已是最新版本${version ? `（v${version}）` : ""}`);
          return;
        }
        setUpdate(info);
        setUpdatePercent(null);
      } catch (error) {
        // 自动检查失败不打扰用户（常见于没网 / 代理），手动检查才报错
        if (!silent) toast.error(errorText(error));
      } finally {
        setChecking(false);
      }
    },
    [version],
  );

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    try {
      await installUpdate();
    } catch (error) {
      toast.error(errorText(error));
      setInstalling(false);
    }
  }, []);

  // 托盘菜单：设置 / 检查更新
  // 收进托盘的提示已改用 Windows 原生通知（Rust 侧 toast.rs），窗口藏起来后前端 toast 看不见
  useEffect(() => {
    const disposers: Array<() => void> = [];
    let active = true;

    void (async () => {
      const registered = await Promise.all([
        listen("tray://settings", () => setSettingsOpen(true)),
        listen("tray://check-update", () => void handleCheckUpdate()),
      ]);
      if (active) disposers.push(...registered);
      else registered.forEach((dispose) => dispose());
    })();

    return () => {
      active = false;
      disposers.forEach((dispose) => dispose());
    };
  }, [handleCheckUpdate]);

  // 启动后按设置自动检查一次更新
  const autoChecked = useRef(false);
  useEffect(() => {
    if (!ready || autoChecked.current) return;
    autoChecked.current = true;
    if (!settings?.autoCheckUpdate) return;
    const timer = setTimeout(() => void handleCheckUpdate(true), 1200);
    return () => clearTimeout(timer);
  }, [ready, settings, handleCheckUpdate]);

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
          onPortChange={handlePortChange}
          onRefreshPorts={() => void refreshPorts()}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <div className="flex shrink-0 items-center gap-2 px-4 py-2.5">
          <Tabs value={source} onValueChange={handleSourceChange}>
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
              <SelectTrigger size="sm" className="w-26 shrink-0 text-xs">
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
          // 换源或刷新时重挂载：换源要复位虚拟列表，刷新要回到顶部（只剩第 1 页，
          // 留在原来的位置会被夹到列表底部，看起来像是没刷新）
          key={`${source}:${refreshTick}`}
          items={items}
          activeKey={activeKey}
          playing={state.playing}
          busyKey={busyKey}
          locateTick={locateTick}
          loading={loading}
          initialScrollTop={listCache.current.get(source)?.scrollTop ?? 0}
          onScrollTop={handleListScroll}
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

        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings ?? DEFAULT_SETTINGS}
          onChange={patchSettings}
          version={version}
          checking={checking}
          onCheckUpdate={() => void handleCheckUpdate()}
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
