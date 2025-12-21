<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { buildCalendarEntriesForRange } from '../calendar/entryCache'
import type { CalendarEntry } from '../calendar/types'
import { listActiveNotes, listAllTabs } from '../db'


const router = useRouter()
const currentMonth = ref(new Date())
const entries = ref<CalendarEntry[]>([])
const allNotes = ref<Awaited<ReturnType<typeof listActiveNotes>>>([])
const allTabs = ref<Awaited<ReturnType<typeof listAllTabs>>>([])
const selectedDate = ref<string | null>(null)
const loading = ref(true)
const isMobile = ref(false)
const dayOverlay = ref<{ date: string; entries: CalendarEntry[] } | null>(null)

const pad = (n: number) => n.toString().padStart(2, '0')
const formatDate = (y: number, mIndex: number, d: number) => `${y}-${pad(mIndex + 1)}-${pad(d)}`
const todayStr = computed(() => {
  const d = new Date()
  return formatDate(d.getFullYear(), d.getMonth(), d.getDate())
})

const startOfMonth = computed(() => new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth(), 1))
const monthLabel = computed(() =>
  currentMonth.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
)

const leadingBlanks = computed(() => startOfMonth.value.getDay())

const entriesByDay = computed(() => {
  const map = new Map<string, CalendarEntry[]>()
  entries.value.forEach((e) => {
    const list = map.get(e.date) ?? []
    list.push(e)
    map.set(e.date, list)
  })
  return map
})

const calendarSlots = computed(() => {
  const year = currentMonth.value.getFullYear()
  const monthIndex = currentMonth.value.getMonth()
  const firstOfMonth = new Date(year, monthIndex, 1)
  const firstVisible = new Date(year, monthIndex, 1 - leadingBlanks.value)
  const slots: Array<{ day: number; date: string; inCurrentMonth: boolean }> = []

  for (let i = 0; i < 42; i++) {
    const d = new Date(firstVisible)
    d.setDate(firstVisible.getDate() + i)
    slots.push({
      day: d.getDate(),
      date: formatDate(d.getFullYear(), d.getMonth(), d.getDate()),
      inCurrentMonth: d.getMonth() === firstOfMonth.getMonth() && d.getFullYear() === firstOfMonth.getFullYear(),
    })
  }

  return slots
})

const selectTodayIfEmpty = () => {
  if (selectedDate.value) return
  const today = new Date()
  selectedDate.value = formatDate(today.getFullYear(), today.getMonth(), today.getDate())
}

const loadEntries = async () => {
  loading.value = true
  const [notes, tabs] = await Promise.all([listActiveNotes(), listAllTabs()])
  allNotes.value = notes
  allTabs.value = tabs
  rebuildEntries()
  loading.value = false
  selectTodayIfEmpty()
}

const rebuildEntries = () => {
  if (!calendarSlots.value.length) return
  const start = calendarSlots.value[0]?.date
  const end = calendarSlots.value[calendarSlots.value.length - 1]?.date
  if (!start || !end) return
  entries.value = buildCalendarEntriesForRange(allNotes.value, allTabs.value, { start, end })
}

const changeMonth = (delta: number) => {
  const next = new Date(currentMonth.value)
  next.setMonth(next.getMonth() + delta)
  currentMonth.value = next
  rebuildEntries()
}

const selectDate = (dateStr: string) => {
  selectedDate.value = dateStr
  if (isMobile.value) {
    const entriesForDay = entriesByDay.value.get(dateStr) ?? []
    dayOverlay.value = { date: dateStr, entries: entriesForDay }
  }
}

const openEntry = (entry: CalendarEntry, event?: MouseEvent) => {
  event?.stopPropagation()
  const snippet = (entry.textAfterToken || '').slice(0, 10)
  router.push({
    name: 'note-editor',
    params: { id: entry.noteId },
    query: { date: entry.tokenDate, tab: entry.tabId, ...(snippet ? { snippet } : {}) },
  })
  dayOverlay.value = null
}

const entryLabel = (entry: CalendarEntry) => {
  const text = (entry.textAfterToken || '').trim()
  if (text.length) return text
  return entry.firstTabName || entry.noteTitle
}

const entryColor = (entry: CalendarEntry) => entry.noteColor ?? null

const maxTileEntries = computed(() => (isMobile.value ? 3 : 6))


onMounted(loadEntries)

const handleResize = () => {
  isMobile.value = window.matchMedia('(max-width: 640px)').matches
}

onMounted(() => {
  handleResize()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
    <div
      class="flex flex-1 min-h-0 flex-col overflow-hidden px-2 sm:px-0"
    >
      <div class="flex items-center justify-between">
        <button
          type="button"
          class="border border-white/10 px-3 py-1 text-xs text-white hover:border-white/30"
          @click="changeMonth(-1)"
        >
          ←
        </button>
        <div class="text-sm font-semibold text-white">{{ monthLabel }}</div>
        <button
          type="button"
          class="border border-white/10 px-3 py-1 text-xs text-white hover:border-white/30"
          @click="changeMonth(1)"
        >
          →
        </button>
      </div>

      <div class="mt-3 grid grid-cols-7 gap-1 text-center text-xs text-slate-400 sm:mt-4">
        <span>Sun</span>
        <span>Mon</span>
        <span>Tue</span>
        <span>Wed</span>
        <span>Thu</span>
        <span>Fri</span>
        <span>Sat</span>
      </div>
      <div class="mt-2 grid flex-1 min-h-0 grid-cols-7 grid-rows-6 gap-0.5 text-sm overflow-hidden">
        <template v-for="(slot, index) in calendarSlots" :key="index">
          <button
            type="button"
            class="flex h-full flex-col border text-left text-white transition"
            :class="[
              slot.inCurrentMonth
                ? entriesByDay.get(slot.date)
                  ? 'border-indigo-300/50 bg-indigo-500/10'
                  : 'border-white/10 bg-white/5'
                : 'border-white/10 bg-black/20 text-slate-500',
              selectedDate === slot.date ? 'ring-2 ring-indigo-400' : '',
            ]"
            @click="selectDate(slot.date)"
          >
            <div class="relative px-1 pt-1 sm:px-2 sm:pt-2">
              <span
                class="text-sm font-semibold"
                :class="slot.date === todayStr ? 'text-white' : 'text-white/60'"
              >
                {{ slot.day }}
              </span>
              <span
                v-if="(entriesByDay.get(slot.date)?.length ?? 0) > maxTileEntries"
                class="absolute right-1 top-1 text-[10px] text-white/50 sm:right-2 sm:top-2"
              >
                +{{ (entriesByDay.get(slot.date)?.length ?? 0) - maxTileEntries }}
              </span>
            </div>
            <div class="flex-1 overflow-hidden px-1 pb-0 sm:px-2 sm:pb-2">
              <p
                v-for="entry in (entriesByDay.get(slot.date) || []).slice(0, maxTileEntries)"
                :key="entry.noteId + entry.tabId + entry.occurrenceIndex + entry.date"
                class="truncate text-[10px] text-indigo-100 hover:text-white sm:text-[11px]"
                @click.stop="!isMobile && openEntry(entry, $event)"
              >
                <span
                  class="inline border-b"
                  :style="{
                    borderColor: entryColor(entry) ?? 'rgba(255,255,255,0.25)',
                  }"
                >
                  {{ entryLabel(entry) }}
                </span>
              </p>
            </div>
          </button>
        </template>
      </div>
    </div>

  </section>
  <transition name="fade">
    <div
      v-if="dayOverlay"
      class="fixed inset-0 z-50 flex items-end bg-black/70 p-2 sm:items-center sm:p-4"
      @click.self="dayOverlay = null"
    >
      <div class="w-full rounded-3xl border border-white/10 bg-slate-900/95 p-3 text-white shadow-2xl sm:max-w-md sm:p-4">
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold">Entries for {{ dayOverlay.date }}</p>
          <button type="button" class="rounded-full border border-white/20 px-3 py-1 text-xs" @click="dayOverlay = null">
            Close
          </button>
        </div>
        <ul class="mt-4 space-y-3">
          <li
            v-for="entry in dayOverlay.entries"
            :key="entry.noteId + entry.tabId + entry.occurrenceIndex + entry.date"
            class="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-200"
            @click="openEntry(entry)"
          >
            <p class="font-semibold text-white">{{ entry.noteTitle }}</p>
            <div class="mt-1 flex items-center gap-2 text-slate-300">
              <span
                class="h-2.5 w-2.5 shrink-0"
                :style="{ backgroundColor: entryColor(entry) ?? 'rgba(255,255,255,0.25)' }"
              ></span>
              <p class="min-w-0 truncate">{{ entryLabel(entry) }}</p>
            </div>
          </li>
          <li v-if="!dayOverlay.entries.length" class="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300">
            No entries for this day.
          </li>
        </ul>
      </div>
    </div>
  </transition>
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
</style>
