<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { createNote, createTab, storeImage, updateNote, getDb, type Note, type Tab, type Image, type Meta } from '../db'
import { makeId } from '../db/repository'

type ExportData = {
  version: string
  note: { title: string; color?: string | null }
  tabs: { id: string; name: string; content: string }[]
  tabOrder: string[]
  images?: {
    id: string
    tabId: string
    mime: string
    base64: string
    width?: number
    height?: number
    thumbnailDataUrl?: string
  }[]
}

type BackupImage = {
  id: string
  noteId: string
  tabId: string
  mime: string
  base64: string
  width?: number
  height?: number
  createdAt: string
  thumbnailDataUrl?: string
}

type BackupData = {
  version: string
  type: 'jotrip-backup'
  exportedAt?: string
  notes: Note[]
  tabs: Tab[]
  images: BackupImage[]
  meta?: Meta[]
}

const router = useRouter()
const error = ref<string | null>(null)
const parsed = ref<ExportData | null>(null)
const parsedBackup = ref<BackupData | null>(null)
const importing = ref(false)

const reset = () => {
  error.value = null
  parsed.value = null
  parsedBackup.value = null
}

const readFile = async (file?: File | null) => {
  reset()
  if (!file) return
  const text = await file.text()
  // Try JSON backup first
  try {
    const asJson = JSON.parse(text) as BackupData
    if (asJson && asJson.type === 'jotrip-backup' && Array.isArray(asJson.notes) && Array.isArray(asJson.tabs)) {
      parsedBackup.value = asJson
      return
    }
  } catch (_) {
    // fall through to HTML
  }
  const marker = text.match(/<script[^>]+id=["']jotrip-export["'][^>]*>([\s\S]*?)<\/script>/)
  if (marker?.[1]) {
    try {
      const data = JSON.parse(marker[1]) as ExportData
      parsed.value = data
      return
    } catch (_) {
      // ignore
    }
  }
  error.value = 'Could not find supported export data.'
}

const b64ToBlob = (b64: string, mime: string) => {
  const byteString = atob(b64)
  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i)
  }
  return new Blob([ab], { type: mime })
}

const importNote = async () => {
  if (!parsed.value) return
  importing.value = true
  try {
    const note = await createNote({ title: parsed.value.note.title || 'Imported note', tabOrder: [] })
    const tabIdMap = new Map<string, string>()
    const imageIdMap = new Map<string, string>()
    if (parsed.value.images?.length) {
      for (const img of parsed.value.images) {
        imageIdMap.set(img.id, makeId())
      }
    }
    // tabs
    for (const tab of parsed.value.tabs) {
      const content = tab.content.replace(/!\[image:([^\]]+)\]/g, (m, id: string) => {
        const mapped = imageIdMap.get(id)
        return mapped ? `![image:${mapped}]` : m
      })
      const newTab = await createTab({ noteId: note.id, name: tab.name, content })
      tabIdMap.set(tab.id, newTab.id)
    }
    const tabOrder = parsed.value.tabOrder
      .map((id) => tabIdMap.get(id))
      .filter((id): id is string => Boolean(id))
    await updateNote(note.id, { color: parsed.value.note.color ?? null, tabOrder })

    // images
    if (parsed.value.images?.length) {
      for (const img of parsed.value.images) {
        const newTabId = tabIdMap.get(img.tabId)
        if (!newTabId) continue
        const blob = b64ToBlob(img.base64, img.mime)
        await storeImage({
          id: imageIdMap.get(img.id) ?? img.id,
          noteId: note.id,
          tabId: newTabId,
          mime: img.mime,
          blob,
          width: img.width,
          height: img.height,
          thumbnailDataUrl: img.thumbnailDataUrl,
        })
      }
    }

    router.push({ name: 'note-editor', params: { id: note.id } })
  } catch (e) {
    error.value = 'Import failed.'
  } finally {
    importing.value = false
  }
}

const importBackup = async () => {
  const backup = parsedBackup.value
  if (!backup) return
  const confirmReplace = window.confirm('Importing a backup will replace ALL local data. Continue?')
  if (!confirmReplace) return
  const confirmReplace2 = window.prompt('Type RESTORE to proceed with replacing all data')
  if (confirmReplace2 !== 'RESTORE') return
  importing.value = true
  try {
    const db = getDb()
    const plainNotes = (backup.notes ?? []).map((n: any) => JSON.parse(JSON.stringify(n)) as Note)
    const plainTabs = (backup.tabs ?? []).map((t: any) => JSON.parse(JSON.stringify(t)) as Tab)
    const plainMeta = (backup.meta ?? []).map((m: any) => ({ key: m.key, value: m.value })) as Meta[]
    const images = await Promise.all(
      (backup.images ?? []).map(async (img) => ({
        id: img.id,
        noteId: img.noteId,
        tabId: img.tabId,
        mime: img.mime,
        blob: b64ToBlob(img.base64, img.mime),
        width: img.width,
        height: img.height,
        createdAt: img.createdAt,
        thumbnailDataUrl: img.thumbnailDataUrl,
      }))
    )
    await db.transaction('rw', [db.notes, db.tabs, db.images, db.meta], async () => {
      await Promise.all([db.notes.clear(), db.tabs.clear(), db.images.clear(), db.meta.clear()])
      if (plainNotes.length) await db.notes.bulkPut(plainNotes as Note[])
      if (plainTabs.length) await db.tabs.bulkPut(plainTabs as Tab[])
      if (images.length) await db.images.bulkPut(images as unknown as Image[])
      if (plainMeta.length) await db.meta.bulkPut(plainMeta as Meta[])
    })
    router.push({ name: 'home' })
  } catch (e) {
    console.error(e)
    error.value = 'Import failed. See console for details.'
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
    <header class="shrink-0 px-2 sm:px-0">
      <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Import</p>
      <h1 class="text-2xl font-semibold text-white">Import exported note</h1>
    </header>

    <div class="min-h-0 flex-1 overflow-auto px-2 sm:px-0">
      <div class="space-y-3 border border-white/10 bg-slate-900/40 p-3 sm:p-4">
        <div class="space-y-2">
          <p class="text-sm text-slate-300">Choose an export file (.html single jot or .json full backup).</p>
          <input
            type="file"
            accept=".html,text/html,application/json,.json"
            @change="readFile(($event.target as HTMLInputElement).files?.[0])"
          />
        </div>
        <div v-if="error" class="text-sm text-red-300">{{ error }}</div>

        <div v-if="parsedBackup" class="space-y-2 border border-yellow-300/30 bg-yellow-500/10 p-3 text-sm text-white">
          <p class="font-semibold">Backup detected</p>
          <p>Jots: {{ parsedBackup.notes.length }}</p>
          <p>Tabs: {{ parsedBackup.tabs.length }}</p>
          <p>Images: {{ parsedBackup.images?.length ?? 0 }}</p>
          <button
            type="button"
            class="border border-emerald-300/40 bg-emerald-500/20 px-3 py-2 text-sm text-white"
            :disabled="importing"
            @click="importBackup"
          >
            {{ importing ? 'Importing…' : 'Import backup (replaces all data)' }}
          </button>
        </div>

        <div v-else-if="parsed" class="space-y-2 text-sm text-slate-200">
          <p class="font-semibold">Found: {{ parsed.note.title || 'Untitled' }}</p>
          <p>Tabs: {{ parsed.tabs.length }}</p>
          <p>Images: {{ parsed.images?.length ?? 0 }}</p>
          <button
            type="button"
            class="border border-emerald-300/40 bg-emerald-500/20 px-3 py-2 text-sm text-white"
            :disabled="importing"
            @click="importNote"
          >
            {{ importing ? 'Importing…' : 'Import jot' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
