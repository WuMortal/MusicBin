<script setup lang="ts">
import { ref } from 'vue'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { FolderOpen, Trash2, Music2 } from 'lucide-vue-next'
import { getHistory, clearHistory } from '../lib/settings'
import { useToast } from '../composables/toast'
import { confirm } from '../composables/confirm'
import EmptyState from '../components/EmptyState.vue'

const toast = useToast()
const records = ref(getHistory())

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function reveal(path: string) {
  try { await revealItemInDir(path) }
  catch (e) { toast.error('打开目录失败：' + ((e as Error).message || e)) }
}

async function clear() {
  const ok = await confirm({ title: '清空下载记录', content: '仅清除本地记录列表，不会删除已下载的文件。', confirmText: '清空', danger: true })
  if (!ok) return
  clearHistory()
  records.value = []
  toast.success('记录已清空')
}
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <h1>下载记录</h1>
        <p>最近下载的单曲，共 {{ records.length }} 首</p>
      </div>
      <button v-if="records.length" class="btn btn-ghost" @click="clear">
        <Trash2 :size="14" /> 清空记录
      </button>
    </header>

    <div v-if="!records.length" class="empty-wrap">
      <EmptyState :icon="Music2" title="还没有下载记录" description="在音乐搜索页下载的单曲会出现在这里" />
    </div>

    <div v-else class="rows">
      <article v-for="r in records" :key="r.key" class="row">
        <div class="ico"><Music2 :size="16" /></div>
        <div class="info">
          <strong>{{ r.title }}</strong>
          <small>{{ r.author || '未知歌手' }} · {{ r.time }}</small>
        </div>
        <span class="size">{{ fmtSize(r.size) }}</span>
        <button class="btn btn-sm btn-ghost" title="打开文件所在目录" @click="reveal(r.path)">
          <FolderOpen :size="14" /> 定位文件
        </button>
      </article>
    </div>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.head h1 { margin: 0 0 4px; font-size: var(--fs-2xl); font-weight: 600; }
.head p { margin: 0; color: var(--c-text-2); font-size: var(--fs-sm); }
.empty-wrap { flex: 1; display: flex; }
.rows { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; }
.row {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px;
  background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--r-lg);
  transition: all var(--motion);
}
.row:hover { border-color: var(--c-border-strong); }
.ico { width: 34px; height: 34px; border-radius: var(--r-md); background: var(--c-primary-soft); color: var(--c-primary); display: grid; place-items: center; flex-shrink: 0; }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.info strong { font-size: var(--fs-md); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.info small { font-size: var(--fs-xs); color: var(--c-text-3); }
.size { color: var(--c-text-2); font-size: var(--fs-xs); font-family: var(--font-mono); }
</style>
