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

/** 读取歌词与封面元数据：源未实现时返回 null */
export async function getTrackMeta(track: Track): Promise<TrackMeta | null> {
  const s = resolveSource(track.source)
  return s.getTrackMeta ? s.getTrackMeta(track) : null
}

/** 下载单曲（含封面/歌词 ID3 与 .lrc）：按 track.source 路由 */
export function downloadTrack(track: Track, dir: string): Promise<DownloadResult> {
  return resolveSource(track.source).download(track, dir)
}

export { defaultDownloadDir } from '../settings'
