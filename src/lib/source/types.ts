import type { DownloadResult, Track, TrackMeta } from '../../types'

/** 播放直链（插件源可能带防盗链请求头） */
export interface SourcePlayUrl {
  url: string
  headers?: Record<string, string>
}

/** 音乐源统一接口：内置源与 MusicFree 插件源都实现它 */
export interface MusicSource {
  code: string
  name: string
  builtIn: boolean
  search(keyword: string): Promise<Track[]>
  guess?(keyword: string): Promise<Track[]>
  getPlayUrl(track: Track): Promise<SourcePlayUrl>
  getTrackMeta?(track: Track): Promise<TrackMeta | null>
  download(track: Track, dir: string): Promise<DownloadResult>
}
