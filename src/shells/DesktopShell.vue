<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search, Download, Settings, Moon, Sun, Music2 } from 'lucide-vue-next'
import { useTheme } from '../composables/useTheme'
import routerConfig from '../router'
import logoUrl from '../assets/logo.svg'

const route = useRoute()
const router = useRouter()
const { resolved, setTheme } = useTheme()

const icons: Record<string, typeof Search> = { search: Search, download: Download, settings: Settings }
const navItems = computed(() =>
  routerConfig.options.routes
    .filter(r => r.meta?.title)
    .map(r => ({ path: r.path, title: r.meta!.title as string, icon: icons[r.meta!.icon as string] || Search })),
)

function toggleTheme() {
  setTheme(resolved.value === 'dark' ? 'light' : 'dark')
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark"><img :src="logoUrl" alt="音藏" /></div>
        <div class="brand-text">
          <strong>音藏</strong>
          <small>music bin</small>
        </div>
      </div>

      <nav class="nav">
        <button
          v-for="item in navItems"
          :key="item.path"
          class="nav-item"
          :class="{ on: route.path === item.path }"
          @click="router.push(item.path)"
        >
          <component :is="item.icon" :size="18" />
          <span>{{ item.title }}</span>
        </button>
      </nav>

      <div class="side-bottom">
        <button class="nav-item" @click="toggleTheme">
          <component :is="resolved === 'dark' ? Sun : Moon" :size="18" />
          <span>{{ resolved === 'dark' ? '浅色模式' : '深色模式' }}</span>
        </button>
        <div class="side-tip"><Music2 :size="14" /> 本地播放 · 单曲下载</div>
      </div>
    </aside>

    <main class="content">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.shell { display: flex; height: 100%; overflow: hidden; background: var(--c-bg); }
.sidebar {
  width: var(--sidebar-w-expanded); flex-shrink: 0; display: flex; flex-direction: column;
  padding: 20px 12px 16px; background: var(--c-glass); border-right: 1px solid var(--c-border);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); position: relative;
}
.sidebar::after {
  content: ''; position: absolute; right: -1px; top: 0; width: 1px; height: 84px;
  background: var(--c-primary); opacity: .45;
}
.brand { display: flex; align-items: center; gap: 10px; padding: 4px 8px 24px; }
.brand-mark {
  width: 38px; height: 38px; border-radius: var(--r-lg); overflow: hidden;
  display: grid; place-items: center; box-shadow: var(--shadow-glow); flex-shrink: 0;
}
.brand-mark img { width: 100%; height: 100%; object-fit: contain; display: block; }
.brand-text { display: flex; flex-direction: column; line-height: 1.25; }
.brand-text strong { font-size: var(--fs-lg); font-weight: 600; letter-spacing: .5px; }
.brand-text small { font-size: 9px; letter-spacing: 1.4px; color: var(--c-text-3); }
.nav { display: flex; flex-direction: column; gap: 3px; }
.nav-item {
  display: flex; align-items: center; gap: 11px; width: 100%; height: 38px; padding: 0 12px;
  border-radius: var(--r-md); color: var(--c-text-2); font-size: var(--fs-md);
  transition: all var(--motion); text-align: left;
}
.nav-item:hover { background: var(--c-surface-hover); color: var(--c-text); }
.nav-item.on { background: var(--c-primary-soft); color: var(--c-primary); font-weight: 500; }
.side-bottom { margin-top: auto; display: flex; flex-direction: column; gap: 8px; }
.side-tip {
  display: flex; align-items: center; gap: 6px; padding: 10px 12px; color: var(--c-text-3);
  font-size: var(--fs-xs); border-top: 1px solid var(--c-border-hairline);
}
.content { flex: 1; min-width: 0; padding: 24px 32px; overflow: hidden; display: flex; flex-direction: column; }
</style>
