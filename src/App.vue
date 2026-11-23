<script setup lang="ts">
import DesktopShell from './shells/DesktopShell.vue'
import Toast from './components/Toast.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
</script>

<template>
  <DesktopShell>
    <router-view v-slot="{ Component, route }">
      <transition name="page" mode="out-in">
        <component :is="Component" :key="route.path" />
      </transition>
    </router-view>
  </DesktopShell>
  <Toast />
  <ConfirmDialog />
</template>
