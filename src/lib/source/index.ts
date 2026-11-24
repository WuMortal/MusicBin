import { invoke } from '@tauri-apps/api/core'
import type { DownloadResult, Track, TrackMeta } from '../../types'
import { getActiveSourceCode, getPluginEnv, getPlugins } from '../settings'
import { BuiltinSource, BUILTIN_CODE } from './builtin'
import { PluginSource } from './plugin'
import type { MusicSource, SourcePlayUrl } from './types'

const builtin = new BuiltinSource()
const pluginSources = new Map<string, PluginSource>()

export { BUILTIN_CODE }

/** 全部可用源：内置 + 已安装插件 */
export function listSources(): MusicSource[] {
  const plugins = getPlugins().map(p => {
    let s = pluginSources.get(p.code)
    if (!s) {
      s = new PluginSource(p.code, p.name, p.js, getPluginEnv(p.code))
      pluginSources.set(p.code, s)
    }
    return s as MusicSource
  })
  return [builtin as MusicSource, ...plugins]
}

/** 按 code 解析源；未安装的源（插件被删）抛错由调用方 toast */
export function resolveSource(code?: string): MusicSource {
  if (!code || code === BUILTIN_CODE || code === 'guess') return builtin
  const rec = getPlugins().find(p => p.code === code)
  if (!rec) throw new Error(`音源「${code}」未安装或已移除`)
  let s = pluginSources.get(code)
  if (!s) {
    s = new PluginSource(rec.code, rec.name, rec.js, getPluginEnv(rec.code))
    pluginSources.set(code, s)
  }
  return s
}

/** 卸载插件时销毁其实例 */
export function disposePluginSource(code: string): void {
  const s = pluginSources.get(code)
  s?.dispose()
  pluginSources.delete(code)
}

/* ---------------------------------------------------------------------------
 * 兼容出口：与旧 musicApi.ts 同名函数，SearchPage 调用点无感迁移
 * ------------------------------------------------------------------------ */

/** 搜索：走当前激活源 */
export function searchMusic(keyword: string): Promise<Track[]> {
  return resolveSource(getActiveSourceCode()).search(keyword)
}

/** 猜你想找：内置源的辅助接口 */
export function guessMusics(keyword: string): Promise<Track[]> {
  return builtin.guess(keyword)
}

/** 获取播放直链：按 track.source 路由（缺省为内置源） */
export async function getPlayUrl(track: Track): Promise<SourcePlayUrl> {
  return resolveSource(track.source).getPlayUrl(track)
}

interface FetchResult {
  status: number
  headers: Record<string, string>
  body: string
}

/** 插件直链后缀 → Blob 的 MIME（.m4s 是 bilibili 的分段 mp4 音频） */
const MIME_BY_EXT: Record<string, string> = {
  m4s: 'audio/mp4',
  mp4: 'audio/mp4',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
}

function guessAudioMime(url: string, respType?: string): string {
  const t = (respType || '').split(';')[0].trim().toLowerCase()
  if (t.startsWith('audio/') || t.startsWith('video/')) return t
  let ext = ''
  try {
    ext = new URL(url).pathname.split('.').pop()?.toLowerCase() || ''
  } catch {
    /* 非法 URL 交给上层报错 */
  }
  return MIME_BY_EXT[ext] || 'audio/mpeg'
}

function base64ToBlob(base64: string, type: string): Blob {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

const coverDataCache = new Map<string, string>()

/**
 * 封面转 data URL。页面里的 <img> 直接请求第三方图床时，WebView 会带上
 * tauri://localhost 的 Referer/Origin，bilibili 等图床按防盗链返回 403；
 * 改由 Rust 拉字节再内联给页面。失败时退回原始 URL。
 */
export async function coverAsDataUrl(url: string): Promise<string> {
  if (!url || !/^https?:/i.test(url)) return url
  const cached = coverDataCache.get(url)
  if (cached) return cached

  const fetchCover = async (headers?: Record<string, string>) =>
    invoke<FetchResult>('plugin_fetch', { url, headers, binary: true })

  try {
    let res = await fetchCover()
    // 部分图床校验 Referer，用图片自身域名重试一次
    if ((res.status === 401 || res.status === 403) && /^https?:/i.test(url)) {
      const origin = new URL(url).origin
      res = await fetchCover({ Referer: `${origin}/` })
    }
    if (res.status < 200 || res.status >= 300) return url
    const ctKey = Object.keys(res.headers).find(k => k.toLowerCase() === 'content-type')
    const mime = (ctKey ? res.headers[ctKey] : '').split(';')[0] || 'image/jpeg'
    const dataUrl = `data:${mime};base64,${res.body}`
    coverDataCache.set(url, dataUrl)
    return dataUrl
  } catch {
    return url
  }
}

/**
 * 播放用地址。插件直链普遍需要 Referer/UA 防盗链，而 <audio src> 无法携带
 * 请求头；且 macOS WKWebView 对裸直链（application/octet-stream、.m4s）比
 * Chromium 严格，会直接抛 NotSupportedError。
 * 因此带 headers 的直链先经 Rust plugin_fetch 拉字节，转成 Blob URL 再播。
 * 调用方切换歌曲/离开页面时需执行返回的 revoke 释放内存。
 */
export async function getPlaybackUrl(
  track: Track,
): Promise<{ url: string; revoke?: () => void }> {
  const play = await resolveSource(track.source).getPlayUrl(track)
  if (!play.headers || !Object.keys(play.headers).length) return { url: play.url }

  const res = await invoke<FetchResult>('plugin_fetch', {
    url: play.url,
    headers: play.headers,
    binary: true,
  })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`音频直链请求失败（HTTP ${res.status}）`)
  }
  const ctKey = Object.keys(res.headers).find(k => k.toLowerCase() === 'content-type')
  const url = URL.createObjectURL(
    base64ToBlob(res.body, guessAudioMime(play.url, ctKey ? res.headers[ctKey] : undefined)),
  )
  return { url, revoke: () => URL.revokeObjectURL(url) }
}

/** 读取歌词与封面元数据：源未实现时返回 null */
export async function getTrackMeta(track: Track): Promise<TrackMeta | null> {
  const s = resolveSource(track.source)
  return s.getTrackMeta ? s.getTrackMeta(track) : null
}

/** 下载单曲（含封面/歌词 ID3 与 .lrc）：按 track.source 路由 */
export function downloadTrack(track: Track, dir: string): Promise<DownloadResult> {
  return resolveSource(track.source).download(track, dir)
}

/** 探测分 P 数；源不支持时返回 0 */
export async function probeTrackParts(track: Track): Promise<number> {
  const s = resolveSource(track.source)
  return s.probeParts ? s.probeParts(track) : 0
}

/** 拉取多 P 合集的全部分 P；非多 P 返回空数组 */
export async function getTrackParts(track: Track): Promise<Track[]> {
  const s = resolveSource(track.source)
  return s.getParts ? s.getParts(track) : []
}

export { defaultDownloadDir } from '../settings'
