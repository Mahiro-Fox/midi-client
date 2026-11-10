import { listCelestiaSongs, listRemoteFiles, type SongSort } from "./api";
import {
  trackFromFile,
  trackFromSong,
  type SourceId,
  type TrackItem,
} from "./tracks";

/** 一页曲目：条目、总量、是否还有下一页 */
export type TrackPage = {
  items: TrackItem[];
  total: number;
  hasMore: boolean;
};

export type TrackPageQuery = {
  /** 搜索关键字，两个源都走服务端 */
  query: string;
  /** 仅星穹音乐厅支持排序 */
  sort: SongSort;
  /** 页码，从 1 开始 */
  page: number;
  limit: number;
};

/**
 * 两个曲库的分页差异收敛到这里：
 * 原曲库传页码（page/limit），星穹音乐厅传条目偏移（offset/limit）。
 * 调用方只关心「第几页」，不用记各家的参数语义。
 */
export async function loadTrackPage(
  source: SourceId,
  { query, sort, page, limit }: TrackPageQuery,
): Promise<TrackPage> {
  const keyword = query.trim();

  if (source === "midisongs") {
    const result = await listRemoteFiles(keyword, page, limit);
    return {
      items: result.items.map(trackFromFile),
      total: result.total,
      hasMore: result.hasMore,
    };
  }

  const offset = (page - 1) * limit;
  const result = await listCelestiaSongs(keyword, sort, offset, limit);
  return {
    items: result.items.map(trackFromSong),
    total: result.total,
    hasMore: offset + result.items.length < result.total,
  };
}
