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

/** bilibili 封面常返回 http://，WebView/WKWebView 会按不安全资源拦截，统一升级为 https */
function httpsUrl(url: string | undefined): string {
  return (url || '').replace(/^http:\/\//i, 'https://')
}

/**
 * bilibili 插件把搜索结果视频的 bvid 放在 album 字段。
 * BV 号是识别「这是 bilibili 视频、可能有多 P」的信号；其它音源的 album 是专辑名/ID，不能拿来查分 P。
 */
const BVID_RE = /^BV[0-9A-Za-z]{10}$/

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
  /** 分 P 列表缓存：track.id → 该视频的全部分 P */
  private albums = new Map<string, MusicItemLike[]>()
  private albumPending = new Map<string, Promise<MusicItemLike[]>>()

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
      cover: it.artwork ? httpsUrl(String(it.artwork)) : undefined,
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
        // 有的插件（如 bilibili）没有 getMusicInfo/封面，但搜索结果自带 artwork
        cover: httpsUrl(info?.artwork || this.itemFor(track).artwork || track.cover),
        lrc: lrc?.rawLrc || '',
      }
    } catch {
      return null
    }
  }

  /** 该条目是否为 bilibili 多 P 视频（album 字段是 BV 号） */
  private isVideoItem(item: MusicItemLike): boolean {
    return BVID_RE.test(String(item.album ?? ''))
  }

  /** 拉取视频的分 P 列表（缓存 + 并发合并）；失败按「无分 P」处理，不打扰用户 */
  private albumItems(track: Track): Promise<MusicItemLike[]> {
    const cached = this.albums.get(track.id)
    if (cached) return Promise.resolve(cached)
    const pending = this.albumPending.get(track.id)
    if (pending) return pending

    const item = this.itemFor(track)
    const p = this.host
      .call<{ musicList?: MusicItemLike[] }>('getAlbumInfo', [item], 20_000)
      .then((res) => {
        const list = (res?.musicList || []).filter(it => it && it.id !== undefined && it.id !== null)
        this.albums.set(track.id, list)
        return list
      })
      .catch(() => {
        this.albums.set(track.id, [])
        return [] as MusicItemLike[]
      })
      .finally(() => this.albumPending.delete(track.id))
    this.albumPending.set(track.id, p)
    return p
  }

  /** 探测分 P 数；非视频类条目直接返回 0，避免无谓请求 */
  async probeParts(track: Track): Promise<number> {
    if (!this.isVideoItem(this.itemFor(track))) return 0
    return (await this.albumItems(track)).length
  }

  /** 拉全部分 P；单 P 视频返回空数组（调用方按普通单曲下载） */
  async getParts(track: Track): Promise<Track[]> {
    if (!this.isVideoItem(this.itemFor(track))) return []
    const list = await this.albumItems(track)
    if (list.length <= 1) return []
    return list.map((it, i) => {
      // 分 P 的 id 可能仍是 bvid，用「bvid:cid」做唯一键，避免多条在缓存里互相覆盖
      const key = `${track.id}:${String(it.cid ?? it.id ?? i)}`
      this.items.set(key, it)
      return {
        id: key,
        title: String(it.title ?? `${track.title} · P${i + 1}`),
        author: String(it.artist ?? it.author ?? track.author),
        source: this.code,
        cover: it.artwork ? httpsUrl(String(it.artwork)) : track.cover,
      }
    })
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
      coverUrl: meta?.cover || track.cover || '',
      lrc: meta?.lrc || '',
      headers: src.headers,
    })
  }

  dispose(): void {
    this.host.dispose()
  }
}
