import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { readdirSync, statSync } from 'node:fs'
import * as esbuild from 'esbuild'

/**
 * 沙箱经典脚本（dev）：按需把 src/sandbox/main.ts 打成单文件 IIFE 响应 /sandbox.js。
 *
 * 为什么不用 module + HMR：沙箱 iframe 是 opaque origin（Origin: null），
 * module 脚本必须过 CORS，而 Vite dev（5.4.21+ 安全默认）与 Tauri 生产协议
 * 都不会为 Origin: null 回 ACAO，module 会被拦截；经典 script 无此限制。
 * 与生产共用同一入口（scripts/build-sandbox.mjs），行为完全一致。
 */
function sandboxClassicDev(): Plugin {
  const entry = fileURLToPath(new URL('./src/sandbox/main.ts', import.meta.url))
  const srcDir = fileURLToPath(new URL('./src/sandbox', import.meta.url))
  let cache: { key: string; code: string } | null = null

  const srcKey = () => {
    let key = ''
    for (const f of readdirSync(srcDir)) {
      const s = statSync(srcDir + '/' + f)
      key += `${f}:${s.mtimeMs}:${s.size};`
    }
    return key
  }

  return {
    name: 'sandbox-classic-dev',
    configureServer(server) {
      server.middlewares.use('/sandbox.js', (_req, res, next) => {
        void (async () => {
          try {
            const key = srcKey()
            if (!cache || cache.key !== key) {
              const r = await esbuild.build({
                entryPoints: [entry],
                bundle: true,
                format: 'iife',
                target: 'es2021',
                platform: 'browser',
                write: false,
                sourcemap: 'inline',
              })
              cache = { key, code: r.outputFiles[0].text }
            }
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            res.end(cache.code)
          } catch (e) {
            next(e as Error)
          }
        })()
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), sandboxClassicDev()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  clearScreen: false,
  server: { port: 1421, strictPort: true, host: false },
  build: {
    target: 'es2021',
    outDir: 'dist',
    emptyOutDir: true,
  },
})
