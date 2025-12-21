<script setup lang="ts">
import { computed, watch } from 'vue'
import type { ParsedText } from '../parse'

const props = defineProps<{
  text: string
  parsed: ParsedText
  scrollTop: number
  viewportHeight: number
  lineHeight: number
  paddingTop?: number
  paddingBottom?: number
  imageThumbs?: Record<string, string>
  activeLine?: number
  wrapCols?: number
}>()

const emit = defineEmits<{
  (e: 'toggle-checklist', lineIndex: number): void
  (e: 'line-tags', payload: { lineIndex: number; tags: string[] }): void
  (e: 'line-link', payload: { lineIndex: number; urls: string[] }): void
  (e: 'line-images', payload: { lineIndex: number; imageIds: string[] }): void
  (e: 'line-dates', payload: { lineIndex: number; dates: string[] }): void
  (e: 'request-image', payload: { imageId: string }): void
  (e: 'hover-rect', payload: { top: number; height: number } | null): void
}>()

const lines = computed(() => props.text.replace(/\r\n/g, '\n').split('\n'))
const lineCount = computed(() => Math.max(1, lines.value.length))

const lineMeta = computed(() => {
  const map = new Map<
    number,
    {
      hasChecklist?: boolean
      checklistChecked?: boolean
      urls?: string[]
      tags?: { tag: string; priority?: boolean }[]
      images?: string[]
      dates?: string[]
    }
  >()

  props.parsed.checklists.forEach((c) => {
    const entry = map.get(c.lineIndex) ?? {}
    entry.hasChecklist = true
    entry.checklistChecked = c.checked
    map.set(c.lineIndex, entry)
  })

  props.parsed.urls.forEach((u) => {
    const entry = map.get(u.lineIndex) ?? {}
    entry.urls = [...(entry.urls ?? []), u.url]
    map.set(u.lineIndex, entry)
  })

  props.parsed.tags.forEach((t) => {
    const entry = map.get(t.lineIndex) ?? {}
    entry.tags = [...(entry.tags ?? []), { tag: t.tag, priority: t.priority }]
    map.set(t.lineIndex, entry)
  })

  props.parsed.images.forEach((img) => {
    const entry = map.get(img.lineIndex) ?? {}
    entry.images = [...(entry.images ?? []), img.imageId]
    map.set(img.lineIndex, entry)
  })

  props.parsed.dates.forEach((d) => {
    const entry = map.get(d.lineIndex) ?? {}
    entry.dates = [...(entry.dates ?? []), d.date]
    map.set(d.lineIndex, entry)
  })

  return map
})

const buffer = 5
const wrapMap = computed(() => {
  const cols = Math.max(1, props.wrapCols ?? Number.POSITIVE_INFINITY)
  const rowStarts: number[] = new Array(lineCount.value)
  const rowCounts: number[] = new Array(lineCount.value)
  let rows = 0
  for (let i = 0; i < lineCount.value; i++) {
    const line = lines.value[i] ?? ''
    const len = line.length || 0
    const count = cols === Number.POSITIVE_INFINITY ? 1 : Math.max(1, Math.ceil(len / cols))
    rowStarts[i] = rows
    rowCounts[i] = count
    rows += count
  }
  return { rowStarts, rowCounts, totalRows: rows }
})

const findLineForRow = (row: number) => {
  const starts = wrapMap.value.rowStarts
  const counts = wrapMap.value.rowCounts
  let lo = 0
  let hi = starts.length - 1
  let best = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((starts[mid] ?? 0) <= row) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  while (best > 0 && row < (starts[best] ?? 0)) best--
  while (best < counts.length - 1 && row >= (starts[best] ?? 0) + (counts[best] ?? 1)) best++
  return best
}

const visible = computed(() => {
  const paddingTop = props.paddingTop ?? 0
  const offset = Math.max(0, props.scrollTop - paddingTop)
  const startRow = Math.max(0, Math.floor(offset / props.lineHeight) - buffer)
  const rowsVisible = Math.ceil(props.viewportHeight / props.lineHeight) + buffer * 2
  const endRow = Math.min(wrapMap.value.totalRows, startRow + rowsVisible)

  const startLine = findLineForRow(startRow)
  let endLine = startLine
  while (endLine < lineCount.value && (wrapMap.value.rowStarts[endLine] ?? 0) < endRow) endLine++
  return { startLine, endLine }
})

const rowItems = computed(() => {
  const items = []
  for (let i = visible.value.startLine; i < visible.value.endLine; i++) {
    const meta = lineMeta.value.get(i)
    items.push({
      lineIndex: i,
      meta,
      rowStart: wrapMap.value.rowStarts[i] ?? 0,
      rowCount: wrapMap.value.rowCounts[i] ?? 1,
    })
  }
  return items
})

const visibleImageIds = computed(() => {
  const ids = new Set<string>()
  rowItems.value.forEach((item) => {
    item.meta?.images?.forEach((id) => ids.add(id))
  })
  return Array.from(ids)
})

watch(
  () => visibleImageIds.value,
  (ids) => {
    ids.forEach((id) => emit('request-image', { imageId: id }))
  },
  { immediate: true }
)

const clickChecklist = (lineIndex: number, event: MouseEvent) => {
  event.preventDefault()
  emit('toggle-checklist', lineIndex)
}

const clickTags = (lineIndex: number, tags?: { tag: string; priority?: boolean }[]) => {
  if (!tags?.length) return
  emit('line-tags', { lineIndex, tags: tags.map((t) => t.tag) })
}

const clickLinks = (lineIndex: number, urls?: string[]) => {
  if (!urls?.length) return
  emit('line-link', { lineIndex, urls })
}

const clickImages = (lineIndex: number, imageIds?: string[]) => {
  if (!imageIds?.length) return
  emit('line-images', { lineIndex, imageIds })
}

const clickDates = (lineIndex: number, dates?: string[]) => {
  if (!dates?.length) return
  emit('line-dates', { lineIndex, dates })
}
</script>

<template>
  <div
    class="relative w-12 select-none overflow-hidden border-r border-white/10 bg-transparent"
    :style="{ height: `${(viewportHeight || lineCount * lineHeight)}px` }"
    @mouseleave="emit('hover-rect', null)"
  >
    <div
      class="absolute inset-0"
      :style="{
        height: `${(paddingTop ?? 0) + (paddingBottom ?? 0) + wrapMap.totalRows * lineHeight}px`,
      }"
    >
      <div
        v-for="item in rowItems"
        :key="item.lineIndex"
        class="absolute left-0 right-0 flex items-center justify-stretch gap-0 px-0"
        :style="{
          height: `${item.rowCount * lineHeight}px`,
          transform: `translateY(${(paddingTop ?? 0) + item.rowStart * lineHeight - scrollTop}px)`,
        }"
        :class="[
          activeLine === item.lineIndex
            ? item.meta?.tags?.some((t) => t.priority)
              ? 'bg-orange-500/15'
              : 'bg-white/10'
            : '',
          activeLine !== item.lineIndex && item.meta?.tags?.some((t) => t.priority) ? 'bg-orange-500/8' : '',
        ]"
        @mouseenter="
          emit('hover-rect', {
            top: (paddingTop ?? 0) + item.rowStart * lineHeight - scrollTop,
            height: item.rowCount * lineHeight,
          })
        "
      >
        <button
          v-if="item.meta?.hasChecklist"
          class="icon-chip"
          :class="item.meta.checklistChecked ? 'bg-amber-400/30 text-amber-100 border-amber-200/60' : 'bg-amber-400/15 text-amber-200'"
          type="button"
          @mousedown.prevent
          @click="clickChecklist(item.lineIndex, $event)"
        >
          {{ item.meta.checklistChecked ? '☑︎' : '☐' }}
        </button>
        <button
          v-if="item.meta?.dates?.length"
          class="icon-chip bg-purple-400/15 text-purple-200 border border-white/15"
          type="button"
          @mousedown.prevent
          @click="clickDates(item.lineIndex, item.meta.dates)"
        >
          📅
        </button>
        <button
          v-if="item.meta?.images?.length"
          class="icon-chip bg-indigo-400/15 text-indigo-200 p-0"
          type="button"
          @mousedown.prevent
          @click="clickImages(item.lineIndex, item.meta.images)"
        >
          <img
            v-if="item.meta.images[0] && imageThumbs?.[item.meta.images[0]]"
            :src="imageThumbs[item.meta.images[0]]"
            alt="thumb"
            class="h-6 w-6 rounded-md object-cover"
          />
          <span v-else class="px-2">🖼</span>
        </button>
        <button
          v-if="item.meta?.urls?.length"
          class="icon-chip bg-sky-400/15 text-sky-200"
          type="button"
          @mousedown.prevent
          @click="clickLinks(item.lineIndex, item.meta.urls)"
        >
          🔗
        </button>
        <button
          v-if="item.meta?.tags?.length"
          class="icon-chip"
          :class="
            item.meta.tags.some((t) => t.priority)
              ? 'bg-orange-400/15 text-orange-100 border-orange-200/50'
              : 'bg-emerald-400/15 text-emerald-200'
          "
          type="button"
          @mousedown.prevent
          @click="clickTags(item.lineIndex, item.meta.tags)"
        >
          #
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.icon-chip {
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 2px 6px;
  font-size: 12px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
