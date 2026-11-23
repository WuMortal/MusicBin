<script setup lang="ts">
import { ref, watch } from 'vue'
import { Store, RefreshCw, Download, LoaderCircle, Check, X } from 'lucide-vue-next'
import {
  fetchMarketList, installPluginFromUrl, commitPlugin,
  type MarketPlugin,
} from '../lib/source/install'
import type { PluginRecord } from '../lib/settings'
import { getMarketUrl, setMarketUrl, getPlugins } from '../lib/settings'
import { useToast } from '../composables/toast'
import { confirm } from '../composables/confirm'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'installed', record: PluginRecord): void
}>()

const toast = useToast()
const marketUrl = ref(getMarketUrl())
const list = ref<MarketPlugin[]>([])
const loading = ref(false)
/** 正在安装的插件地址（按钮级 loading） */
const installingUrl = ref('')

/** 已安装标记：按安装来源 URL 或插件 platform 匹配市场条目 */
const installedKeys = ref<Set<string>>(new Set())

function refreshInstalled() {
  const s = new Set<string>()
  for (const p of getPlugins()) { s.add(p.url); s.add(p.code); s.add(p.name) }
  installedKeys.value = s
}

function isInstalled(p: MarketPlugin): boolean {
  return installedKeys.value.has(p.url) || installedKeys.value.has(p.name)
}

function close() {
  emit('update:visible', false)
}

async function load() {
  if (loading.value) return
  const url = marketUrl.value.trim()
  if (!/^https?:\/\//i.test(url)) {
    toast.error('请输入有效的市场地址（http/https）')
    return
  }
  loading.value = true
  list.value = []
  try {
    setMarketUrl(url)
    list.value = await fetchMarketList(url)
    if (!list.value.length) toast.info('市场列表为空')
  } catch (e) {
    toast.error('市场加载失败：' + ((e as Error).message || e))
  } finally {
    loading.value = false
  }
}

/** 打开时刷新安装状态并自动加载一次（首次） */
watch(() => props.visible, v => {
  if (!v) return
  refreshInstalled()
  if (!list.value.length && !loading.value) void load()
})

async function install(p: MarketPlugin) {
  if (installingUrl.value) return
  installingUrl.value = p.url
  try {
    const { record, existing } = await installPluginFromUrl(p.url)
    if (existing) {
      const ok = await confirm({
        title: '覆盖安装',
        content: `「${existing.name}」v${existing.version} 已安装，是否覆盖为 v${record.version}？已填写的配置会保留。`,
        confirmText: '覆盖',
      })
      if (!ok) return
    }
    commitPlugin(record)
    refreshInstalled()
    toast.success(`已安装：${record.name} v${record.version}`)
    emit('installed', record)
  } catch (e) {
    toast.error((e as Error).message || '安装失败')
  } finally {
    installingUrl.value = ''
  }
}
</script>

<template>
  <Teleport to="body">
    <transition name="mk">
      <div v-if="visible" class="mk-mask" @click.self="close">
        <div class="mk-card">
          <header class="mk-head">
            <h3 class="mk-title"><Store :size="18" /> 插件市场</h3>
            <div class="mk-sub">来自 MusicFree 插件社区，安装后可在「音乐源」中切换</div>
            <button class="mk-x" @click="close"><X :size="16" /></button>
          </header>

          <div class="mk-bar">
            <input
              v-model="marketUrl"
              class="mk-url"
              placeholder="市场地址（plugins.json）"
              spellcheck="false"
              @keyup.enter="load"
            >
            <button class="btn btn-primary" :disabled="loading" @click="load">
              <LoaderCircle v-if="loading" :size="14" class="spin" />
              <RefreshCw v-else :size="14" /> 刷新
            </button>
          </div>

          <div class="mk-body">
            <div v-if="loading" class="mk-state">
              <LoaderCircle :size="22" class="spin" /> 正在加载市场…
            </div>
            <div v-else-if="!list.length" class="mk-state">
              暂无插件，检查市场地址后点击「刷新」
            </div>
            <div v-else class="mk-list">
              <div v-for="p in list" :key="p.url" class="mk-item">
                <div class="mk-info">
                  <div class="mk-name">
                    {{ p.name }}
                    <span v-if="p.version" class="mk-ver">v{{ p.version }}</span>
                  </div>
                  <div class="mk-desc">{{ p.description || p.url }}</div>
                </div>
                <button
                  class="btn btn-sm"
                  :class="isInstalled(p) ? 'btn-ghost' : 'btn-primary'"
                  :disabled="installingUrl === p.url"
                  :title="isInstalled(p) ? '再次点击可覆盖更新' : ''"
                  @click="install(p)"
                >
                  <LoaderCircle v-if="installingUrl === p.url" :size="13" class="spin" />
                  <Check v-else-if="isInstalled(p)" :size="13" />
                  <Download v-else :size="13" />
                  {{ isInstalled(p) ? '已安装' : '安装' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.mk-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: grid;
  place-items: center;
  padding: 24px;
}

.mk-card {
  width: min(1080px, 90vw);
  height: min(720px, 90vh);
  display: flex;
  flex-direction: column;
  background: var(--c-glass-strong);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}

.mk-head {
  position: relative;
  padding: 18px 20px 0;
  flex-shrink: 0;
}

.mk-title {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.mk-sub {
  margin-top: 4px;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
  padding-right: 40px;
}

.mk-x {
  position: absolute;
  top: 16px;
  right: 14px;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  transition: all var(--motion);
}

.mk-x:hover {
  background: var(--c-glass);
  color: var(--c-text);
}

.mk-bar {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 14px 20px;
  flex-shrink: 0;
}

.mk-url {
  flex: 1;
  padding: 8px 12px;
  background: var(--c-glass);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-text);
  outline: none;
  transition: border-color var(--motion);
}

.mk-url:focus {
  border-color: var(--c-primary);
}

.mk-body {
  flex: 1;
  min-height: 0;
  padding: 0 12px 14px 20px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.mk-state {
  height: 100%;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: var(--c-text-2);
  font-size: var(--fs-sm);
}

.mk-list {
  padding-right: 8px;
}

.mk-item {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 10px 12px;
  margin: 3px 0;
  background: var(--c-glass);
  border: 1px solid var(--c-border-hairline);
  border-radius: var(--r-md);
}

.mk-info {
  flex: 1;
  min-width: 0;
}

.mk-name {
  font-size: var(--fs-md);
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
}

.mk-ver {
  font-size: var(--fs-xs);
  font-family: var(--font-mono);
  color: var(--c-primary);
  background: var(--c-primary-soft);
  padding: 1px 8px;
  border-radius: var(--r-pill);
}

.mk-desc {
  margin-top: 3px;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spin {
  animation: mk-spin 0.9s linear infinite;
}

@keyframes mk-spin {
  to {
    transform: rotate(360deg);
  }
}

.mk-enter-active,
.mk-leave-active {
  transition: opacity 200ms ease;
}

.mk-enter-active .mk-card,
.mk-leave-active .mk-card {
  transition: transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.mk-enter-from,
.mk-leave-to {
  opacity: 0;
}

.mk-enter-from .mk-card,
.mk-leave-to .mk-card {
  transform: scale(0.96) translateY(10px);
}
</style>
