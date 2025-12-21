<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { listNotes, listAllTabs, listImages, listMeta, clearAllData, setMeta, getMeta } from '../db'
import { syncNow } from '../sync/client'

const storageKey = 'jotrip:theme'
const isLight = ref(false)
const exporting = ref(false)
const clearing = ref(false)
const clearingRemote = ref(false)
const syncCombined = ref('')
const syncPassphrase = ref('')
const syncUrl = ref('')
const syncUsername = ref('')
const syncPassword = ref('')
const syncEnabled = ref(false)
const lastSync = ref<string | null>(null)
const showCombined = ref(false)
const hiddenUserRef = ref<HTMLInputElement | null>(null)
const hiddenPassRef = ref<HTMLInputElement | null>(null)

const applyTheme = (light: boolean) => {
  document.documentElement.classList.toggle('theme-light', light)
  window.localStorage.setItem(storageKey, light ? 'light' : 'dark')
}

onMounted(() => {
  const stored = window.localStorage.getItem(storageKey)
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)')?.matches ?? false
  isLight.value = stored ? stored === 'light' : prefersLight
  applyTheme(isLight.value)

  // Load sync settings from meta/localStorage
  getMeta<string>('sync:passphrase').then((v) => (syncPassphrase.value = v ?? ''))
  getMeta<string>('sync:url').then((v) => {
    if (v) {
      syncUrl.value = v
    } else {
      const loc = window.location
      const origin = loc.origin || `${loc.protocol}//${loc.host}`
      syncUrl.value = origin
    }
  })
  getMeta<string>('sync:username').then((v) => (syncUsername.value = v ?? ''))
  getMeta<string>('sync:password').then((v) => (syncPassword.value = v ?? ''))
  getMeta<boolean>('sync:enabled').then((v) => (syncEnabled.value = Boolean(v)))
  getMeta<string>('sync:last').then((v) => (lastSync.value = v ?? null))
  buildCombined()
})

watch(isLight, (val) => applyTheme(val))
watch(
  () => [syncUsername.value, syncPassword.value, syncPassphrase.value],
  () => {
    buildCombined()
  }
)

const saveSyncSettings = async () => {
  parseCombined(syncCombined.value)
  await Promise.all([
    setMeta('sync:passphrase', syncPassphrase.value.trim()),
    setMeta('sync:url', syncUrl.value.trim()),
    setMeta('sync:username', syncUsername.value.trim()),
    setMeta('sync:password', syncPassword.value.trim()),
    setMeta('sync:enabled', syncEnabled.value),
  ])
  hintPasswordManager()
}

const handleSyncNow = async () => {
  parseCombined(syncCombined.value)
  await saveSyncSettings()
  if (!syncEnabled.value) {
    window.alert('Enable sync first.')
    return
  }
  try {
    const ts = await syncNow({
      baseUrl: syncUrl.value.trim(),
      username: syncUsername.value.trim(),
      password: syncPassword.value.trim(),
      passphrase: syncPassphrase.value.trim(),
    })
    lastSync.value = ts
    window.alert('Sync complete.')
  } catch (err) {
    console.error(err)
    window.alert('Sync failed. Check console for details.')
  }
}

const randomWords = (count: number) => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  const words: string[] = []
  for (let i = 0; i < count; i++) {
    let w = ''
    for (let j = 0; j < 6; j++) {
      const idx = Math.floor(Math.random() * alphabet.length)
      w += alphabet[idx]
    }
    words.push(w)
  }
  return words.join('-')
}

const buildCombined = () => {
  if (!syncUsername.value && !syncPassword.value && !syncPassphrase.value) {
    syncCombined.value = ''
    return
  }
  syncCombined.value = `${syncUsername.value}/${syncPassword.value}/${syncPassphrase.value}`
  hintPasswordManager()
}

const parseCombined = (value: string) => {
  const parts = value.split('/')
  syncUsername.value = parts[0] ?? ''
  syncPassword.value = parts[1] ?? ''
  syncPassphrase.value = parts.slice(2).join('/') || ''
}

const generateCombined = () => {
  const user =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? (crypto.randomUUID().split('-')[0] as string)
      : (Math.random().toString(36).slice(2, 8) as string)
  const pass = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => (b % 10).toString(10))
    .join('')
  const phrase = randomWords(4)
  syncUsername.value = user
  syncPassword.value = pass
  syncPassphrase.value = phrase
  buildCombined()
  hintPasswordManager()
}

const hintPasswordManager = () => {
  const u = hiddenUserRef.value
  const p = hiddenPassRef.value
  if (u) {
    u.value = 'jotrip-sync'
  }
  if (p) {
    p.value = syncCombined.value
    p.focus()
    p.blur()
  }
}

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

const download = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const exportAll = async () => {
  exporting.value = true
  try {
    const [notes, tabs, images, meta] = await Promise.all([listNotes(), listAllTabs(), listImages(), listMeta()])
    const imagesData = await Promise.all(
      images.map(async (img) => ({
        ...img,
        base64: await blobToBase64(img.blob),
      }))
    )
    const payload = {
      version: 'backup-1',
      type: 'jotrip-backup',
      exportedAt: new Date().toISOString(),
      notes,
      tabs,
      images: imagesData,
      meta,
    }
    download(`jotrip-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload))
  } finally {
    exporting.value = false
  }
}

const confirmClear = async () => {
  const first = window.confirm('This will delete all local data (jots, tabs, images). Continue?')
  if (!first) return
  const second = window.prompt('Type CLEAR to confirm wiping all data')
  if (second !== 'CLEAR') return
  clearing.value = true
  try {
    await clearAllData()
  } finally {
    clearing.value = false
  }
}

const clearRemoteAndLocal = async () => {
  parseCombined(syncCombined.value)
  const base = syncUrl.value.trim().replace(/\/+$/, '')
  if (!base || !syncUsername.value || !syncPassword.value) {
    window.alert('Set server URL and user/password/passphrase bundle first.')
    return
  }
  const first = window.confirm('This will delete ALL remote data for this account and then clear local data. Continue?')
  if (!first) return
  const second = window.prompt('Type WIPE to confirm remote + local delete')
  if (second !== 'WIPE') return
  clearingRemote.value = true
  try {
    const res = await fetch(`${base}/wipe`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${syncUsername.value}:${syncPassword.value}`)}` },
    })
    if (!res.ok) {
      throw new Error(`Remote wipe failed ${res.status}`)
    }
    await clearAllData()
    await setMeta('sync:last', null)
    window.alert('Remote and local data cleared.')
  } catch (err) {
    console.error(err)
    window.alert('Failed to clear remote data. Check console for details.')
  } finally {
    clearingRemote.value = false
  }
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
    <header class="shrink-0 px-2 sm:px-0">
      <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Settings</p>
      <h1 class="text-2xl font-semibold text-white">Settings</h1>
    </header>

    <div class="min-h-0 flex-1 overflow-auto px-2 sm:px-0">
      <div class="space-y-3 border border-white/10 bg-slate-900/40 p-3 sm:p-4">
        <div class="flex items-center justify-between border border-white/5 bg-white/5 px-4 py-3">
          <div>
            <p class="font-medium text-white">Theme</p>
            <p class="text-sm text-slate-300">Toggle light mode (MVP).</p>
          </div>
          <label class="inline-flex items-center gap-2 text-sm text-slate-200">
            <span class="text-xs text-slate-400">Dark</span>
            <input v-model="isLight" type="checkbox" class="h-5 w-10 rounded-none border-white/20 bg-transparent" />
            <span class="text-xs text-slate-400">Light</span>
          </label>
        </div>

        <div class="space-y-3 border border-white/5 bg-white/5 px-4 py-3">
          <div>
            <p class="font-medium text-white">Data backup</p>
            <p class="text-sm text-slate-300">Export all jots, tabs, images, and settings into one file.</p>
          </div>
          <button
            type="button"
            class="w-full border border-indigo-300/30 bg-indigo-500/20 px-3 py-2 text-sm text-white"
            :disabled="exporting"
            @click="exportAll"
          >
            {{ exporting ? 'Exporting…' : 'Export all data' }}
          </button>
        </div>

        <div class="space-y-3 border border-white/5 bg-white/5 px-4 py-3">
          <div>
            <p class="font-medium text-white">Danger zone</p>
            <p class="text-sm text-slate-300">Wipe all local data (cannot be undone).</p>
          </div>
          <button
            type="button"
            class="w-full border border-red-300/30 bg-red-500/20 px-3 py-2 text-sm text-white"
            :disabled="clearing"
            @click="confirmClear"
          >
            {{ clearing ? 'Clearing…' : 'Clear all data' }}
          </button>
          <button
            type="button"
            class="w-full border border-red-300/30 bg-red-700/30 px-3 py-2 text-sm text-white"
            :disabled="clearingRemote"
            @click="clearRemoteAndLocal"
          >
            {{ clearingRemote ? 'Wiping remote…' : 'Clear remote + local data' }}
          </button>
        </div>

        <div class="space-y-3 border border-white/5 bg-white/5 px-4 py-3">
          <div>
            <p class="font-medium text-white">Sync</p>
            <p class="text-sm text-slate-300">
              Enter or generate a single user/passphrase bundle. Saved separately, but you only need to remember one field.
            </p>
          </div>
          <label class="block space-y-1 text-sm text-slate-200">
            <span class="text-xs uppercase tracking-[0.2em] text-slate-400">User / Password / Passphrase</span>
            <div class="flex gap-2">
              <input
                v-model="syncCombined"
                name="password"
                :type="showCombined ? 'text' : 'password'"
                class="w-full border border-white/15 bg-black/20 px-3 py-2 text-white"
                placeholder="user/password/passphrase"
                autocomplete="new-password"
                @input="parseCombined(syncCombined)"
                @change="parseCombined(syncCombined)"
                @blur="parseCombined(syncCombined)"
              />
              <button
                type="button"
                class="border border-white/15 bg-white/10 px-3 py-2 text-xs text-white"
                @click="showCombined = !showCombined"
              >
                {{ showCombined ? 'Hide' : 'Show' }}
              </button>
            </div>
          <div class="mt-2 flex gap-2">
            <button
              type="button"
              class="flex-1 border border-white/15 bg-white/10 px-3 py-1 text-xs text-white"
              @click="generateCombined"
            >
              Generate bundle
            </button>
            <button
              type="button"
              class="flex-1 border border-white/15 bg-white/10 px-3 py-1 text-xs text-white"
              @click="syncCombined = ''; parseCombined('')"
            >
              Clear
            </button>
          </div>
          <p class="text-xs text-slate-400">We recommend saving this in your browser password manager when prompted.</p>
        </label>
        <!-- Hidden auth form to encourage password managers to offer save -->
        <form class="absolute h-px w-px overflow-hidden" aria-hidden="true">
          <input ref="hiddenUserRef" name="username" autocomplete="username" />
          <input ref="hiddenPassRef" name="password" type="password" autocomplete="new-password" />
        </form>
          <label class="block space-y-1 text-sm text-slate-200">
            <span class="text-xs uppercase tracking-[0.2em] text-slate-400">Server URL</span>
            <input
              v-model="syncUrl"
              type="text"
              class="w-full border border-white/15 bg-black/20 px-3 py-2 text-white"
              placeholder="https://your-server"
            />
          </label>
          <div class="flex items-center justify-between text-sm text-white">
            <label class="inline-flex items-center gap-2">
              <input v-model="syncEnabled" type="checkbox" class="h-4 w-4 border-white/20 bg-black/30" />
              <span>Enable sync (polling not yet implemented)</span>
            </label>
            <span class="text-xs text-slate-400">Last sync: {{ lastSync || 'Never' }}</span>
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              class="flex-1 border border-white/15 bg-white/10 px-3 py-2 text-sm text-white"
              @click="saveSyncSettings"
            >
              Save settings
            </button>
            <button
              type="button"
              class="flex-1 border border-indigo-300/30 bg-indigo-500/20 px-3 py-2 text-sm text-white"
              @click="handleSyncNow"
            >
              Sync now
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
