<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { buildCalendarEntriesForRange } from '../calendar/entryCache'
import type { CalendarEntry } from '../calendar/types'
import { listActiveNotes, listAllTabs } from '../db'
import { parseText } from '../editor/parse'

const router = useRouter()

const loading = ref(true)
const todayEntries = ref<CalendarEntry[]>([])
const pinnedNotes = ref<{ id: string; title: string; updatedAt: string; color?: string | null }[]>([])
const tags = ref<
  {
    tag: string
    priority?: boolean
    noteId: string
    tabId?: string
    updatedAt: string
    color?: string | null
    lineIndex?: number
  }[]
>([])

const pad = (n: number) => n.toString().padStart(2, '0')
const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const entryLabel = (entry: CalendarEntry) => {
  const text = (entry.textAfterToken || '').trim()
  if (text.length) return text
  return entry.firstTabName || entry.noteTitle
}

const openEntry = (entry: CalendarEntry) => {
  const snippet = (entry.textAfterToken || '').slice(0, 10)
  router.push({
    name: 'note-editor',
    params: { id: entry.noteId },
    query: { date: entry.tokenDate, tab: entry.tabId, ...(snippet ? { snippet } : {}) },
  })
}

const openNote = (noteId: string, tabId?: string, lineIndex?: number) =>
  router.push({
    name: 'note-editor',
    params: { id: noteId },
    query: tabId ? { tab: tabId, ...(lineIndex != null ? { line: lineIndex } : {}) } : {},
  })

const load = async () => {
  loading.value = true
  const [notes, tabs] = await Promise.all([listActiveNotes(), listAllTabs()])
  const today = todayKey()
  todayEntries.value = buildCalendarEntriesForRange(notes, tabs, { start: today, end: today })

  pinnedNotes.value = notes
    .filter((n) => Boolean(n.pinnedAt))
    .sort((a, b) => {
      const ap = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0
      const bp = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0
      return bp - ap
    })
    .map((n) => ({ id: n.id, title: n.title || 'Untitled', updatedAt: n.updatedAt, color: n.color ?? null }))

  const firstTabByNote = new Map<string, string>()
  notes.forEach((n) => {
    const first = n.tabOrder?.[0]
    if (first) firstTabByNote.set(n.id, first)
  })
  tabs.forEach((t) => {
    if (!firstTabByNote.has(t.noteId)) firstTabByNote.set(t.noteId, t.id)
  })
  const tagList: {
    tag: string
    priority?: boolean
    noteId: string
    tabId?: string
    updatedAt: string
    color?: string | null
    lineIndex?: number
  }[] = []
  for (const tab of tabs) {
    if (firstTabByNote.get(tab.noteId) !== tab.id) continue
    const parsed = parseText(tab.content)
    parsed.tags.forEach((t) => {
      tagList.push({
        tag: t.tag,
        priority: t.priority,
        noteId: tab.noteId,
        tabId: tab.id,
        updatedAt: notes.find((n) => n.id === tab.noteId)?.updatedAt || tab.updatedAt,
        color: notes.find((n) => n.id === tab.noteId)?.color ?? null,
        lineIndex: t.lineIndex,
      })
    })
  }
  tags.value = tagList.sort((a, b) => {
    if ((a.priority ? 1 : 0) !== (b.priority ? 1 : 0)) return (b.priority ? 1 : 0) - (a.priority ? 1 : 0)
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  loading.value = false
}

onMounted(load)
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
    <div class="min-h-0 flex-1 overflow-auto px-2 sm:px-0">
      <div class="border border-white/10 bg-white/5 p-3 sm:p-4">
        <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Today</p>
        <div v-if="loading" class="mt-3 text-sm text-slate-300">Loading…</div>
        <div v-else class="mt-3 space-y-2">
          <button
            v-for="entry in todayEntries"
            :key="entry.noteId + entry.tabId + entry.occurrenceIndex + entry.date"
            type="button"
            class="w-full border border-white/10 bg-slate-900/40 p-3 text-left text-sm text-white hover:border-white/20"
            @click="openEntry(entry)"
          >
            <div class="flex items-center gap-2">
              <span
                class="h-3 w-1 shrink-0"
                :style="
                  entry.noteColor ? { backgroundColor: entry.noteColor } : { backgroundColor: 'rgba(255,255,255,0.25)' }
                "
              ></span>
              <span class="min-w-0 truncate font-semibold">{{ entry.noteTitle }}</span>
            </div>
            <p class="mt-1 truncate text-xs text-slate-300">{{ entryLabel(entry) }}</p>
          </button>
          <div v-if="!todayEntries.length" class="border border-white/10 bg-slate-900/20 p-3 text-sm text-slate-300">
            No events today.
          </div>
        </div>
      </div>

      <div class="mt-3 border border-white/10 bg-white/5 p-3 sm:mt-4 sm:p-4">
        <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Pinned</p>
        <div v-if="loading" class="mt-3 text-sm text-slate-300">Loading…</div>
        <div v-else class="mt-3 space-y-2">
          <button
            v-for="note in pinnedNotes"
            :key="note.id"
            type="button"
            class="w-full border border-white/10 bg-slate-900/40 p-3 text-left text-sm text-white hover:border-white/20"
            :style="note.color ? { borderLeft: `6px solid ${note.color}` } : undefined"
            @click="openNote(note.id)"
          >
            <p class="truncate font-semibold">{{ note.title }}</p>
            <p class="mt-1 text-xs text-slate-400">Updated {{ new Date(note.updatedAt).toLocaleString() }}</p>
          </button>
          <div v-if="!pinnedNotes.length" class="border border-white/10 bg-slate-900/20 p-3 text-sm text-slate-300">
            No pinned jots.
          </div>
        </div>
      </div>

      <div class="mt-3 border border-white/10 bg-white/5 p-3 sm:mt-4 sm:p-4">
        <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Tags</p>
        <div v-if="loading" class="mt-3 text-sm text-slate-300">Loading…</div>
        <div v-else class="mt-3">
          <div class="flex flex-wrap gap-2">
            <button
              v-for="tag in tags"
              :key="tag.tag + tag.noteId"
              type="button"
              class="inline-flex items-center gap-2 rounded px-3 py-2 text-sm text-white"
              :style="{
                border: tag.priority ? `1px solid ${tag.color || 'rgba(246,153,63,0.5)'}` : '1px solid transparent',
                backgroundColor: tag.priority
                  ? tag.color
                    ? `${tag.color}20`
                    : 'rgba(246,153,63,0.12)'
                  : tag.color
                  ? `${tag.color}15`
                  : 'rgba(52,211,153,0.12)',
                color: tag.color ? '#fff' : tag.priority ? 'rgb(249,115,22)' : 'rgb(52,211,153)',
              }"
              @click="openNote(tag.noteId, tag.tabId, tag.lineIndex)"
            >
              <span
                class="h-3 w-1 shrink-0"
                :style="tag.color ? { backgroundColor: tag.color } : { backgroundColor: 'rgba(52,211,153,0.6)' }"
              ></span>
              <span :class="tag.priority ? 'font-bold' : ''">
                #{{ tag.tag.length > 20 ? tag.tag.slice(0, 20) + '…' : tag.tag }}
              </span>
            </button>
          </div>
          <div v-if="!tags.length" class="mt-2 border border-white/10 bg-slate-900/20 p-3 text-sm text-slate-300">
            No tags found.
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
