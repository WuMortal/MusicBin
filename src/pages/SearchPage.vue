<script setup lang="ts">
import { reactive, ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import {
  Search, Download, Play, Pause, Music2, FolderOpen, LoaderCircle, Sparkles,
  SkipBack, SkipForward, Volume2, VolumeX, ListMusic, Trash2, X,
} from 'lucide-vue-next'
import {
  searchMusic, guessMusics, getPlayUrl, downloadTrack, getTrackMeta,
} from '../lib/musicApi'
import {
  ensureDownloadDir, setDownloadDir, getDownloadDir, addHistory,
  getPlayHistory, addPlayRecord, clearPlayHistory,
} from '../lib/settings'
import { useToast } from '../composables/toast'
import { confirm } from '../composables/confirm'
import EmptyState from '../components/EmptyState.vue'
import type { Track, PlayRecord } from '../types'

const toast = useToast()

const keyword = ref('')
const tracks = ref<Track[]>([])
const suggestions = ref<Track[]>([])
const searching = ref(false)
const searched = ref(false)
const loadingIds = reactive(new Set<string>())
const progress = reactive<Record<string, { downloaded: number; total: number; done?: boolean }>>({})

const playingId = ref<string | null>(null)
const playingTitle = ref('')
const playingAuthor = ref('')
const playingSource = ref('')
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const audio = ref<HTMLAudioElement | null>(null)
const downloadDir = ref(getDownloadDir())
const recentPlays = ref<PlayRecord[]>(getPlayHistory())
const queue = ref<Track[]>([])
const volume = ref(1)
/** 浮层互斥：同一时间只允许一个弹框打开 */
const openPanel = ref<'' | 'vol' | 'lyrics' | 'list'>('')

function togglePanel(p: 'vol' | 'lyrics' | 'list') {
  openPanel.value = openPanel.value === p ? '' : p
}

/** 播放栏是否有歌曲（含仅恢复信息、尚未开始播放的情况） */
const hasTrack = computed(() => !!playingId.value)

/* 试听时的封面与歌词 */
interface LrcLine { time: number; text: string }
const coverUrl = ref('')
const lyrics = ref<LrcLine[]>([])
const lyricsBox = ref<HTMLElement | null>(null)

/** 解析 LRC 时间轴，支持一行多时间戳与 [mm:ss.xx] / [mm:ss.xxx] */
function parseLrc(raw: string): LrcLine[] {
  const out: LrcLine[] = []
  for (const line of raw.split('\n')) {
    const tags = [...line.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)]
    if (!tags.length) continue
    const text = line.replace(/\[[^\]]*\]/g, '').trim()
    if (!text) continue
    for (const t of tags) {
      const frac = t[3] || ''
      const ms = frac ? Number(frac) * (frac.length === 3 ? 1 : frac.length === 2 ? 10 : 100) : 0
      out.push({ time: Number(t[1]) * 60 + Number(t[2]) + ms / 1000, text })
    }
  }
  return out.sort((a, b) => a.time - b.time)
}

/** 当前播放到第几行歌词 */
const activeLine = computed(() => {
  const list = lyrics.value
  if (!list.length) return -1
  let idx = -1
  for (let i = 0; i < list.length; i++) {
    if (list[i].time <= currentTime.value + 0.2) idx = i
    else break
  }
  return idx
})

// 歌词自动居中滚动
watch(activeLine, (i) => {
  const box = lyricsBox.value
  if (!box || i < 0) return
  const el = box.children[i] as HTMLElement | undefined
  if (!el) return
  box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' })
})

/** 播放栏右侧显示的当前歌词 */
const currentLyric = computed(() => {
  const i = activeLine.value
  return i >= 0 ? lyrics.value[i].text : ''
})

/* 播放队列：从列表试听时建立，用于上一首/下一首 */
const queueIndex = computed(() => queue.value.findIndex(t => t.id === playingId.value))
const canPrev = computed(() => queueIndex.value > 0)
const canNext = computed(() => queueIndex.value >= 0 && queueIndex.value < queue.value.length - 1)

let unlisten: UnlistenFn | null = null
let searchTimer: ReturnType<typeof setTimeout> | undefined

const quickWords = ['周杰伦', '驿动的心', '晴天']

onMounted(async () => {
  // 播放栏常驻：有历史记录时恢复上一次播放的歌曲信息（不自动播放，封面/歌词在真正播放时再加载）
  const last = recentPlays.value[0]
  if (last) {
    playingId.value = last.id
    playingTitle.value = last.title
    playingAuthor.value = last.author
    playingSource.value = last.source || 'gequbao'
  }
  unlisten = await listen<{ file: string; downloaded: number; total: number; done?: boolean }>(
    'download-progress',
    (e) => {
      const name = e.payload.file.replace(/\.mp3$/i, '')
      progress[name] = {
        downloaded: e.payload.downloaded,
        total: e.payload.total,
        done: e.payload.done,
      }
    },
  )
})

onBeforeUnmount(() => {
  unlisten?.()
  clearTimeout(searchTimer)
  audio.value?.pause()
})

function scheduleSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, 350)
}

async function runSearch() {
  const kw = keyword.value.trim()
  if (!kw || searching.value) return
  searching.value = true
  searched.value = true
  tracks.value = []
  suggestions.value = []
  try {
    const list = await searchMusic(kw)
    tracks.value = list
    if (!list.length) {
      suggestions.value = await guessMusics(kw).catch(() => [])
    }
  } catch (e) {
    toast.error('搜索失败：' + ((e as Error).message || e))
  } finally {
    searching.value = false
  }
}

function fillKw(word: string) {
  keyword.value = word
  void runSearch()
}

async function togglePlay(track: Track) {
  const el = audio.value
  if (!el) return
  if (playingId.value === track.id) {
    if (el.paused) { await el.play(); isPlaying.value = true }
    else { el.pause(); isPlaying.value = false }
    return
  }
  toast.info('正在获取播放链接…', 1600)
  try {
    // 直链与封面/歌词并行取；元数据失败不影响试听
    const [result, meta] = await Promise.all([
      getPlayUrl(track),
      getTrackMeta(track).catch(() => null),
    ])
    playingId.value = track.id
    playingTitle.value = track.title
    playingAuthor.value = track.author || meta?.author || ''
    playingSource.value = track.source || 'gequbao'
    coverUrl.value = meta?.cover || ''
    lyrics.value = meta?.lrc ? parseLrc(meta.lrc) : []
    openPanel.value = ''
    el.src = result.url
    await el.play()
    isPlaying.value = true
    addPlayRecord({
      id: track.id,
      title: track.title,
      author: playingAuthor.value,
      time: new Date().toLocaleString('zh-CN', { hour12: false }),
      source: track.source || 'gequbao',
    })
    recentPlays.value = getPlayHistory()
  } catch (e) {
    toast.error((e as Error).message || '播放失败')
  }
}

/** 从列表试听：同时建立播放队列，供上一首/下一首切换 */
function playFromList(track: Track, list: Track[]) {
  queue.value = list
  void togglePlay(track)
}

/** 上一首 / 下一首 */
function playStep(step: number) {
  const i = queueIndex.value
  const next = queue.value[i + step]
  if (i < 0 || !next) return
  void togglePlay(next)
}

watch(volume, (v) => {
  if (audio.value) audio.value.volume = v
})

/** 播放列表弹框入口：直接把整条记录建立为播放队列（按记录所属源路由） */
function playRecent(r: PlayRecord) {
  const list: Track[] = recentPlays.value.map(x => ({
    id: x.id, title: x.title, author: x.author, source: x.source || 'gequbao',
  }))
  openPanel.value = ''
  playFromList({ id: r.id, title: r.title, author: r.author, source: r.source || 'gequbao' }, list)
}

async function clearRecent() {
  const ok = await confirm({
    title: '清空播放列表',
    content: '将删除全部播放记录，不影响已下载的文件。',
    confirmText: '清空',
    danger: true,
  })
  if (!ok) return
  clearPlayHistory()
  recentPlays.value = []
  openPanel.value = ''
  // 播放栏回到空状态
  const el = audio.value
  el?.pause()
  el?.removeAttribute('src')
  el?.load()
  playingId.value = null
  playingTitle.value = ''
  playingAuthor.value = ''
  playingSource.value = ''
  coverUrl.value = ''
  lyrics.value = []
  queue.value = []
  isPlaying.value = false
  currentTime.value = 0
  duration.value = 0
}

async function download(track: Track) {
  if (loadingIds.has(track.id)) return
  let dir = downloadDir.value || await ensureDownloadDir()
  if (!dir) {
    await pickDir()
    dir = downloadDir.value
  }
  if (!dir) return
  const fileBase = `${track.title} - ${track.author}`.trim()
  loadingIds.add(track.id)
  progress[fileBase] = { downloaded: 0, total: 0 }
  try {
    toast.info('正在获取音源并写入封面与歌词…', 1600)
    const saved = await downloadTrack(track, dir)
    addHistory({
      key: `${track.id}-${Date.now()}`,
      title: track.title,
      author: track.author,
      path: saved.path,
      size: saved.size,
      time: new Date().toLocaleString('zh-CN', { hour12: false }),
    })
    toast.success(`已下载：${fileBase}`)
  } catch (e) {
    toast.error((e as Error).message || '下载失败')
    delete progress[fileBase]
  } finally {
    loadingIds.delete(track.id)
  }
}

async function pickDir() {
  const picked = await open({ directory: true, title: '选择下载目录' })
  if (typeof picked === 'string' && picked) {
    setDownloadDir(picked)
    downloadDir.value = picked
    toast.success('下载目录已更新')
  }
}

function toggleCurrent() {
  if (!hasTrack.value) {
    toast.info('还没有播放中的歌曲，先去搜索一首吧')
    return
  }
  void togglePlay({
    id: playingId.value!, title: playingTitle.value,
    author: playingAuthor.value, source: playingSource.value || 'gequbao',
  })
}

/** 点击歌词行跳转到对应时间 */
function seekTo(t: number) {
  const el = audio.value
  if (!el) return
  el.currentTime = t
  currentTime.value = t
}

function onTimeUpdate() {
  if (!audio.value) return
  currentTime.value = audio.value.currentTime
  duration.value = Number.isFinite(audio.value.duration) ? audio.value.duration : 0
}

function onEnded() { isPlaying.value = false; currentTime.value = 0 }

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function pct(key: string): number {
  const p = progress[key]
  if (!p || !p.total) return 0
  return Math.min(100, Math.round((p.downloaded / p.total) * 100))
}
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <h1>音乐搜索</h1>
        <p>搜索并试听，喜欢的单曲可下载到本地</p>
      </div>
      <button class="btn btn-ghost dir-btn" @click="pickDir">
        <FolderOpen :size="16" />
        <span class="dir-text">{{ downloadDir || '设置下载目录' }}</span>
      </button>
    </header>

    <div class="search-bar">
      <div class="input-wrap">
        <!-- <Search :size="18" class="s-ico" /> -->
        <input v-model="keyword" type="search" placeholder="输入歌曲名或歌手，回车搜索" @keydown.enter="runSearch"
          @input="scheduleSearch" />
      </div>
      <button class="btn btn-primary search-btn" :disabled="searching" @click="runSearch">
        <LoaderCircle v-if="searching" :size="16" class="spin" />
        <Search v-else :size="16" />
        {{ searching ? '搜索中' : '搜索' }}
      </button>
    </div>

    <div class="quick">
      <span>试试：</span>
      <button v-for="w in quickWords" :key="w" class="chip" @click="fillKw(w)">{{ w }}</button>
    </div>

    <div class="result-head" v-if="searched && !searching">
      <span>{{ keyword }} 的搜索结果</span>
      <small v-if="tracks.length">共 {{ tracks.length }} 首 · 站点固定返回热门结果</small>
    </div>

    <div class="list-wrap has-player">
      <div v-if="searching" class="page-loading">
        <div class="spinner-lg" /><span>正在搜索…</span>
      </div>

      <EmptyState v-else-if="!searched" :icon="Music2" title="开始搜索你想要的音乐" description="输入关键词，或点击上方的快捷搜索" />

      <template v-else-if="tracks.length">
        <div class="grid">
          <article v-for="(t, i) in tracks" :key="t.id" class="track" :class="{ playing: playingId === t.id }">
            <div class="track-top">
              <span class="rank">{{ String(i + 1).padStart(2, '0') }}</span>
              <div class="meta">
                <h3 :title="t.title">{{ t.title }}</h3>
                <p :title="t.author">{{ t.author || '未知歌手' }}</p>
              </div>
              <button class="play-btn" :title="playingId === t.id && isPlaying ? '暂停' : '试听'"
                @click="playFromList(t, tracks)">
                <Pause v-if="playingId === t.id && isPlaying" :size="16" />
                <Play v-else :size="16" />
              </button>
            </div>
            <div class="track-bottom">
              <button class="btn btn-sm dl-btn" :disabled="loadingIds.has(t.id)" @click="download(t)">
                <LoaderCircle v-if="loadingIds.has(t.id)" :size="14" class="spin" />
                <Download v-else :size="14" />
                {{ loadingIds.has(t.id) ? '处理中' : '下载' }}
              </button>
              <div v-if="progress[`${t.title} - ${t.author}`] && loadingIds.has(t.id)" class="mini-prog">
                <div class="fill" :style="{ width: pct(`${t.title} - ${t.author}`) + '%' }" />
              </div>
            </div>
          </article>
        </div>
      </template>

      <div v-else class="no-result">
        <EmptyState :icon="Music2" title="没有找到相关歌曲" description="换个关键词试试，或看看下面的相似推荐" />
        <div v-if="suggestions.length" class="suggest">
          <div class="suggest-title">
            <Sparkles :size="14" /> 猜你想找
          </div>
          <button v-for="s in suggestions" :key="s.id" class="suggest-item" @click="fillKw(s.title)">
            <strong>{{ s.title }}</strong>
            <small>{{ s.author }}</small>
          </button>
        </div>
      </div>
    </div>

    <!-- 播放栏常驻：无播放记录时展示空状态；三个浮层互斥，同一时间只显示一个 -->
    <div class="player-wrap">
      <!-- 歌词浮层：从右侧「词」按钮上方弹出，不挤压列表 -->
      <div v-if="openPanel === 'lyrics' && lyrics.length" class="lyrics">
        <div ref="lyricsBox" class="lyrics-scroll">
          <p v-for="(l, i) in lyrics" :key="i" :class="{ on: i === activeLine }" @click="seekTo(l.time)">{{ l.text }}
          </p>
        </div>
      </div>

      <!-- 播放列表浮层：从右侧列表按钮上方弹出 -->
      <div v-if="openPanel === 'list'" class="playlist-pop">
        <div class="playlist-head">
          <strong>播放列表({{ recentPlays.length }})</strong>
          <div class="playlist-actions">
            <button v-if="recentPlays.length" class="playlist-clear" @click="clearRecent">
              <Trash2 :size="14" />
              <span>清除</span>
            </button>
            <button class="icon-btn playlist-close" title="关闭" @click="openPanel = ''">
              <X :size="15" />
            </button>
          </div>
        </div>
        <div v-if="recentPlays.length" class="playlist-scroll">
          <button v-for="r in recentPlays" :key="r.id" class="playlist-item"
            :class="{ on: playingId === r.id }" :title="`${r.title} - ${r.author}`" @click="playRecent(r)">
            <Music2 :size="14" class="pi-ico" />
            <span class="pi-meta">
              <strong>{{ r.title }}</strong>
              <small>{{ r.author || '未知歌手' }} · {{ r.time }}</small>
            </span>
          </button>
        </div>
        <EmptyState v-else :icon="Music2" title="你还没有添加任何歌曲" description="去搜索一首喜欢的音乐，试听后会自动出现在这里" />
      </div>

      <div class="player">
        <div class="player-info">
          <div class="cover">
            <img v-if="coverUrl" :src="coverUrl" alt="" />
            <Music2 v-else :size="18" />
          </div>
          <div class="player-text">
            <strong :title="hasTrack ? playingTitle : '暂无播放'">
              {{ hasTrack ? playingTitle : '暂无播放' }}
            </strong>
            <small :title="hasTrack ? playingAuthor : '去搜索页挑选一首歌'">
              {{ hasTrack ? (playingAuthor || '未知歌手') : '去搜索页挑选一首歌' }}
            </small>
          </div>
        </div>

        <div class="player-ctrl">
          <button class="icon-btn" :disabled="!canPrev" title="上一首" @click="playStep(-1)">
            <SkipBack :size="16" />
          </button>
          <button class="player-toggle" :class="{ disabled: !hasTrack }" @click="toggleCurrent">
            <Pause v-if="isPlaying" :size="18" />
            <Play v-else :size="18" />
          </button>
          <button class="icon-btn" :disabled="!canNext" title="下一首" @click="playStep(1)">
            <SkipForward :size="16" />
          </button>
        </div>

        <div class="player-progress">
          <span>{{ fmtTime(currentTime) }}</span>
          <div class="bar">
            <div class="fill" :style="{ width: (duration ? currentTime / duration * 100 : 0) + '%' }" />
          </div>
          <span>{{ fmtTime(duration) }}</span>
        </div>

        <div class="player-vol">
          <button class="icon-btn" :class="{ on: openPanel === 'vol' }" :title="volume ? '音量' : '已静音'"
            @click="togglePanel('vol')">
            <VolumeX v-if="!volume" :size="16" />
            <Volume2 v-else :size="16" />
          </button>
        </div>

        <div class="player-list">
          <button class="icon-btn" :class="{ on: openPanel === 'list' }" title="播放列表" @click="togglePanel('list')">
            <ListMusic :size="16" />
          </button>
        </div>

        <div class="player-lyric" :class="{ on: openPanel === 'lyrics', 'is-empty': !hasTrack }"
          @click="hasTrack && togglePanel('lyrics')">
          <div class="lyric-line">
            <Transition name="lyric" mode="out-in">
              <span :key="currentLyric">{{ currentLyric || (hasTrack ? '暂无歌词' : '暂无播放') }}</span>
            </Transition>
          </div>
          <span class="lyric-btn" title="完整歌词">词</span>
        </div>
      </div>

      <!-- 音量浮层放在 .player 之外：.player 自身有 backdrop-filter，会成为新的
           backdrop 根，子元素的 backdrop-filter 只能采样到播放栏内部，模糊看起来不生效 -->
      <div class="vol-pop" :class="{ open: openPanel === 'vol' }">
        <div class="vol-track">
          <div class="vol-fill" :style="{ height: `${volume * 100}%` }" />
          <div class="vol-knob" :style="{ bottom: `calc(${volume * 100}% - 6px)` }" />
        </div>
        <input v-model.number="volume" class="vol-slider" type="range" min="0" max="1" step="0.01" aria-label="音量" />
      </div>
    </div>

    <!-- 必须常驻：放在 v-if 的播放器里时，首次点击 playingId 仍为 null，
         audio 引用拿不到，试听会静默失效 -->
    <audio ref="audio" preload="metadata" @timeupdate="onTimeUpdate" @loadedmetadata="onTimeUpdate" @ended="onEnded"
      @play="isPlaying = true" @pause="isPlaying = false" />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.head h1 {
  margin: 0 0 4px;
  font-size: var(--fs-2xl);
  font-weight: 600;
}

.head p {
  margin: 0;
  color: var(--c-text-2);
  font-size: var(--fs-sm);
}

.dir-btn {
  max-width: 260px;
}

.dir-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}

.search-bar input {
  height: var(--ctrl-h-lg);
  font-size: var(--fs-md);
}

.search-btn {
  height: var(--ctrl-h-lg);
  padding: 0 18px;
}

.quick {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 18px;
  color: var(--c-text-3);
  font-size: var(--fs-xs);
}

.chip {
  padding: 4px 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-pill);
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  transition: all var(--motion);
}

.chip:hover {
  background: var(--c-surface-hover);
  color: var(--c-text);
  border-color: var(--c-border-strong);
}

.result-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 10px;
  font-size: var(--fs-md);
  font-weight: 500;
}

.result-head small {
  color: var(--c-text-3);
  font-size: var(--fs-xs);
  font-weight: 400;
}

.list-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

/* 播放栏悬浮在列表之上，底部留出空间避免遮挡最后一行 */
.list-wrap.has-player {
  padding-bottom: 84px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px;
  align-content: start;
}

.track {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-xl);
  padding: 14px;
  transition: all var(--motion);
  backdrop-filter: blur(20px);
}

.track:hover {
  transform: translateY(-2px);
  border-color: var(--c-border-strong);
  box-shadow: var(--shadow-md);
}

.track.playing {
  border-color: var(--c-primary);
  box-shadow: 0 0 0 1px var(--c-primary-glow);
}

.track-top {
  display: flex;
  align-items: center;
  gap: 10px;
}

.rank {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  width: 20px;
}

.meta {
  flex: 1;
  min-width: 0;
}

.meta h3 {
  margin: 0 0 3px;
  font-size: var(--fs-md);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta p {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--c-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.play-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--c-primary-soft);
  color: var(--c-primary);
  transition: all var(--motion);
  flex-shrink: 0;
}

.play-btn:hover {
  background: var(--c-primary);
  color: #fff;
}

.track-bottom {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.dl-btn {
  flex-shrink: 0;
}

.mini-prog {
  flex: 1;
  height: 3px;
  border-radius: 99px;
  background: var(--c-border);
  overflow: hidden;
}

.mini-prog .fill {
  height: 100%;
  background: var(--c-primary);
  transition: width .2s ease;
}

.no-result {
  display: flex;
  flex-direction: column;
}

.suggest {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
  padding: 0 20px 24px;
}

.suggest-title {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--c-text-2);
  font-size: var(--fs-sm);
  margin-bottom: 4px;
}

.suggest-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-glass);
  transition: all var(--motion);
}

.suggest-item:hover {
  border-color: var(--c-primary);
  background: var(--c-surface-hover);
}

.suggest-item strong {
  font-size: var(--fs-sm);
  font-weight: 500;
}

.suggest-item small {
  color: var(--c-text-3);
  font-size: var(--fs-xs);
}

.player-wrap {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
}

.player {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 14px;
  background: var(--c-glass-strong);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-lg);
  margin-bottom: 2px;
}

.player-info {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 190px;
  flex-shrink: 0;
}

.cover {
  width: 38px;
  height: 38px;
  border-radius: var(--r-md);
  background: var(--c-ink);
  display: grid;
  place-items: center;
  color: #fff;
  overflow: hidden;
  flex-shrink: 0;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.player-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.player-text strong {
  font-size: var(--fs-sm);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-text small {
  color: var(--c-text-3);
  font-size: var(--fs-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-ctrl {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.player-toggle {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--c-primary);
  color: #fff;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.player-toggle:hover {
  background: var(--c-primary-press);
}

/* 空状态：没有可播放歌曲时 */
.player-toggle.disabled {
  background: var(--c-surface-2);
  color: var(--c-text-3);
  cursor: default;
}

.icon-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  color: var(--c-text-2);
  transition: all var(--motion);
}

.icon-btn:hover:not(:disabled) {
  background: var(--c-surface-hover);
  color: var(--c-text);
}

.icon-btn:disabled {
  opacity: 0.32;
  cursor: default;
}

.player-progress {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  font-family: var(--font-mono);
}

.player-progress .bar {
  flex: 1;
  height: 4px;
  background: var(--c-border);
  border-radius: 99px;
  overflow: hidden;
}

.player-progress .fill {
  height: 100%;
  background: var(--c-primary);
}

.player-vol {
  flex-shrink: 0;
}

.player-vol .icon-btn.on,
.player-list .icon-btn.on {
  color: var(--c-primary);
}

.vol-pop {
  /* 定位锚在 .player-wrap 上（与播放栏同级），right 对齐喇叭按钮中心 */
  position: absolute;
  right: 268px;
  bottom: calc(100% + 3px);
  width: 36px;
  height: 116px;
  padding: 14px 0;
  border-radius: 12px;
  box-sizing: border-box;
  /* 与播放栏同一套玻璃底，保证视觉统一 */
  background: var(--c-glass-strong);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--c-border-strong);
  box-shadow: var(--shadow-lg);
  opacity: 0;
  pointer-events: none;
  transition: opacity .18s ease;
  z-index: 7;
}

.vol-pop.open {
  opacity: 1;
  pointer-events: auto;
}

/* 自绘轨道 + 滑块：原生竖向 range 只负责交互，视觉完全可控 */
.vol-track {
  position: absolute;
  top: 14px;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  background: var(--c-border-strong);
  border-radius: 99px;
}

.vol-fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--c-primary);
  border-radius: 99px;
}

.vol-knob {
  position: absolute;
  left: 50%;
  margin-left: -6px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--c-primary);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.14);
}

.vol-slider {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  writing-mode: vertical-lr;
  direction: rtl;
  opacity: 0;
  cursor: pointer;
  margin: 0;
  outline: none;
}

/* 播放栏右侧当前歌词：单行滚动，点「词」展开完整歌词 */
.player-lyric {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 200px;
  flex-shrink: 0;
  padding-left: 12px;
  border-left: 1px solid var(--c-border-hairline);
  font-size: var(--fs-sm);
  color: var(--c-text-2);
  cursor: pointer;
}

.lyric-line {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.lyric-btn {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  background: var(--c-surface);
  color: var(--c-text-3);
  font-size: 11px;
  line-height: 1;
  transition: all var(--motion);
}

.player-lyric:hover .lyric-btn {
  color: var(--c-text);
}

.player-lyric.on .lyric-btn {
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.player-lyric.is-empty {
  cursor: default;
}

.lyric-enter-active,
.lyric-leave-active {
  transition: opacity .22s ease;
}

.lyric-enter-from,
.lyric-leave-to {
  opacity: 0;
}

/* 歌词浮层：从「词」上方浮出，上下渐隐、当前行放大高亮 */
.lyrics {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 6;
  width: 360px;
  height: 300px;
  overflow: hidden;
  background: var(--c-glass-panel);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid var(--c-border-strong);
  border-radius: 16px;
  box-shadow: var(--shadow-lg), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

/* 渐隐遮罩只作用在滚动层，避免把面板边框一起吃掉 */
.lyrics-scroll {
  height: 100%;
  overflow-y: auto;
  padding: 30px 22px;
  text-align: center;
  scrollbar-width: none;
  mask-image: linear-gradient(to bottom, transparent 0, #000 16%, #000 84%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 16%, #000 84%, transparent 100%);
}

.lyrics-scroll::-webkit-scrollbar {
  display: none;
}

.lyrics p {
  margin: 0;
  padding: 7px 0;
  font-size: var(--fs-sm);
  color: var(--c-text-3);
  cursor: pointer;
  line-height: 1.6;
  transition: color .25s ease, font-size .25s ease;
}

.lyrics p:hover {
  color: var(--c-text-2);
}

.lyrics p.on {
  color: var(--c-primary);
  font-weight: 600;
  font-size: var(--fs-md);
}

/* 播放列表浮层：与歌词浮层同一套玻璃面板，从右侧按钮上方浮出 */
.player-list {
  flex-shrink: 0;
}

.playlist-pop {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 6;
  width: 340px;
  height: 320px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--c-glass-panel);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid var(--c-border-strong);
  border-radius: 16px;
  box-shadow: var(--shadow-lg), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.playlist-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--c-border-hairline);
}

.playlist-head strong {
  font-size: var(--fs-md);
  font-weight: 600;
}

.playlist-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.playlist-clear {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--r-sm);
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  transition: all var(--motion);
}

.playlist-clear:hover {
  color: var(--c-danger);
  background: var(--c-surface-hover);
}

.playlist-close {
  width: 24px;
  height: 24px;
}

.playlist-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 8px;
}

.playlist-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  margin: 3px 0;
  border-radius: var(--r-md);
  text-align: left;
  color: var(--c-text-2);
  transition: all var(--motion);
}

.playlist-item:hover {
  background: var(--c-surface-hover);
  color: var(--c-text);
}

.playlist-item.on {
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.pi-ico {
  flex-shrink: 0;
  color: var(--c-text-3);
}

.playlist-item.on .pi-ico {
  color: var(--c-primary);
}

.pi-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.pi-meta strong {
  font-size: var(--fs-sm);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pi-meta small {
  font-size: var(--fs-xs);
  color: var(--c-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
