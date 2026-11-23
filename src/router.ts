import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'search', component: () => import('./pages/SearchPage.vue'), meta: { title: '音乐搜索', icon: 'search' } },
    { path: '/downloads', name: 'downloads', component: () => import('./pages/DownloadsPage.vue'), meta: { title: '下载记录', icon: 'download' } },
    { path: '/settings', name: 'settings', component: () => import('./pages/SettingsPage.vue'), meta: { title: '设置', icon: 'settings' } },
  ],
})

export default router
