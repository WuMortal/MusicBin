export interface Track {
  id: string
  title: string
  author: string
  source: string
  /** 封面（插件源搜索结果里的 artwork，仅用于展示，取元信息时可能被覆盖） */
  cover?: string
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
