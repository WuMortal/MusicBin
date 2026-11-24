// MusicFree 插件沙箱运行时。
// 本页面由宿主以 <iframe sandbox="allow-scripts"> 加载（opaque origin），
// 与宿主仅通过 postMessage 通信；插件无法触碰 Tauri invoke。
//
// 消息协议（双向，信封: {v:1, ch:'mvsp', instanceId, ...}）：
//   宿主→沙箱: init{js,env} / call{msgId,method,args} / fetch-res{reqId,ok,...}
//   沙箱→宿主: hello / ready{platform,version,userVariables,methods}
//              result{msgId,data} / error{msgId|fatal,message}
//              fetch{reqId,url,init} / log{level,args}
// 插件网络（fetch/axios）全部代理到宿主的 plugin_fetch（Rust reqwest），绕过 webview CORS。

/* eslint-disable no-restricted-globals */

type HostMessage = Record<string, unknown> & { kind: string }

const params = new URLSearchParams(location.search)
const instanceId = params.get('instance') || ''

let msgSeq = 0
let pluginExports: Record<string, unknown> | null = null

const pendingFetches = new Map<number, { resolve: (r: Response) => void; reject: (e: unknown) => void }>()

function post(msg: Record<string, unknown>) {
  parent.postMessage({ v: 1, ch: 'mvsp', instanceId, ...msg }, '*')
}

// ---------------------------------------------------------------------------
// 网络代理：window.fetch → 宿主 plugin_fetch
// ---------------------------------------------------------------------------

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function normalizeHeaders(h: HeadersInit | undefined, out: Record<string, string>) {
  if (!h) return
  if (h instanceof Headers) h.forEach((v, k) => { out[k] = v })
  else if (Array.isArray(h)) for (const [k, v] of h) out[k] = String(v)
  else for (const [k, v] of Object.entries(h)) out[k] = String(v)
}

async function proxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input
    : input instanceof URL ? input.href
      : (input as Request).url
  const method = (init?.method as string | undefined)
    ?? (typeof input !== 'string' && !(input instanceof URL) ? (input as Request).method : undefined)
  const headers: Record<string, string> = {}
  if (typeof input !== 'string' && !(input instanceof URL)) {
    try { (input as Request).headers.forEach((v, k) => { headers[k] = v }) } catch { /* ignore */ }
  }
  normalizeHeaders(init?.headers, headers)

  let body: string | undefined
  const b = init?.body
  if (typeof b === 'string') body = b
  else if (b instanceof URLSearchParams) {
    body = b.toString()
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
    }
  } else if (b != null) {
    throw new TypeError('沙箱 fetch 仅支持字符串或 URLSearchParams 请求体')
  }

  const reqId = ++msgSeq
  post({ kind: 'fetch', reqId, url, init: { method, headers, body } })
  return new Promise<Response>((resolve, reject) => {
    pendingFetches.set(reqId, { resolve, reject })
  })
}

function onFetchRes(d: HostMessage) {
  const reqId = d.reqId as number
  const p = pendingFetches.get(reqId)
  if (!p) return
  pendingFetches.delete(reqId)
  if (!d.ok) { p.reject(new TypeError('Failed to fetch')); return }
  const status = (d.status as number) || 200
  const respHeaders = new Headers()
  for (const [k, v] of Object.entries((d.headers as Record<string, string>) || {})) {
    respHeaders.set(k, v)
  }
  // 204/205/304 禁止携带 body，Response 构造会抛错
  const bytes = [204, 205, 304].includes(status) ? null : base64ToBytes((d.body as string) || '')
  p.resolve(new Response(bytes, { status, headers: respHeaders }))
}

// ---------------------------------------------------------------------------
// 迷你 axios：语义对齐 axios@0.x（4xx/5xx reject、res.data/status/headers）
// ---------------------------------------------------------------------------

interface AxiosConfig {
  url?: string
  baseURL?: string
  method?: string
  headers?: Record<string, unknown>
  params?: Record<string, unknown> | string
  data?: unknown
  responseType?: string
  validateStatus?: (s: number) => boolean
  [k: string]: unknown
}

function serializeAxiosData(data: unknown, headers: Record<string, string>): string | undefined {
  if (data == null) return undefined
  if (typeof data === 'string') return data
  if (data instanceof URLSearchParams) return data.toString()
  if (typeof data === 'object') {
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json'
    }
    return JSON.stringify(data)
  }
  return String(data)
}

async function doAxios(cfg: AxiosConfig): Promise<Record<string, unknown>> {
  const method = (cfg.method || 'GET').toUpperCase()
  let url = (cfg.baseURL || '') + (cfg.url || '')
  if (cfg.params) {
    const qsStr = typeof cfg.params === 'string' ? cfg.params : new URLSearchParams(
      Object.entries(cfg.params).map(([k, v]) => [k, String(v)]),
    ).toString()
    url += (url.includes('?') ? '&' : '?') + qsStr
  }
  // axios 风格 headers 合并：headers.headers[method] 优先于 headers.headers.common
  const h = (cfg.headers || {}) as Record<string, Record<string, string> | string>
  const headers: Record<string, string> = {}
  const common = (h as any).common
  if (common && typeof common === 'object') Object.assign(headers, common)
  const byMethod = (h as any)[method.toLowerCase()]
  if (byMethod && typeof byMethod === 'object') Object.assign(headers, byMethod)
  for (const [k, v] of Object.entries(h)) {
    if (k === 'common' || typeof v !== 'string') continue
    headers[k] = v
  }
  const body = serializeAxiosData(cfg.data, headers)
  const resp = await proxyFetch(url, { method, headers, body })
  const text = await resp.text()
  let data: unknown = text
  if (!cfg.responseType || cfg.responseType === 'json') {
    try { data = JSON.parse(text) } catch { /* 保留原文 */ }
  }
  const respHeaders: Record<string, string> = {}
  resp.headers.forEach((v, k) => { respHeaders[k] = v })
  const result = { data, status: resp.status, statusText: resp.statusText, headers: respHeaders, config: cfg, request: {} }
  const validate = cfg.validateStatus || ((s: number) => s >= 200 && s < 300)
  if (!validate(resp.status)) {
    const err = new Error(`Request failed with status code ${resp.status}`) as Error & { response?: unknown; config?: unknown; isAxiosError?: boolean }
    err.response = result
    err.config = cfg
    err.isAxiosError = true
    throw err
  }
  return result
}

function createAxios(): unknown {
  const inst = (config: AxiosConfig) => doAxios(config)
  const fn = inst as unknown as Record<string, unknown>
  fn.get = (url: string, config?: AxiosConfig) => doAxios({ ...config, url, method: 'GET' })
  fn.post = (url: string, data?: unknown, config?: AxiosConfig) => doAxios({ ...config, url, method: 'POST', data })
  fn.put = (url: string, data?: unknown, config?: AxiosConfig) => doAxios({ ...config, url, method: 'PUT', data })
  fn.delete = (url: string, config?: AxiosConfig) => doAxios({ ...config, url, method: 'DELETE' })
  fn.request = (config: AxiosConfig) => doAxios(config)
  fn.defaults = { headers: { common: {} } }
  fn.isAxiosError = (e: unknown) => !!(e as Error & { isAxiosError?: boolean })?.isAxiosError
  return { ...fn, default: fn }
}

// ---------------------------------------------------------------------------
// require shim：内置库在 init 阶段预载（插件要求 require 同步返回）
// ---------------------------------------------------------------------------

const moduleCache = new Map<string, unknown>()

async function preloadModules() {
  const load = async (name: string, importer: () => Promise<unknown>) => {
    try { moduleCache.set(name, await importer()) } catch { /* 加载失败时 require 报错 */ }
  }
  await Promise.all([
    load('cheerio', async () => {
      const m = await import('cheerio')
      return (m as { default?: unknown }).default ?? m
    }),
    load('crypto-js', async () => {
      const m = await import('crypto-js')
      return (m as { default?: unknown }).default ?? m
    }),
    load('dayjs', async () => {
      const m = await import('dayjs')
      return (m as { default?: unknown }).default ?? m
    }),
    load('qs', async () => {
      const m = await import('qs')
      return (m as { default?: unknown }).default ?? m
    }),
    load('he', async () => {
      const m = await import('he')
      return (m as { default?: unknown }).default ?? m
    }),
  ])
}

function sandboxRequire(name: string): unknown {
  if (moduleCache.has(name)) return moduleCache.get(name)
  if (name === 'axios') return createAxios()
  throw new Error(`沙箱暂不支持模块: ${name}`)
}

// ---------------------------------------------------------------------------
// console shim：转发宿主打日志
// ---------------------------------------------------------------------------

function safeArg(a: unknown): string {
  if (typeof a === 'string') return a
  try { return JSON.stringify(a) } catch { return String(a) }
}

const consoleShim = {
  log: (...a: unknown[]) => post({ kind: 'log', level: 'log', args: a.map(safeArg) }),
  info: (...a: unknown[]) => post({ kind: 'log', level: 'log', args: a.map(safeArg) }),
  warn: (...a: unknown[]) => post({ kind: 'log', level: 'warn', args: a.map(safeArg) }),
  error: (...a: unknown[]) => post({ kind: 'log', level: 'error', args: a.map(safeArg) }),
  debug: (...a: unknown[]) => post({ kind: 'log', level: 'log', args: a.map(safeArg) }),
}

// ---------------------------------------------------------------------------
// init / call
// ---------------------------------------------------------------------------

async function onInit(d: HostMessage) {
  try {
    await preloadModules()
    const module = { exports: {} as Record<string, unknown> }
    const fn = new Function('module', 'exports', 'require', 'env', 'console',
      d.js as string) as (m: unknown, ex: unknown, r: unknown, e: unknown, c: unknown) => void
    fn(module, module.exports, sandboxRequire, (d.env as Record<string, string>) || {}, consoleShim)
    let exp = module.exports
    // 兼容 ESM 打包产物（Parcel 等）：module.exports = { __esModule: true, default: 插件对象 }
    if (
      exp && typeof exp === 'object'
      && (exp as { __esModule?: boolean }).__esModule
      && (exp as { default?: unknown }).default
      && typeof (exp as { default: unknown }).default === 'object'
    ) {
      exp = (exp as { default: Record<string, unknown> }).default
    }
    if (!exp || typeof exp !== 'object') throw new Error('插件未导出对象')
    if (typeof exp.platform !== 'string' || !exp.platform.trim()) throw new Error('插件缺少 platform 字段')
    pluginExports = exp
    const methods = Object.entries(exp)
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k)
    post({
      kind: 'ready',
      platform: exp.platform,
      version: String(exp.version ?? ''),
      userVariables: exp.userVariables ?? [],
      methods,
    })
  } catch (e) {
    post({ kind: 'error', fatal: true, message: String((e as Error)?.message || e).slice(0, 500) })
  }
}

// getAlbumInfo：bilibili 等插件的多 P 合集信息（分 P 探测与分 P 选择下载依赖它）
const ALLOWED_METHODS = ['search', 'getMediaSource', 'getMusicInfo', 'getLyric', 'getAlbumInfo']

async function onCall(d: HostMessage) {
  const msgId = d.msgId as number
  const method = d.method as string
  if (!ALLOWED_METHODS.includes(method)) {
    post({ kind: 'error', msgId, message: `不允许的方法: ${method}` })
    return
  }
  const fn = pluginExports?.[method]
  if (typeof fn !== 'function') {
    post({ kind: 'error', msgId, message: `插件未实现 ${method}` })
    return
  }
  try {
    const data = await (fn as (...a: unknown[]) => unknown)(...(d.args as unknown[] || []))
    post({ kind: 'result', msgId, data })
  } catch (e) {
    post({ kind: 'error', msgId, message: String((e as Error)?.message || e).slice(0, 500) })
  }
}

window.addEventListener('message', (e: MessageEvent) => {
  const d = e.data as HostMessage | null
  if (!d || typeof d !== 'object' || d.ch !== 'mvsp' || d.instanceId !== instanceId) return
  switch (d.kind) {
    case 'init': void onInit(d); break
    case 'call': void onCall(d); break
    case 'fetch-res': onFetchRes(d); break
  }
})

// 握手：宿主收到 hello 后回发 init
post({ kind: 'hello' })
