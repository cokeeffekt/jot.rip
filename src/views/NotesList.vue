<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { deleteNote, listActiveNotes, listAllTabs, listArchivedNotes, listImages, updateNote } from '../db'
import { parseText } from '../editor/parse'
import { triggerSync } from '../sync/poller'

const router = useRouter()
const notes = ref([] as Awaited<ReturnType<typeof listActiveNotes>>)
const archivedNotes = ref([] as Awaited<ReturnType<typeof listArchivedNotes>>)
const loading = ref(false)
const filterQuery = ref('')
const lineCounts = ref<Record<string, number>>({})
const tabCounts = ref<Record<string, number>>({})
const byteSizes = ref<Record<string, number>>({})
const checklistStats = ref<Record<string, { total: number; checked: number }>>({})
const firstTabTags = ref<Record<string, { tag: string; lineIndex: number; priority?: boolean }[]>>({})
const activeMenuNoteId = ref<string | null>(null)

const countLines = (text: string) => text.replace(/\r\n/g, '\n').split('\n').length
const textBytes = (text: string) => new TextEncoder().encode(text).byteLength
const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

const sortNotes = <T extends { pinnedAt?: string | null; updatedAt: string }>(list: T[]) => {
  return [...list].sort((a, b) => {
    const ap = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0
    const bp = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0
    if (ap !== bp) return bp - ap
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}

const refresh = async () => {
  loading.value = true
  const [active, archived, tabs, images] = await Promise.all([
    listActiveNotes(),
    listArchivedNotes(),
    listAllTabs(),
    listImages(),
  ])
  notes.value = sortNotes(active)
  archivedNotes.value = archived
  computeCounts(tabs, images)
  loading.value = false
  console.debug('[notes] refresh', {
    active: notes.value.map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt })),
    archived: archivedNotes.value.map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt })),
  })
}

const openNote = (id: string) => {
  router.push({ name: 'note-editor', params: { id } })
}

const computeCounts = (
  tabs: Awaited<ReturnType<typeof listAllTabs>>,
  images: Awaited<ReturnType<typeof listImages>>
) => {
  const nextLineCounts: Record<string, number> = {}
  const nextTabCounts: Record<string, number> = {}
  const nextByteSizes: Record<string, number> = {}
  const nextChecklist: Record<string, { total: number; checked: number }> = {}
  const nextTags: Record<string, { tag: string; lineIndex: number }[]> = {}
  for (const tab of tabs) {
    nextTabCounts[tab.noteId] = (nextTabCounts[tab.noteId] ?? 0) + 1
    nextLineCounts[tab.noteId] = (nextLineCounts[tab.noteId] ?? 0) + countLines(tab.content)
    nextByteSizes[tab.noteId] = (nextByteSizes[tab.noteId] ?? 0) + textBytes(tab.content)
    const parsed = parseText(tab.content)
    if (parsed.checklists.length) {
      const stat = nextChecklist[tab.noteId] ?? { total: 0, checked: 0 }
      stat.total += parsed.checklists.length
      stat.checked += parsed.checklists.filter((c) => c.checked).length
      nextChecklist[tab.noteId] = stat
    }
  }
  // Build tag jump list from the first tab in tabOrder (fallback to first seen tab)
  const firstTabIdByNoteId = new Map<string, string>()
  for (const note of [...notes.value, ...archivedNotes.value]) {
    const first = note.tabOrder?.[0]
    if (first) firstTabIdByNoteId.set(note.id, first)
  }
  for (const tab of tabs) {
    const chosen = firstTabIdByNoteId.get(tab.noteId)
    if (!chosen) {
      firstTabIdByNoteId.set(tab.noteId, tab.id)
    }
  }
  for (const tab of tabs) {
    if (firstTabIdByNoteId.get(tab.noteId) !== tab.id) continue
    const tags = parseText(tab.content).tags.map((t) => ({
      tag: t.tag,
      lineIndex: t.lineIndex,
      priority: t.priority ?? false,
    }))
    nextTags[tab.noteId] = tags.sort((a, b) => Number(b.priority) - Number(a.priority))
  }
  for (const image of images) {
    const current = nextByteSizes[image.noteId] ?? 0
    nextByteSizes[image.noteId] = current + (image.blob?.size ?? 0)
    if (image.thumbnailDataUrl) {
      nextByteSizes[image.noteId] = (nextByteSizes[image.noteId] ?? 0) + textBytes(image.thumbnailDataUrl)
    }
  }
  for (const note of [...notes.value, ...archivedNotes.value]) {
    nextByteSizes[note.id] = (nextByteSizes[note.id] ?? 0) + textBytes(note.title ?? '')
  }
  lineCounts.value = nextLineCounts
  tabCounts.value = nextTabCounts
  byteSizes.value = nextByteSizes
  checklistStats.value = nextChecklist
  firstTabTags.value = nextTags
}

const archiveNoteById = async (id: string) => {
  await updateNote(id, { archivedAt: new Date().toISOString() })
  await refresh()
}

const togglePinById = async (id: string, pinned: boolean) => {
  await updateNote(id, { pinnedAt: pinned ? null : new Date().toISOString() })
  await refresh()
}

const openTag = (noteId: string, tabId: string | undefined, lineIndex: number) => {
  router.push({
    name: 'note-editor',
    params: { id: noteId },
    query: { ...(tabId ? { tab: tabId } : {}), line: lineIndex.toString() },
  })
}

const unarchiveNoteById = async (id: string) => {
  await updateNote(id, { archivedAt: null })
  await refresh()
}

const permanentlyDeleteNoteById = async (id: string) => {
  const ok = window.confirm('Permanently delete this note? This cannot be undone.')
  if (!ok) return
  await deleteNote(id)
  await refresh()
}

const openMenu = (noteId: string) => {
  activeMenuNoteId.value = noteId
}

const closeMenu = () => {
  activeMenuNoteId.value = null
}

const handleSyncComplete = () => {
  console.debug('[notes] sync complete → refresh')
  refresh()
}

const handleGlobalClick = (evt: Event) => {
  if (!activeMenuNoteId.value) return
  const target = evt.target as HTMLElement | null
  if (!target) return
  const inMenu = target.closest('.note-action-menu')
  const inButton = target.closest('.note-more-btn')
  if (!inMenu && !inButton) {
    closeMenu()
  }
}

onMounted(() => {
  refresh()
  window.addEventListener('jotrip:sync-complete', handleSyncComplete)
  window.addEventListener('pointerdown', handleGlobalClick, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('jotrip:sync-complete', handleSyncComplete)
  window.removeEventListener('pointerdown', handleGlobalClick, true)
})
onMounted(() => triggerSync('notes-list'))

const matchesFilter = (noteId: string, title: string) => {
  const q = filterQuery.value.trim().toLowerCase()
  if (!q) return true
  const inTitle = (title || '').toLowerCase().includes(q)
  const tags = firstTabTags.value[noteId] ?? []
  const inTags = tags.some((t) => (t.tag || '').toLowerCase().includes(q))
  return inTitle || inTags
}

const filteredNotes = computed(() => notes.value.filter((n) => matchesFilter(n.id, n.title || '')))
const filteredArchived = computed(() => archivedNotes.value.filter((n) => matchesFilter(n.id, n.title || '')))
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
    <div class="px-2 sm:px-0">
      <input
        v-model="filterQuery"
        type="search"
        class="w-full border border-white/15 bg-black/30 px-3 py-2 text-sm text-white"
        placeholder="Filter by title or #tag"
      />
    </div>
    <div class="min-h-0 flex-1 overflow-auto overflow-x-hidden px-2 sm:px-0">
      <div v-for="note in filteredNotes" :key="note.id" class="mb-2">
        <div
          class="note-card relative border border-white/10 bg-slate-900/40"
          :class="note.color ? 'has-note-color' : ''"
          :style="note.color ? { '--note-color': note.color } : undefined"
        >
          <button
            type="button"
            class="flex w-full flex-col gap-1 px-3 py-2 text-left sm:px-4 sm:py-3"
            @click="
              () => {
                if (activeMenuNoteId) {
                  closeMenu()
                  return
                }
                openNote(note.id)
              }
            "
          >
            <div class="flex items-center gap-2">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold text-white">{{ note.title || 'Untitled' }}</p>
                <p class="truncate text-xs text-slate-400">
                  Updated {{ new Date(note.updatedAt).toLocaleString() }} · {{ tabCounts[note.id] ?? 0 }} tabs ·
                  {{ lineCounts[note.id] ?? 0 }} lines · {{ formatBytes(byteSizes[note.id] ?? 0) }}
                </p>
              </div>
              <span v-if="note.pinnedAt" aria-hidden="true" class="text-sm">📌</span>
              <button
                type="button"
                class="shrink-0 rounded border border-white/15 px-2 py-1 text-xs text-white note-more-btn"
                @click.stop="activeMenuNoteId === note.id ? closeMenu() : openMenu(note.id)"
                aria-label="More actions"
              >
                ⋯
              </button>
            </div>
            <div
              v-if="firstTabTags[note.id]?.length"
              class="no-scrollbar -mx-1 mt-1 flex overflow-x-auto overflow-y-hidden px-1"
            >
              <button
                v-for="t in firstTabTags[note.id]"
                :key="t.tag + ':' + t.lineIndex"
                type="button"
                class="mr-1 inline-flex shrink-0 px-2 py-1 text-[11px] last:mr-0"
                @click.stop="openTag(note.id, note.tabOrder?.[0], t.lineIndex)"
                :style="{
                  border: t.priority
                    ? `1px solid ${note.color || 'rgba(246,153,63,0.5)'}`
                    : '1px solid transparent',
                  backgroundColor: t.priority
                    ? note.color
                      ? `${note.color}20`
                      : 'rgba(246,153,63,0.12)'
                    : note.color
                    ? `${note.color}20`
                    : 'rgba(52,211,153,0.1)',
                  color: note.color ? '#fff' : t.priority ? 'rgb(249,115,22)' : 'rgb(52,211,153)',
                }"
              >
                <span class="truncate" :class="t.priority ? 'font-bold' : ''">
                  #{{ t.tag.length > 20 ? t.tag.slice(0, 20) + '…' : t.tag }}
                </span>
              </button>
            </div>
            <div
              v-if="checklistStats[note.id]?.total"
              class="mt-2 h-1 w-full overflow-hidden bg-transparent"
              aria-label="Checklist progress"
            >
              <div
                class="h-full"
                :style="{
                  width: `${Math.round(
                    ((checklistStats[note.id]?.checked || 0) / Math.max(1, checklistStats[note.id]?.total || 1)) * 100
                  )}%`,
                  background: note.color
                    ? `linear-gradient(to right, ${note.color}, ${note.color}CC)`
                    : 'linear-gradient(to right, rgba(52,211,153,0.9), rgba(52,211,153,0.6))',
                  borderBottom: note.color ? `1px solid ${note.color}` : '1px solid rgba(52,211,153,0.8)',
                }"
              ></div>
            </div>
          </button>

          <div
            v-if="activeMenuNoteId === note.id"
            class="note-action-menu absolute right-2 top-2 z-20 w-28 border border-white/15 bg-slate-900 text-sm text-white shadow-xl"
            @click.self="closeMenu"
          >
            <button
              type="button"
              class="flex w-full items-center justify-between px-3 py-2 hover:bg-white/10"
              @click.stop="togglePinById(note.id, !!note.pinnedAt); closeMenu()"
            >
              <span>Pin</span>
              <span :class="note.pinnedAt ? 'text-white' : 'text-white/40 grayscale'">📌</span>
            </button>
            <button
              type="button"
              class="flex w-full items-center justify-between px-3 py-2 hover:bg-white/10"
              @click.stop="archiveNoteById(note.id); closeMenu()"
            >
              <span>Archive</span>
              <span>⌫</span>
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="!notes.length && !loading"
        class="border border-dashed border-white/10 bg-white/5 p-4 text-sm text-slate-300"
      >
        No notes yet. Create one to start editing.
      </div>

      <div v-if="archivedNotes.length" class="mt-6 border-t border-white/10 pt-4">
        <p class="px-2 text-xs uppercase tracking-[0.2em] text-slate-500 sm:px-0">Archived</p>
        <div
          v-for="note in filteredArchived"
          :key="note.id"
          class="note-card mt-2 border border-white/10 bg-slate-900/20 text-slate-400"
          :class="note.color ? 'has-note-color' : ''"
          :style="note.color ? { '--note-color': note.color } : undefined"
        >
          <div class="flex items-center justify-between gap-3 px-3 py-2 sm:px-4 sm:py-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-slate-300">{{ note.title || 'Untitled' }}</p>
              <p class="truncate text-xs text-slate-500">
                Updated {{ new Date(note.updatedAt).toLocaleString() }} · {{ tabCounts[note.id] ?? 0 }} tabs ·
                {{ lineCounts[note.id] ?? 0 }} lines · {{ formatBytes(byteSizes[note.id] ?? 0) }}
              </p>
              <div
                v-if="checklistStats[note.id]?.total"
                class="mt-2 h-1 w-full overflow-hidden bg-white/10"
                aria-label="Checklist progress"
              >
                <div
                  class="h-full bg-emerald-300/30"
                  :style="{
                    width: `${Math.round(
                      ((checklistStats[note.id]?.checked || 0) /
                        Math.max(1, checklistStats[note.id]?.total || 1)) *
                        100
                    )}%`,
                  }"
                ></div>
              </div>
            </div>
            <div class="flex shrink-0 border border-white/10">
              <button type="button" class="px-4 py-3 text-sm" @click="unarchiveNoteById(note.id)">↩</button>
              <button
                type="button"
                class="border-l border-white/10 px-4 py-3 text-sm text-red-200"
                @click="permanentlyDeleteNoteById(note.id)"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
