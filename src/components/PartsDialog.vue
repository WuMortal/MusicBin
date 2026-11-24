<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ListMusic, X } from 'lucide-vue-next'
import type { Track } from '../types'

const props = defineProps<{
  visible: boolean
  title: string
  parts: Track[]
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'confirm', parts: Track[]): void
}>()

const selected = ref<Set<string>>(new Set())

// 每次打开都默认全选，用户可自行取消
watch(
  [() => props.visible, () => props.parts],
  ([visible]) => {
    if (visible) selected.value = new Set(props.parts.map(p => p.id))
  },
  { immediate: true },
)

const allChecked = computed(() => props.parts.length > 0 && selected.value.size === props.parts.length)
const count = computed(() => selected.value.size)

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function toggleAll() {
  selected.value = allChecked.value ? new Set() : new Set(props.parts.map(p => p.id))
}

function close() {
  emit('update:visible', false)
}

function confirm() {
  if (!count.value) return
  emit('confirm', props.parts.filter(p => selected.value.has(p.id)))
  close()
}
</script>

<template>
  <Teleport to="body">
    <transition name="pd">
      <div v-if="visible" class="pd-mask" @click.self="close">
        <div class="pd-card">
          <button class="pd-x" @click="close">
            <X :size="16" style="display: inline-flex; flex-shrink: 0" />
          </button>

          <div class="pd-head">
            <div class="pd-ico">
              <ListMusic :size="20" style="display: inline-flex; flex-shrink: 0" />
            </div>
            <div class="pd-titles">
              <h3 class="pd-title">选择要下载的分 P</h3>
              <p class="pd-sub" :title="title">{{ title }} · 共 {{ parts.length }} 个分 P</p>
            </div>
          </div>

          <div class="pd-tools">
            <label class="pd-all">
              <input type="checkbox" :checked="allChecked" @change="toggleAll" />
              <span>{{ allChecked ? '取消全选' : '全选' }}</span>
            </label>
            <span class="pd-count">已选 {{ count }} / {{ parts.length }}</span>
          </div>

          <div class="pd-list">
            <label v-for="(p, i) in parts" :key="p.id" class="pd-item" :class="{ on: selected.has(p.id) }">
              <input type="checkbox" :checked="selected.has(p.id)" @change="toggle(p.id)" />
              <span class="pd-idx">{{ i + 1 }}</span>
              <span class="pd-name" :title="p.title">{{ p.title }}</span>
            </label>
          </div>

          <div class="pd-actions">
            <button class="btn btn-ghost" @click="close">取消</button>
            <button class="btn btn-primary" :disabled="!count" @click="confirm">下载所选（{{ count }}）</button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.pd-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: grid;
  place-items: center;
  padding: 24px;
  animation: pd-in 200ms ease;
}

@keyframes pd-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

.pd-card {
  position: relative;
  width: min(560px, 92vw);
  max-height: min(80vh, 640px);
  display: flex;
  flex-direction: column;
  background: var(--c-elevated);
  border: 1px solid var(--c-border);
  border-radius: var(--r-2xl);
  box-shadow: var(--shadow-lg);
  padding: 22px 22px 18px;
  animation: pd-card-in 250ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes pd-card-in {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(10px);
  }

  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.pd-x {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--c-text-3);
  cursor: pointer;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  transition: all var(--motion);
}

.pd-x:hover {
  background: var(--c-glass);
  color: var(--c-text);
}

.pd-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding-right: 24px;
}

.pd-ico {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
  background: var(--c-primary-soft);
  color: var(--c-primary);
}

.pd-titles {
  min-width: 0;
}

.pd-title {
  margin: 0 0 4px;
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--c-text);
}

.pd-sub {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--c-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pd-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 16px 0 10px;
  padding: 8px 10px;
  border-radius: var(--r-md);
  background: var(--c-bg-2);
}

.pd-all {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text);
  cursor: pointer;
  user-select: none;
}

.pd-count {
  font-size: var(--fs-sm);
  color: var(--c-text-2);
}

.pd-list {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: 4px;
  border-top: 1px solid var(--c-border-hairline);
  border-bottom: 1px solid var(--c-border-hairline);
  padding-top: 6px;
  padding-bottom: 6px;
}

.pd-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background-color var(--motion-fast);
}

.pd-item:hover {
  background: var(--c-surface-hover);
}

.pd-item.on {
  background: var(--c-primary-soft);
}

.pd-item input[type='checkbox'],
.pd-all input[type='checkbox'] {
  width: 15px;
  height: 15px;
  accent-color: var(--c-primary);
  cursor: pointer;
  flex-shrink: 0;
}

.pd-idx {
  width: 30px;
  flex-shrink: 0;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--c-text-3);
  text-align: right;
}

.pd-name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  color: var(--c-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.pd-enter-active,
.pd-leave-active {
  transition: opacity 200ms ease;
}

.pd-enter-active .pd-card,
.pd-leave-active .pd-card {
  transition: transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.pd-enter-from,
.pd-leave-to {
  opacity: 0;
}

.pd-enter-from .pd-card,
.pd-leave-to .pd-card {
  transform: scale(0.95) translateY(10px);
}
</style>
