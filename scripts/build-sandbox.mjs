// 构建插件沙箱为单文件经典脚本 dist/sandbox.js（IIFE，cheerio 等
// 依赖全部内联）。生产构建由 tauri.conf.json 的 beforeBuildCommand 在
// vite build 之后调用本脚本；dev 由 vite.config.ts 的中间件按需构建同款产物。
import { build } from 'esbuild'

await build({
  entryPoints: ['src/sandbox/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2021',
  platform: 'browser',
  outfile: 'dist/sandbox.js',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
})

console.log('[build:sandbox] dist/sandbox.js')
