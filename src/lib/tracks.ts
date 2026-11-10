import type { MidiFileItem, SongSummary } from "./api";
import { prettyName } from "./format";

/** 曲库来源：原曲库（mahirooyama）、星穹音乐厅（celestia） */
export type SourceId = "midisongs" | "celestia";

export const SOURCES: { id: SourceId; label: string; host: string }[] = [
  { id: "midisongs", label: "原曲库", host: "mahirooyama.cn" },
  { id: "celestia", label: "星穹音乐厅", host: "celestia.chiooone.com" },
];

/**
 * 两个曲库的条目归一到这里，列表只认这一种结构。
 *
 * 差异点：原曲库只有文件名与修改时间，星穹音乐厅有 id/时长/上传者。
 * 缺的字段留空，列表按有没有 `sec` / `sub` 决定是否渲染那一段。
 * 两个源现在都由服务端分页 + 搜索，前端只负责按 offset 取下一页。
 */
export type TrackItem = {
  /** 全局唯一：`midisongs:<文件名>` / `celestia:<id>`，用于高亮与定位 */
  key: string;
  title: string;
  source: SourceId;
  /** 上传者、修改时间等次要信息 */
  sub?: string;
  /** 时长（秒） */
  sec?: number;
  notes?: number;
  /** 原曲库：下载用的文件名 */
  fileName?: string;
  /** 星穹音乐厅：曲目 id */
  songId?: number;
};

/** 条目 key 的组装规则集中在这里，App 判断高亮/定位时也用它 */
export const fileKey = (fileName: string) => `midisongs:${fileName}`;
export const songKey = (id: number) => `celestia:${id}`;

/** 反查 key 属于哪个源，换源后不该跑到另一个曲库里找目标 */
export function keySource(key: string): SourceId | null {
  const id = key.slice(0, key.indexOf(":"));
  return id === "midisongs" || id === "celestia" ? id : null;
}

/** RFC3339 → 本地日期（YYYY-MM-DD），解析不出来就不显示 */
function shortDate(value: string): string | undefined {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return undefined;
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function trackFromFile(file: MidiFileItem): TrackItem {
  return {
    key: fileKey(file.fileName),
    title: file.name || prettyName(file.fileName),
    source: "midisongs",
    sub: file.lastModified ? shortDate(file.lastModified) : undefined,
    fileName: file.fileName,
  };
}

export function trackFromSong(song: SongSummary): TrackItem {
  return {
    key: songKey(song.id),
    title: song.title,
    source: "celestia",
    sub: song.uploader || undefined,
    sec: song.sec || undefined,
    notes: song.notes || undefined,
    songId: song.id,
  };
}
