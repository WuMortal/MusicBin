export interface Track {
  id: string
  title: string
  author: string
  source: string
  /** 封面（插件源搜索结果里的 artwork，仅用于展示，取元信息时可能被覆盖） */
  cover?: string
  /** 分 P 数：>1 表示多 P 合集（如 bilibili 多 P 视频），用于展示标识与下载前选择 */
  partCount?: number
}

export interface PlayResult {
  url: string
  isWhiteUrl: boolean
  ut: boolean
}

export interface DownloadResult {
  path: string
  size: number
}

export interface DownloadProgress {
  file: string
  downloaded: number
  total: number
  done?: boolean
}

export interface TrackMeta {
  title: string
  author: string
  cover: string
  lrc: string
}

export interface DownloadRecord {
  key: string
  title: string
  author: string
  path: string
  size: number
  time: string
}

export interface PlayRecord { id: string; title: string; author: string; time: string; source?: string }
