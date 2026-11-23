import { invoke } from '@tauri-apps/api/core'
import type { DownloadRecord, PlayRecord } from '../types'

const DIR_KEY = 'mv.download.dir'
const HISTORY_KEY = 'mv.download.history'
const PLAY_KEY = 'mv.play.history'

/** 默认下载目录（Rust 命令） */
export function defaultDownloadDir(): Promise<string> {
  return invoke<string>('default_download_dir')
}

export function getDownloadDir(): string {
  return localStorage.getItem(DIR_KEY) || ''
}

export function setDownloadDir(dir: string): void {
  localStorage.setItem(DIR_KEY, dir)
}

export async function ensureDownloadDir(): Promise<string> {
  let dir = getDownloadDir()
  if (!dir) {
    dir = await defaultDownloadDir().catch(() => '')
    if (dir) setDownloadDir(dir)
  }
  return dir
}

export function getHistory(): DownloadRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? (JSON.parse(raw) as DownloadRecord[]) : []
  } catch {
    return []
  }
}

export function addHistory(record: DownloadRecord): void {
  const list = getHistory().filter(r => r.key !== record.key)
  list.unshift(record)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 100)))
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY)
}

/* 播放记录：按歌曲 id 去重，同曲重播只更新时间并置顶 */
export function getPlayHistory(): PlayRecord[] {
  try {
    const raw = localStorage.getItem(PLAY_KEY)
    return raw ? (JSON.parse(raw) as PlayRecord[]) : []
  } catch {
    return []
  }
}

export function addPlayRecord(record: PlayRecord): void {
  const list = getPlayHistory().filter(r => r.id !== record.id)
  list.unshift(record)
  localStorage.setItem(PLAY_KEY, JSON.stringify(list.slice(0, 100)))
}

export function clearPlayHistory(): void {
  localStorage.removeItem(PLAY_KEY)
}

/* ---------------------------------------------------------------------------
 * 音乐源插件（MusicFree 协议）：安装时 JS 全文入库，离线可用
 * ------------------------------------------------------------------------ */

export interface PluginUserVar { key: string; name?: string }

export interface PluginRecord {
  /** 源标识（= 插件 platform），Track.source 与播放记录据此路由 */
  code: string
  name: string
  version: string
  /** 插件 js 来源地址（更新/展示用） */
  url: string
  /** 插件 JS 全文 */
  js: string
  /** 插件声明的用户变量（API Key 等） */
  userVariables?: PluginUserVar[]
}

const PLUGINS_KEY = 'mv.music.plugins'
const SOURCE_KEY = 'mv.music.source'
const ENV_PREFIX = 'mv.music.env.'
const MARKET_KEY = 'mv.music.market'

/** 默认插件市场地址（可在市场弹窗中修改并持久化） */
export const DEFAULT_MARKET_URL = 'https://musicfreepluginshub.2020818.xyz/plugins.json'

export function getMarketUrl(): string {
  return localStorage.getItem(MARKET_KEY) || DEFAULT_MARKET_URL
}

export function setMarketUrl(url: string): void {
  localStorage.setItem(MARKET_KEY, url)
}

export function getPlugins(): PluginRecord[] {
  try {
    const raw = localStorage.getItem(PLUGINS_KEY)
    const list = raw ? (JSON.parse(raw) as PluginRecord[]) : []
    return Array.isArray(list) ? list.filter(p => p && p.code && p.js) : []
  } catch {
    return []
  }
}

/** 保存插件列表；localStorage 超限时抛错由调用方 toast */
export function savePlugins(list: PluginRecord[]): void {
  localStorage.setItem(PLUGINS_KEY, JSON.stringify(list))
}

export function getActiveSourceCode(): string {
  return localStorage.getItem(SOURCE_KEY) || 'gequbao'
}

export function setActiveSourceCode(code: string): void {
  localStorage.setItem(SOURCE_KEY, code)
}

/** 插件用户变量值（env 注入沙箱） */
export function getPluginEnv(code: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(ENV_PREFIX + code)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function setPluginEnv(code: string, env: Record<string, string>): void {
  localStorage.setItem(ENV_PREFIX + code, JSON.stringify(env))
}
