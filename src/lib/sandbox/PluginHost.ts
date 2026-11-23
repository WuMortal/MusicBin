// 插件宿主：为单个 MusicFree 插件管理一个 sandbox iframe 的生命周期，
// 提供 call() RPC 与网络代理（fetch → plugin_fetch）。
//
// 安全要点：
// - iframe 只加 allow-scripts，绝不能加 allow-same-origin（否则插件可经
//   window.parent 摸到 __TAURI_INTERNALS__ 直接 invoke）。
// - opaque origin 下 e.origin === 'null'，校验只能靠
//   e.source === iframe.contentWindow + instanceId 匹配；postMessage 用 '*'。
// - 插件同步死循环无法中断，call 超时后销毁整个 iframe，下次调用重建。

import { invoke } from '@tauri-apps/api/core'

export interface PluginUserVariable { key: string; name?: string }

export interface PluginMeta {
  platform: string
  version: string
  userVariables: PluginUserVariable[]
  methods: string[]
}

interface HostMessage extends Record<string, unknown> {
  kind: string
}

interface FetchResult {
  status: number
  headers: Record<string, string>
  body: string
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
}

const SANDBOX_URL = `${location.origin}/sandbox.html`
const LOAD_TIMEOUT = 15_000

export class PluginHost {
  readonly instanceId: string
  private iframe: HTMLIFrameElement | null = null
  private meta: PluginMeta | null = null
  private readyPromise: Promise<PluginMeta> | null = null
  private pendingReady: {
    resolve: (m: PluginMeta) => void
    reject: (e: unknown) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null
  private seq = 0
  private calls = new Map<number, Pending>()
  private onMsg = (e: MessageEvent) => this.handle(e)

  constructor(
    readonly code: string,
    private readonly js: string,
    private readonly env: Record<string, string> = {},
  ) {
    this.instanceId = `${code}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  /** 加载并校验插件；懒创建，iframe 创建后保留复用 */
  load(): Promise<PluginMeta> {
    if (this.readyPromise) return this.readyPromise
    this.readyPromise = new Promise<PluginMeta>((resolve, reject) => {
      const frame = document.createElement('iframe')
      frame.setAttribute('sandbox', 'allow-scripts')
      frame.style.display = 'none'
      frame.src = `${SANDBOX_URL}?instance=${encodeURIComponent(this.instanceId)}`
      const timer = setTimeout(() => {
        // dispose 携带真实原因：pendingReady.reject 会先于外层 reject 生效，
        // 必须把超时原因传进去，否则会被掩盖成「插件已销毁」
        this.dispose('插件加载超时：沙箱脚本未能启动（可能被浏览器拦截）')
      }, LOAD_TIMEOUT)
      this.pendingReady = { resolve, reject, timer }
      window.addEventListener('message', this.onMsg)
      document.body.appendChild(frame)
      this.iframe = frame
    })
    return this.readyPromise
  }

  private handle(e: MessageEvent) {
    if (!this.iframe || e.source !== this.iframe.contentWindow) return
    const d = e.data as HostMessage | null
    if (!d || d.ch !== 'mvsp' || d.instanceId !== this.instanceId) return
    switch (d.kind) {
      case 'hello':
        this.post({ kind: 'init', js: this.js, env: this.env })
        break
      case 'ready': {
        const meta: PluginMeta = {
          platform: (d.platform as string) || this.code,
          version: (d.version as string) || '',
          userVariables: (d.userVariables as PluginUserVariable[]) || [],
          methods: (d.methods as string[]) || [],
        }
        this.meta = meta
        if (this.pendingReady) {
          clearTimeout(this.pendingReady.timer)
          this.pendingReady.resolve(meta)
          this.pendingReady = null
        }
        break
      }
      case 'error': {
        const message = (d.message as string) || '插件错误'
        if (d.fatal) {
          if (this.pendingReady) {
            clearTimeout(this.pendingReady.timer)
            this.pendingReady.reject(new Error(message))
            this.pendingReady = null
          }
          this.dispose()
        } else {
          const c = this.calls.get(d.msgId as number)
          if (c) {
            this.calls.delete(d.msgId as number)
            c.reject(new Error(message))
          }
        }
        break
      }
      case 'result': {
        const c = this.calls.get(d.msgId as number)
        if (c) {
          this.calls.delete(d.msgId as number)
          c.resolve(d.data)
        }
        break
      }
      case 'fetch':
        void this.proxyFetch(d)
        break
      case 'log':
        this.log(d.level as string, d.args as string[])
        break
    }
  }

  private log(level: string, args: string[]) {
    const line = `[plugin:${this.code}] ${(args || []).join(' ')}`
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  }

  private post(msg: Record<string, unknown>) {
    this.iframe?.contentWindow?.postMessage(
      { v: 1, ch: 'mvsp', instanceId: this.instanceId, ...msg },
      '*',
    )
  }

  /** 沙箱 fetch 请求 → Rust plugin_fetch（结果始终 base64） */
  private async proxyFetch(d: HostMessage) {
    const init = (d.init || {}) as { method?: string; headers?: Record<string, string>; body?: string }
    try {
      const res = await invoke<FetchResult>('plugin_fetch', {
        url: d.url as string,
        method: init.method,
        headers: init.headers,
        body: init.body,
        binary: true,
      })
      this.post({
        kind: 'fetch-res', reqId: d.reqId, ok: true,
        status: res.status, headers: res.headers, body: res.body,
      })
    } catch (err) {
      this.post({ kind: 'fetch-res', reqId: d.reqId, ok: false, error: String(err) })
    }
  }

  /** 调用插件方法（白名单在沙箱侧强制） */
  async call<T = unknown>(method: string, args: unknown[] = [], timeoutMs = 15_000): Promise<T> {
    await this.load()
    if (!this.meta) throw new Error('插件未就绪')
    if (!this.meta.methods.includes(method)) {
      throw new Error(`插件「${this.meta.platform}」未实现 ${method}`)
    }
    const msgId = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        // 先用真实原因 reject 当前调用，再 dispose（dispose 会以通用原因
        // reject 其余 pending 调用；顺序颠倒会把真实错误掩盖掉）
        this.calls.delete(msgId)
        reject(new Error(`插件调用超时: ${method}`))
        this.dispose(`插件调用超时: ${method}`)
      }, timeoutMs)
      this.calls.set(msgId, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      this.post({ kind: 'call', msgId, method, args })
    })
  }

  /** 销毁沙箱；下次 call 自动重建。reason 会成为 pending 调用/加载的错误文案 */
  dispose(reason = '插件已销毁'): void {
    window.removeEventListener('message', this.onMsg)
    for (const [, c] of this.calls) c.reject(new Error(reason))
    this.calls.clear()
    if (this.pendingReady) {
      clearTimeout(this.pendingReady.timer)
      this.pendingReady.reject(new Error(reason))
      this.pendingReady = null
    }
    this.iframe?.remove()
    this.iframe = null
    this.meta = null
    this.readyPromise = null
  }
}
