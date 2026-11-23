import { invoke } from '@tauri-apps/api/core'
import { PluginHost } from '../sandbox/PluginHost'
import type { DownloadResult, Track, TrackMeta } from '../../types'
import type { MusicSource, SourcePlayUrl } from './types'

/** MusicFree 插件的 musicItem（宽松结构） */
interface MusicItemLike {
  id: string | number
  title?: string
  artist?: string
  author?: string
  album?: string
  artwork?: string
  [k: string]: unknown
}

interface MediaSourceResult { url?: string; headers?: Record<string, string> }
interface PluginSearchResult { isEnd?: boolean; data?: MusicItemLike[] }
interface MusicInfoResult { title?: string; artist?: string; album?: string; artwork?: string }
interface LyricResult { rawLrc?: string }

/**
 * 插件音源：包装一个 PluginHost 沙箱实例。
 * search 缓存原始 musicItem（getMediaSource 需要完整字段而不只是 id），
 * 播放记录重放等无缓存场景以 Track 信息兜底。
 */
export class PluginSource implements MusicSource {
  readonly builtIn = false
  readonly name: string
  private host: PluginHost
  private items = new Map<string, MusicItemLike>()

  constructor(
    readonly code: string,
    displayName: string,
    js: string,
    env: Record<string, string>,
  ) {
    this.name = displayName
    this.host = new PluginHost(code, js, env)
  }

  async search(keyword: string): Promise<Track[]> {
    const res = await this.host.call<PluginSearchResult>('search', [keyword, 1, 'music'])
    const list = (res?.data || []).filter(it => it && it.id !== undefined && it.id !== null)
    for (const it of list) this.items.set(String(it.id), it)
    return list.map(it => ({
      id: String(it.id),
      title: String(it.title ?? '未知歌曲'),
      author: String(it.artist ?? it.author ?? ''),
      source: this.code,
    }))
  }

  private itemFor(track: Track): MusicItemLike {
    const cached = this.items.get(track.id)
    if (cached) return cached
    return { id: track.id, title: track.title, artist: track.author }
  }

  async getPlayUrl(track: Track): Promise<SourcePlayUrl> {
    const r = await this.host.call<MediaSourceResult>('getMediaSource', [
      this.itemFor(track), 'standard',
    ])
    if (!r || typeof r.url !== 'string' || !r.url) {
      throw new Error('该歌曲暂时无法获取音源')
    }
    return { url: r.url, headers: r.headers }
  }

  async getTrackMeta(track: Track): Promise<TrackMeta | null> {
    try {
      const [info, lrc] = await Promise.all([
        this.host.call<MusicInfoResult | null>('getMusicInfo', [this.itemFor(track)]).catch(() => null),
        this.host.call<LyricResult | null>('getLyric', [this.itemFor(track)]).catch(() => null),
      ])
      return {
        title: info?.title || track.title,
        author: info?.artist || track.author,
        cover: info?.artwork || '',
        lrc: lrc?.rawLrc || '',
      }
    } catch {
      return null
    }
  }

  async download(track: Track, dir: string): Promise<DownloadResult> {
    const src = await this.getPlayUrl(track)
    const meta = await this.getTrackMeta(track)
    const title = meta?.title || track.title
    const author = meta?.author || track.author
    // 文件名沿用搜索结果标题，保证与前端进度 key 一致；元信息进 ID3
    const fileName = `${track.title} - ${track.author}`.trim()
    return invoke<DownloadResult>('plugin_download_track', {
      url: src.url,
      fileName,
      dir,
      title,
      author,
      coverUrl: meta?.cover || '',
      lrc: meta?.lrc || '',
      headers: src.headers,
    })
  }

  dispose(): void {
    this.host.dispose()
  }
}
