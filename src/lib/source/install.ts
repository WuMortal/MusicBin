import { invoke } from '@tauri-apps/api/core'
import { PluginHost } from '../sandbox/PluginHost'
import { getPlugins, savePlugins, type PluginRecord } from '../settings'

/** 单插件 JS 全文上限：localStorage 容量有限，超限拒装 */
const MAX_JS_SIZE = 1024 * 1024

export interface InstallResult {
  record: PluginRecord
  /** 已安装的同名插件（调用方据此提示覆盖） */
  existing?: PluginRecord
}

/** 拉取远端文本（市场 plugins.json / 插件 js 全文） */
export function fetchRemoteText(url: string): Promise<string> {
  return invoke<string>('fetch_text', { url })
}

/**
 * 从插件 JS 全文安装：临时沙箱执行校验 platform/version，
 * 返回未落库的记录（由调用方决定覆盖与否，再 commitPlugin）。
 */
export async function installPluginFromJs(url: string, js: string): Promise<InstallResult> {
  if (js.length > MAX_JS_SIZE) throw new Error('插件文件超过 1MB，已拒装')
  if (!/module\.exports/.test(js)) {
    throw new Error('不是有效的 MusicFree 插件（未找到 module.exports）')
  }
  const probeCode = `probe-${Date.now().toString(36)}`
  const probe = new PluginHost(probeCode, js, {})
  try {
    const meta = await probe.load()
    const record: PluginRecord = {
      code: meta.platform,
      name: meta.platform,
      version: meta.version,
      url,
      js,
      userVariables: meta.userVariables,
    }
    const existing = getPlugins().find(p => p.code === record.code)
    return { record, existing }
  } finally {
    probe.dispose()
  }
}

/** 从 URL 安装：拉全文后走同一校验 */
export async function installPluginFromUrl(url: string): Promise<InstallResult> {
  const js = await fetchRemoteText(url)
  return installPluginFromJs(url, js)
}

/** 提交安装/覆盖（同 code 替换，保留用户变量值） */
export function commitPlugin(record: PluginRecord): void {
  const list = getPlugins().filter(p => p.code !== record.code)
  list.push(record)
  savePlugins(list)
}

export function removePlugin(code: string): void {
  savePlugins(getPlugins().filter(p => p.code !== code))
}

/* ---------------------------------------------------------------------------
 * 插件市场列表：兼容官方 {plugins:[{name,url,version}]} 与
 * 社区 hub {plugins:[{code,name,version,description,href,tags}]} 两种格式
 * ------------------------------------------------------------------------ */

export interface MarketPlugin {
  name: string
  url: string
  version: string
  description: string
}

export async function fetchMarketList(marketUrl: string): Promise<MarketPlugin[]> {
  const text = await fetchRemoteText(marketUrl)
  const json = JSON.parse(text) as Record<string, unknown>
  const raw = (json?.plugins && Array.isArray(json.plugins) ? json.plugins : Array.isArray(json) ? json : []) as Record<string, unknown>[]
  return raw
    .map(p => ({
      name: String(p.name || p.code || p.title || '').trim(),
      url: String(p.url || p.href || p.srcUrl || '').trim(),
      version: String(p.version || ''),
      description: String(p.description || p.desc || ''),
    }))
    .filter(p => p.name && /^https?:\/\//i.test(p.url))
}
