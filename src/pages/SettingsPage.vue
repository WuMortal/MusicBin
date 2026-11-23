<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen, Info, AudioLines, Store, Plus, Settings2, Trash2, LoaderCircle, X } from 'lucide-vue-next'
import {
  getDownloadDir, setDownloadDir, getPlugins, getActiveSourceCode, setActiveSourceCode,
  getPluginEnv, setPluginEnv, type PluginRecord,
} from '../lib/settings'
import {
  installPluginFromUrl, commitPlugin, removePlugin,
} from '../lib/source/install'
import { BUILTIN_CODE, disposePluginSource } from '../lib/source'
import { useTheme, type ThemeMode } from '../composables/useTheme'
import { useToast } from '../composables/toast'
import { confirm } from '../composables/confirm'
import MarketDialog from '../components/MarketDialog.vue'

const toast = useToast()
const { theme, setTheme } = useTheme()
const dir = ref(getDownloadDir())
const modes: { value: ThemeMode; label: string }[] = [
  { value: 'auto', label: '跟随系统' },
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
]

async function pickDir() {
  const picked = await open({ directory: true, title: '选择下载目录' })
  if (typeof picked === 'string' && picked) {
    setDownloadDir(picked)
    dir.value = picked
    toast.success('下载目录已更新')
  }
}

/* ---------------------------------------------------------------------------
 * 音乐源：激活源切换 / 插件管理 / 手动安装 / 插件市场
 * ------------------------------------------------------------------------ */

const BUILTIN_NAME = '内置源 · 歌曲宝'
const activeCode = ref(getActiveSourceCode())
const plugins = ref<PluginRecord[]>(getPlugins())

/** 分段控件选项：内置 + 已安装插件 */
const sources = computed(() => [
  { code: BUILTIN_CODE, name: BUILTIN_NAME },
  ...plugins.value.map(p => ({ code: p.code, name: p.name })),
])

function refreshPlugins() {
  plugins.value = getPlugins()
}

function chooseSource(code: string) {
  if (code === activeCode.value) return
  activeCode.value = code
  setActiveSourceCode(code)
  const s = sources.value.find(x => x.code === code)
  toast.success(`已切换到「${s?.name || code}」`)
}

async function removePluginRow(p: PluginRecord) {
  const ok = await confirm({
    title: '移除插件',
    content: `将移除「${p.name}」v${p.version}，搜索将不再使用该源；播放记录与已下载文件不受影响。`,
    confirmText: '移除',
    danger: true,
  })
  if (!ok) return
  removePlugin(p.code)
  disposePluginSource(p.code)
  if (activeCode.value === p.code) {
    activeCode.value = BUILTIN_CODE
    setActiveSourceCode(BUILTIN_CODE)
    toast.info('已切回内置源')
  }
  refreshPlugins()
  toast.success(`已移除：${p.name}`)
}

/* 插件用户变量（API Key 等）：小弹窗编辑 */

const envVisible = ref(false)
const envPlugin = ref<PluginRecord | null>(null)
const envForm = reactive<Record<string, string>>({})

function openEnv(p: PluginRecord) {
  envPlugin.value = p
  const stored = getPluginEnv(p.code)
  for (const k of Object.keys(envForm)) delete envForm[k]
  for (const v of p.userVariables || []) envForm[v.key] = stored[v.key] || ''
  envVisible.value = true
}

function saveEnv() {
  const p = envPlugin.value
  if (!p) return
  setPluginEnv(p.code, { ...envForm })
  // 销毁运行中的实例，下次使用时以新变量重建
  disposePluginSource(p.code)
  envVisible.value = false
  toast.success(`已保存「${p.name}」配置`)
}

/* 手动 URL 安装 + 插件市场 */

const installUrl = ref('')
const installing = ref(false)
const marketVisible = ref(false)

/** localStorage 超限（插件过大）给出可读提示 */
function installErrMsg(e: unknown): string {
  const msg = (e as Error).message || String(e)
  if (/quota/i.test(msg)) return '插件过大，本地存储空间不足，安装失败'
  return msg || '安装失败'
}

async function installFromUrl() {
  const url = installUrl.value.trim()
  if (!/^https?:\/\//i.test(url)) {
    toast.error('请输入插件 js 地址（http/https）')
    return
  }
  if (installing.value) return
  installing.value = true
  try {
    const { record, existing } = await installPluginFromUrl(url)
    if (existing) {
      const ok = await confirm({
        title: '覆盖安装',
        content: `「${existing.name}」v${existing.version} 已安装，是否覆盖为 v${record.version}？已填写的配置会保留。`,
        confirmText: '覆盖',
      })
      if (!ok) return
    }
    commitPlugin(record)
    disposePluginSource(record.code)
    installUrl.value = ''
    refreshPlugins()
    toast.success(`已安装：${record.name} v${record.version}`)
  } catch (e) {
    toast.error(installErrMsg(e))
  } finally {
    installing.value = false
  }
}

/** 市场安装完成后：换掉旧实例并刷新列表 */
function onMarketInstalled(record: PluginRecord) {
  disposePluginSource(record.code)
  refreshPlugins()
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1>设置</h1>
      <p>下载位置与外观偏好</p>
    </header>

    <section class="card sec">
      <h2><AudioLines :size="16" /> 音乐源</h2>
      <p class="desc">搜索与解析使用当前激活源</p>
      <div class="seg">
        <button
          v-for="s in sources"
          :key="s.code"
          class="seg-item"
          :class="{ on: activeCode === s.code }"
          @click="chooseSource(s.code)"
        >{{ s.name }}</button>
      </div>

      <div v-if="plugins.length" class="plug-list">
        <div v-for="p in plugins" :key="p.code" class="plug-row">
          <div class="plug-info">
            <span class="plug-name">{{ p.name }}</span>
            <span class="plug-ver">v{{ p.version }}</span>
          </div>
          <div class="plug-acts">
            <button v-if="p.userVariables && p.userVariables.length" class="btn btn-ghost" @click="openEnv(p)">
              <Settings2 :size="13" /> 配置
            </button>
            <button class="btn btn-ghost danger" @click="removePluginRow(p)">
              <Trash2 :size="13" /> 移除
            </button>
          </div>
        </div>
      </div>
      <p v-else class="plug-empty">尚未安装插件源，可粘贴 js 地址安装或浏览插件市场。</p>

      <div class="row install-row">
        <input
          v-model="installUrl"
          class="url-input"
          placeholder="插件 js 地址（https://…/plugin.js）"
          spellcheck="false"
          @keyup.enter="installFromUrl"
        >
        <button class="btn btn-primary" :disabled="installing" @click="installFromUrl">
          <LoaderCircle v-if="installing" :size="13" class="spin" />
          <Plus v-else :size="13" /> 安装
        </button>
        <button class="btn btn-ghost" @click="marketVisible = true">
          <Store :size="13" /> 插件市场
        </button>
      </div>
    </section>

    <section class="card sec">
      <h2>下载目录</h2>
      <p class="desc">下载的单曲会保存到该目录，文件名格式为「歌曲名 - 歌手.mp3」。</p>
      <div class="row">
        <div class="path">{{ dir || '未设置（首次下载时选择）' }}</div>
        <button class="btn btn-ghost" @click="pickDir"><FolderOpen :size="14" /> 选择目录</button>
      </div>
    </section>

    <section class="card sec">
      <h2>外观</h2>
      <p class="desc">界面采用玻璃态设计语言。</p>
      <div class="seg">
        <button
          v-for="m in modes"
          :key="m.value"
          class="seg-item"
          :class="{ on: theme === m.value }"
          @click="setTheme(m.value)"
        >{{ m.label }}</button>
      </div>
    </section>

    <section class="card sec about">
      <h2><Info :size="16" /> 关于</h2>
      <p class="desc">音藏 0.1.0 · Tauri 2 + Vue 3。搜索与音源解析来自第三方站点，请仅用于个人合法用途，尊重音乐著作权。</p>
    </section>

    <!-- 插件市场：1080×720 玻璃大弹窗 -->
    <MarketDialog v-model:visible="marketVisible" @installed="onMarketInstalled" />

    <!-- 插件用户变量配置：小弹窗 -->
    <Teleport to="body">
      <transition name="ev">
        <div v-if="envVisible" class="ev-mask" @click.self="envVisible = false">
          <div class="ev-card">
            <button class="ev-x" @click="envVisible = false"><X :size="15" /></button>
            <h3 class="ev-title">配置「{{ envPlugin?.name }}」</h3>
            <p v-if="envPlugin" class="ev-sub">插件声明的用户变量（如 API Key），保存在本机。</p>
            <div class="ev-fields">
              <label v-for="v in envPlugin?.userVariables || []" :key="v.key" class="ev-field">
                <span class="ev-label">{{ v.name || v.key }}</span>
                <input v-model="envForm[v.key]" class="ev-input" spellcheck="false">
              </label>
            </div>
            <div class="ev-actions">
              <button class="btn btn-ghost" @click="envVisible = false">取消</button>
              <button class="btn btn-primary" @click="saveEnv">保存</button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.page { height: 100%; overflow: auto; padding-right: 4px; }
.head { margin-bottom: 20px; }
.head h1 { margin: 0 0 4px; font-size: var(--fs-2xl); font-weight: 600; }
.head p { margin: 0; color: var(--c-text-2); font-size: var(--fs-sm); }
.sec { padding: 18px 20px; margin-bottom: 14px; }
.sec h2 { margin: 0 0 6px; font-size: var(--fs-lg); font-weight: 500; display: flex; align-items: center; gap: 6px; }
.desc { margin: 0 0 14px; font-size: var(--fs-sm); color: var(--c-text-2); line-height: 1.6; }
.row { display: flex; gap: 10px; align-items: center; }
.path { flex: 1; padding: 8px 12px; background: var(--c-glass); border: 1px solid var(--c-border); border-radius: var(--r-md); font-family: var(--font-mono); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.seg { display: inline-flex; padding: 3px; background: var(--c-glass); border: 1px solid var(--c-border); border-radius: var(--r-md); max-width: 100%; flex-wrap: wrap; gap: 2px; }
.seg-item { padding: 5px 14px; font-size: var(--fs-xs); border-radius: 6px; color: var(--c-text-2); transition: all var(--motion); }
.seg-item.on { background: var(--c-primary); color: #fff; }
.about { border-color: var(--c-border-hairline); }

/* ===== 音乐源 ===== */
.plug-list { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; }
.plug-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--c-glass); border: 1px solid var(--c-border-hairline); border-radius: var(--r-md); }
.plug-info { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
.plug-name { font-size: var(--fs-md); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plug-ver { font-size: var(--fs-xs); font-family: var(--font-mono); color: var(--c-primary); background: var(--c-primary-soft); padding: 1px 8px; border-radius: var(--r-pill); flex-shrink: 0; }
.plug-acts { display: flex; gap: 8px; flex-shrink: 0; }
.plug-row .btn { padding: 4px 10px; font-size: var(--fs-xs); }
.btn.danger { color: var(--c-danger); }
.btn.danger:hover { background: rgba(239, 68, 68, 0.12); border-color: rgba(239, 68, 68, 0.3); }
.plug-empty { margin: 10px 0 0; font-size: var(--fs-sm); color: var(--c-text-3); }
.install-row { margin-top: 14px; }
.url-input { flex: 1; padding: 8px 12px; background: var(--c-glass); border: 1px solid var(--c-border); border-radius: var(--r-md); font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--c-text); outline: none; transition: border-color var(--motion); }
.url-input:focus { border-color: var(--c-primary); }
.spin { animation: ev-spin 0.9s linear infinite; }
@keyframes ev-spin { to { transform: rotate(360deg); } }

/* ===== 插件配置小弹窗 ===== */
.ev-mask { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: grid; place-items: center; padding: 24px; }
.ev-card { position: relative; width: min(460px, 92vw); background: var(--c-elevated); border: 1px solid var(--c-border); border-radius: var(--r-xl); box-shadow: var(--shadow-lg); padding: 20px; }
.ev-x { position: absolute; top: 12px; right: 12px; width: 26px; height: 26px; border: none; background: transparent; color: var(--c-text-3); cursor: pointer; border-radius: var(--r-sm); display: grid; place-items: center; transition: all var(--motion); }
.ev-x:hover { background: var(--c-glass); color: var(--c-text); }
.ev-title { margin: 0; font-size: var(--fs-md); font-weight: 600; }
.ev-sub { margin: 6px 0 0; font-size: var(--fs-sm); color: var(--c-text-2); padding-right: 20px; }
.ev-fields { margin-top: 16px; display: flex; flex-direction: column; gap: 12px; }
.ev-field { display: flex; align-items: center; gap: 10px; }
.ev-label { flex: 0 0 140px; font-size: var(--fs-sm); color: var(--c-text-2); }
.ev-input { flex: 1; padding: 8px 12px; background: var(--c-glass); border: 1px solid var(--c-border); border-radius: var(--r-md); font-size: var(--fs-sm); color: var(--c-text); outline: none; transition: border-color var(--motion); }
.ev-input:focus { border-color: var(--c-primary); }
.ev-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }

.ev-enter-active, .ev-leave-active { transition: opacity 200ms ease; }
.ev-enter-active .ev-card, .ev-leave-active .ev-card { transition: transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1); }
.ev-enter-from, .ev-leave-to { opacity: 0; }
.ev-enter-from .ev-card, .ev-leave-to .ev-card { transform: scale(0.95) translateY(10px); }
</style>
