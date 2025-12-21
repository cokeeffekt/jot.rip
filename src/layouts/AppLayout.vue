<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { listAllTabs, listImages, listNotes } from '../db'
import { syncActive, syncEnabled } from '../sync/state'
import { triggerSync } from '../sync/poller'

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice?: Promise<any> }
const navItems = [
  { label: 'Import', to: { name: 'import' } },
  { label: 'Settings', to: { name: 'settings' } },
  { label: 'Help', to: { name: 'help' } },
  { label: 'About', to: { name: 'about' } },
]

const menuOpen = ref(false)
const toggleMenu = () => {
  menuOpen.value = !menuOpen.value
}
const closeMenu = () => {
  menuOpen.value = false
}

const syncing = computed(() => syncActive.value)
const syncOn = computed(() => syncEnabled.value)

type MenuStats = { notes: number; tabs: number; images: number; bytes: number }
const stats = ref<MenuStats>({ notes: 0, tabs: 0, images: 0, bytes: 0 })
const textBytes = (text: string) => new TextEncoder().encode(text).byteLength
const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

const loadStats = async () => {
  const [notes, tabs, images] = await Promise.all([listNotes(), listAllTabs(), listImages()])
  const next: MenuStats = { notes: notes.length, tabs: tabs.length, images: images.length, bytes: 0 }
  for (const note of notes) {
    next.bytes += textBytes(note.title ?? '')
  }
  for (const tab of tabs) {
    next.bytes += textBytes(tab.content ?? '')
  }
  for (const image of images) {
    next.bytes += image.blob?.size ?? 0
    if (image.thumbnailDataUrl) next.bytes += textBytes(image.thumbnailDataUrl)
  }
  stats.value = next
}

const handleSyncComplete = () => loadStats()

onMounted(() => {
  loadStats()
  window.addEventListener('jotrip:sync-complete', handleSyncComplete)
})

onBeforeUnmount(() => {
  window.removeEventListener('jotrip:sync-complete', handleSyncComplete)
})

const installPromptEvent = ref<BeforeInstallPromptEvent | null>(null)
const installAvailable = computed(() => !!installPromptEvent.value)

const handleBeforeInstall = (e: Event) => {
  if (import.meta.env.DEV) return
  e.preventDefault()
  installPromptEvent.value = e as BeforeInstallPromptEvent
}

const promptInstall = async () => {
  if (!installPromptEvent.value) return
  const evt = installPromptEvent.value
  installPromptEvent.value = null
  await evt.prompt()
}

onMounted(() => {
  if (!import.meta.env.DEV) {
    window.addEventListener('beforeinstallprompt', handleBeforeInstall as any)
  }
})

onBeforeUnmount(() => {
  if (!import.meta.env.DEV) {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstall as any)
  }
})
</script>

<template>
  <div class="h-full overflow-hidden bg-[#060913] text-slate-100">
    <div class="mx-auto flex h-full max-w-6xl flex-col px-0 py-2 sm:px-6 sm:py-8">
      <header
        class="flex shrink-0 items-center justify-between border-b border-white/10 bg-gradient-to-b from-slate-950/80 to-slate-950/40 px-2 py-1 backdrop-blur sm:px-0"
      >
        <nav class="flex text-white">
          <RouterLink
            :to="{ name: 'home' }"
            class="px-3 py-1.5 text-sm font-semibold"
            :class="
              $route.name === 'home'
                ? 'bg-white/10 border-b-2 border-white/40'
                : 'bg-transparent border-b-2 border-transparent text-slate-300 hover:text-white'
            "
          >
            Home
          </RouterLink>
          <RouterLink
            :to="{ name: 'notes' }"
            class="px-3 py-1.5 text-sm font-semibold"
            :class="
              $route.name === 'notes'
                ? 'bg-white/10 border-b-2 border-white/40'
                : 'bg-transparent border-b-2 border-transparent text-slate-300 hover:text-white'
            "
          >
            Jots
          </RouterLink>
          <RouterLink
            :to="{ name: 'calendar' }"
            class="px-3 py-1.5 text-sm font-semibold"
            :class="
              $route.name === 'calendar'
                ? 'bg-white/10 border-b-2 border-white/40'
                : 'bg-transparent border-b-2 border-transparent text-slate-300 hover:text-white'
            "
          >
            Calendar
          </RouterLink>
        </nav>
        <div class="flex items-center gap-2">
          <RouterLink
            :to="{ name: 'note-editor', params: { id: 'new' } }"
            class="border border-indigo-300/30 bg-indigo-500/20 px-3 py-1.5 text-sm font-semibold text-white hover:border-indigo-200/60"
          >
            + Jot
          </RouterLink>
          <button
            v-if="installAvailable"
            type="button"
            class="hidden border border-emerald-300/40 bg-emerald-500/20 px-3 py-1.5 text-sm font-semibold text-white hover:border-emerald-200/60 sm:inline-flex"
            @click="promptInstall"
          >
            Install app
          </button>
          <button
            type="button"
            class="border border-white/10 px-3 py-1.5 text-white transition hover:border-white/40"
            @click="toggleMenu"
            aria-label="Open menu"
          >
            ☰
          </button>
        </div>
      </header>

      <main class="mt-2 flex-1 px-0 sm:px-0 overflow-hidden">
        <div class="flex h-full min-h-0 flex-col border-0 bg-transparent sm:border sm:border-white/10 sm:bg-white/5 sm:p-6 sm:shadow-2xl sm:shadow-indigo-900/30">
          <div class="flex-1 min-h-0 overflow-auto">
            <RouterView />
          </div>
        </div>
      </main>
    </div>

    <transition name="fade">
      <div v-if="menuOpen" class="fixed inset-0 z-40 bg-black/60 sm:hidden" @click="closeMenu"></div>
    </transition>
    <transition name="slide">
      <aside
        v-if="menuOpen"
        class="fixed inset-y-0 right-0 z-50 w-72 bg-slate-900/95 p-4 shadow-2xl shadow-black/70 sm:w-80 sm:p-6"
      >
        <div class="flex items-center justify-between text-white">
          <div class="flex items-center gap-2">
            <img src="/pwa-icon-192.png" alt="logo" class="h-6 w-6 rounded-sm object-contain" />
            <p class="text-sm font-semibold uppercase tracking-[0.15em] text-slate-200">jot.rip</p>
          </div>
          <button type="button" class="border border-white/20 px-3 py-1 text-xs" @click="closeMenu">✕</button>
        </div>
        <nav class="mt-4 space-y-2 sm:mt-6">
          <div class="rounded border border-white/10 bg-white/5 p-3 text-xs text-slate-200">
            <p class="mb-2 text-[11px] uppercase tracking-wide text-slate-400">Stats</p>
            <div class="grid grid-cols-2 gap-2">
              <div class="rounded border border-white/10 bg-black/10 p-2">
                <p class="text-[11px] text-slate-400">Jots</p>
                <p class="text-sm font-semibold text-white">{{ stats.notes }}</p>
              </div>
              <div class="rounded border border-white/10 bg-black/10 p-2">
                <p class="text-[11px] text-slate-400">Tabs</p>
                <p class="text-sm font-semibold text-white">{{ stats.tabs }}</p>
              </div>
              <div class="rounded border border-white/10 bg-black/10 p-2">
                <p class="text-[11px] text-slate-400">Images</p>
                <p class="text-sm font-semibold text-white">{{ stats.images }}</p>
              </div>
              <div class="rounded border border-white/10 bg-black/10 p-2">
                <p class="text-[11px] text-slate-400">Bytes</p>
                <p class="text-sm font-semibold text-white">{{ formatBytes(stats.bytes) }}</p>
              </div>
            </div>
          </div>
          <RouterLink
            v-for="item in navItems"
            :key="item.label"
            :to="item.to"
            class="flex items-center justify-between border px-3 py-2 text-sm font-semibold transition sm:px-4 sm:py-3"
            :class="[
              $route.name === item.to?.name
                ? 'border-indigo-400 bg-indigo-500/20 text-white'
                : 'border-white/10 text-slate-200 hover:border-white/30 hover:text-white',
            ]"
            @click="closeMenu"
          >
            {{ item.label }}
            <span aria-hidden="true">→</span>
          </RouterLink>
          <button
            v-if="syncOn"
            type="button"
            class="flex w-full items-center justify-between border px-3 py-2 text-sm font-semibold transition sm:px-4 sm:py-3"
            :class="syncing ? 'border-emerald-400 bg-emerald-500/20 text-white animate-pulse' : 'border-white/10 text-slate-200 hover:border-white/30 hover:text-white'"
            @click="
              () => {
                closeMenu()
                triggerSync('manual-button')
              }
            "
          >
            <span>Sync now</span>
            <span aria-hidden="true">⟳</span>
          </button>
          <button
            v-if="installAvailable"
            type="button"
            class="flex w-full items-center justify-between border px-3 py-2 text-sm font-semibold transition sm:px-4 sm:py-3"
            :class="'border-emerald-300/40 bg-emerald-500/20 text-white'"
            @click="
              () => {
                closeMenu()
                promptInstall()
              }
            "
          >
            <span>Install app</span>
            <span aria-hidden="true">⬇</span>
          </button>
        </nav>
      </aside>
    </transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.25s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
</style>
