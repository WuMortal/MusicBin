export interface Track {
  id: string
  title: string
  author: string
  source: string
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
