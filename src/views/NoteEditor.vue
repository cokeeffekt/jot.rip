<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NoteEditorTextarea from '../editor/NoteEditorTextarea.vue'
import { insertChecklist, toggleHeader } from '../editor/format'
import { parseText } from '../editor/parse'
import EditorGutter from '../editor/gutter/EditorGutter.vue'
import ImageModal from '../images/ImageModal.vue'
import { processImageFile } from '../images/process'
import { buildCalendarEntriesForRange } from '../calendar/entryCache'
import type { CalendarEntry } from '../calendar/types'
import { normalizeTabOrder } from '../notes/tabOrder'
import { triggerSync } from '../sync/poller'
import {
  createNote,
  createTab,
  deleteTab,
  getNote,
  listActiveNotes,
  listAllTabs,
  listTabs,
  updateNote,
  updateTab,
  storeImage,
  getImage,
  listImages,
  type Note,
  type Tab,
} from '../db'

const route = useRoute()
const router = useRouter()

const note = ref<Note | null>(null)
const tabs = ref<Tab[]>([])
const activeTabId = ref<string | null>(null)
const content = ref('')
const loading = ref(true)
const saving = ref(false)
const selection = ref({ start: 0, end: 0 })
const editorRef = ref<InstanceType<typeof NoteEditorTextarea> | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)
const lineHeight = ref(22)
const paddingTop = ref(0)
const paddingBottom = ref(0)
const imageThumbs = ref<Record<string, string>>({})
const imageIdsInContent = computed(() => {
  const seen = new Set<string>()
  const ordered: string[] = []
  parsed.value.images.forEach((img) => {
    if (seen.has(img.imageId)) return
    seen.add(img.imageId)
    ordered.push(img.imageId)
  })
  return ordered
})
const activeImageId = ref<string | null>(null)
const imageModalSrc = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const cursorLine = ref(0)
const caretTop = computed(() =>
  Math.max(0, paddingTop.value + cursorLine.value * lineHeight.value - scrollTop.value)
)
const hoverRect = ref<{ top: number; height: number } | null>(null)
const wrapCols = ref(0)
const calendarJumpRect = ref<{ top: number; height: number } | null>(null)
let clearCalendarJumpTimer: number | null = null
const tagJumpRect = ref<{ top: number; height: number } | null>(null)
let clearTagJumpTimer: number | null = null
const datePopover = ref<{ date: string; entries: CalendarEntry[] } | null>(null)
const datePopoverLoading = ref(false)
const datePopoverRef = ref<HTMLElement | null>(null)
const fullImageSrcs = ref<Record<string, string>>({})
const exportPanelRef = ref<HTMLElement | null>(null)
let persistSeq = 0
const noteTitleDraft = ref('')
const noteColorDraft = ref<string | null>(null)
const colorPickerOpen = ref(false)
const colorPickerRef = ref<HTMLElement | null>(null)
const colorTriggerRef = ref<HTMLElement | null>(null)
const exportDialogOpen = ref(false)
const exportSelectedTabIds = ref<string[]>([])
const toggleExportTab = (tabId: string, checked: boolean) => {
  const next = new Set(exportSelectedTabIds.value)
  if (checked) next.add(tabId)
  else next.delete(tabId)
  exportSelectedTabIds.value = Array.from(next)
}
const sessionId =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
const startedAt = Date.now()
type OtherSession = { id: string; startedAt: number }
const broadcastChannelRef = ref<BroadcastChannel | null>(null)
const otherSessions = ref<OtherSession[]>([])
const isReadOnly = computed(() => otherSessions.value.some((s) => s.startedAt < startedAt))

const parsed = computed(() => parseText(content.value))
const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) || tabs.value[0] || null)
const tabOrderIds = computed(() => tabs.value.map((t) => t.id))
const tabChecklistStats = computed(() => {
  const map: Record<string, { total: number; checked: number }> = {}
  for (const tab of tabs.value) {
    const parsedTab = parseText(tab.content || '')
    const total = parsedTab.checklists.length
    const checked = parsedTab.checklists.filter((c) => c.checked).length
    map[tab.id] = { total, checked }
  }
  return map
})

const lines = computed(() => content.value.replace(/\r\n/g, '\n').split('\n'))

const wrapMap = computed(() => {
  const cols = wrapCols.value > 0 ? wrapCols.value : Number.POSITIVE_INFINITY
  const rowStarts: number[] = new Array(lines.value.length)
  const rowCounts: number[] = new Array(lines.value.length)
  let rows = 0
  for (let i = 0; i < lines.value.length; i++) {
    const len = (lines.value[i] ?? '').length
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

const visibleLineRange = computed(() => {
  const padTop = paddingTop.value ?? 0
  const offset = Math.max(0, scrollTop.value - padTop)
  const startRow = Math.max(0, Math.floor(offset / lineHeight.value) - 6)
  const rowsVisible = Math.ceil((viewportHeight.value || 0) / lineHeight.value) + 12
  const endRow = Math.min(wrapMap.value.totalRows, startRow + rowsVisible)

  const startLine = findLineForRow(startRow)
  let endLine = startLine
  while (endLine < lines.value.length && (wrapMap.value.rowStarts[endLine] ?? 0) < endRow) endLine++
  return { startLine, endLine }
})

const tagLines = computed(() => {
  const seen = new Set<number>()
  const out: { lineIndex: number; tag: string; priority?: boolean }[] = []
  parsed.value.tags.forEach((t) => {
    if (seen.has(t.lineIndex)) return
    seen.add(t.lineIndex)
    out.push({ lineIndex: t.lineIndex, tag: t.tag, priority: t.priority })
  })
  return out
})

const visibleTagHighlights = computed(() => {
  const start = visibleLineRange.value.startLine
  const end = visibleLineRange.value.endLine
  const tagByLine = new Map(tagLines.value.map((t) => [t.lineIndex, { tag: t.tag, priority: t.priority }]))
  const highlights: Array<{ lineIndex: number; top: number; height: number; tag: string; priority?: boolean }> = []
  for (let i = start; i < end; i++) {
    const tag = tagByLine.get(i)
    if (!tag) continue
    const rowStart = wrapMap.value.rowStarts[i] ?? 0
    const rowCount = wrapMap.value.rowCounts[i] ?? 1
    highlights.push({
      lineIndex: i,
      top: (paddingTop.value ?? 0) + rowStart * lineHeight.value - scrollTop.value,
      height: rowCount * lineHeight.value,
      tag: tag.tag,
      priority: tag.priority,
    })
  }
  return highlights
})

const addOtherSession = (id: string, started: number) => {
  if (!id) return
  if (otherSessions.value.find((s) => s.id === id)) return
  otherSessions.value = [...otherSessions.value, { id, startedAt: started || Date.now() }]
}

const removeOtherSession = (id: string) => {
  otherSessions.value = otherSessions.value.filter((s) => s.id !== id)
}

const handleChannelMessage = (event: MessageEvent) => {
  const data = event.data as {
    type?: string
    noteId?: string
    sessionId?: string
    updatedAt?: string
    startedAt?: number
    reply?: boolean
  }
  if (!data || !data.noteId || data.noteId !== note.value?.id) return
  if (data.sessionId === sessionId) return
  if (data.type === 'open') {
    addOtherSession(data.sessionId || '', data.startedAt || Date.now())
    if (!data.reply && broadcastChannelRef.value && note.value) {
      broadcastChannelRef.value.postMessage({
        type: 'open',
        noteId: note.value.id,
        sessionId,
        startedAt,
        reply: true,
      })
    }
  } else if (data.type === 'close') {
    removeOtherSession(data.sessionId || '')
  } else if (data.type === 'changed') {
    addOtherSession(data.sessionId || '', data.startedAt || Date.now())
    void reloadNoteFromDb(data.updatedAt)
  }
}

const setupChannel = () => {
  if (!note.value) return
  if (broadcastChannelRef.value) {
    broadcastChannelRef.value.close()
    broadcastChannelRef.value = null
  }
  const ch = new BroadcastChannel('jotrip-note-sync')
  ch.onmessage = handleChannelMessage
  broadcastChannelRef.value = ch
  ch.postMessage({ type: 'open', noteId: note.value.id, sessionId, startedAt, reply: false })
}

const teardownChannel = () => {
  if (broadcastChannelRef.value && note.value) {
    broadcastChannelRef.value.postMessage({ type: 'close', noteId: note.value.id, sessionId })
  }
  broadcastChannelRef.value?.close()
  broadcastChannelRef.value = null
  otherSessions.value = []
}

const ensureNoteAndTab = async () => {
  const id = route.params.id as string | undefined

  if (!id || id === 'new') {
    const created = await createNote({ title: 'Untitled note' })
    const createdTab = await createTab({ noteId: created.id, name: 'Main', content: '' })
    await updateNote(created.id, { tabOrder: [createdTab.id] })
    router.replace({ name: 'note-editor', params: { id: created.id } })
    note.value = created
    noteTitleDraft.value = created.title
    noteColorDraft.value = created.color ?? null
    tabs.value = [createdTab]
    activeTabId.value = createdTab.id
    content.value = createdTab.content
    loading.value = false
    return
  }

  const existing = await getNote(id)
  if (!existing) {
    loading.value = false
    return
  }
  note.value = existing
  noteTitleDraft.value = existing.title
  noteColorDraft.value = existing.color ?? null

  const fetchedTabs = await listTabs(id)
  let tabList = fetchedTabs
  if (!tabList.length) {
    const firstTab = await createTab({ noteId: id, name: 'Main', content: '' })
    await updateNote(id, { tabOrder: [firstTab.id] })
    tabList = [firstTab]
  }
  const normalizedOrder = normalizeTabOrder(existing, tabList)
  tabs.value = normalizedOrder.map((tabId) => tabList.find((t) => t.id === tabId)).filter((t): t is Tab => Boolean(t))
  if (normalizedOrder.some((idVal, idx) => idVal !== (existing.tabOrder[idx] ?? ''))) {
    await updateNote(existing.id, { tabOrder: normalizedOrder })
  }
  setInitialActiveTab(normalizedOrder)
  const active = tabs.value.find((t) => t.id === activeTabId.value)
  content.value = active?.content ?? ''
  loading.value = false
  void applyCalendarJumpFromRoute()
  void applyLineJumpFromRoute()
  setupChannel()
}

const reloadNoteFromDb = async (incomingUpdatedAt?: string) => {
  if (!note.value) return
  const currentUpdated = note.value.updatedAt
  if (incomingUpdatedAt && currentUpdated && new Date(incomingUpdatedAt).getTime() <= new Date(currentUpdated).getTime()) {
    return
  }
  const refreshed = await getNote(note.value.id)
  if (!refreshed) return
  if (currentUpdated && refreshed.updatedAt && new Date(refreshed.updatedAt).getTime() <= new Date(currentUpdated).getTime()) {
    if (!incomingUpdatedAt) return
  }
  const fetchedTabs = await listTabs(refreshed.id)
  const normalizedOrder = normalizeTabOrder(refreshed, fetchedTabs)
  tabs.value = normalizedOrder.map((tabId) => fetchedTabs.find((t) => t.id === tabId)).filter((t): t is Tab => Boolean(t))
  if (normalizedOrder.some((idVal, idx) => idVal !== (refreshed.tabOrder[idx] ?? ''))) {
    await updateNote(refreshed.id, { tabOrder: normalizedOrder })
  }
  note.value = refreshed
  noteTitleDraft.value = refreshed.title
  noteColorDraft.value = refreshed.color ?? null
  const nextActive = tabs.value.find((t) => t.id === activeTabId.value) ?? tabs.value[0]
  activeTabId.value = nextActive?.id ?? null
  content.value = nextActive?.content ?? ''
}

const getLastTabKey = (noteId: string) => `jotrip:lastTab:${noteId}`

const setInitialActiveTab = (order: string[]) => {
  if (!order.length) {
    activeTabId.value = null
    return
  }
  const requestedQuery = route.query.tab as string | undefined
  const noteId = note.value?.id
  const requestedStored = noteId ? window.localStorage.getItem(getLastTabKey(noteId)) ?? undefined : undefined
  const requested = requestedQuery || requestedStored || order[0]
  const chosen = requested && order.includes(requested) ? requested : order[0]
  activeTabId.value = chosen ?? null
}

const persistContent = async (value: string) => {
  if (!activeTab.value) return
  const seq = ++persistSeq
  saving.value = true
  await updateTab(activeTab.value.id, { content: value })
  if (seq !== persistSeq) return
  if (note.value) {
    const updated = await updateNote(note.value.id, {})
    if (seq !== persistSeq) return
    if (updated) note.value = updated
  }
  if (activeTab.value) {
    tabs.value = tabs.value.map((t) => (t.id === activeTab.value!.id ? { ...t, content: value } : t))
  }
  saving.value = false
  broadcastChange(note.value?.updatedAt)
}

const handleSelectionChange = (payload: { start: number; end: number }) => {
  selection.value = payload
}

const broadcastChange = (updatedAt?: string) => {
  if (!note.value || !broadcastChannelRef.value) return
  broadcastChannelRef.value.postMessage({
    type: 'changed',
    noteId: note.value.id,
    sessionId,
    startedAt,
    updatedAt: updatedAt ?? note.value.updatedAt,
  })
}

const applyFormat = async (action: 'header' | 'checklist') => {
  if (isReadOnly.value) return
  if (!activeTab.value) return
  const { start } = selection.value
  const value = content.value

  let result: ReturnType<typeof toggleHeader> | ReturnType<typeof insertChecklist>

  if (action === 'header') result = toggleHeader(value, start)
  else result = insertChecklist(value, start)

  content.value = result.text
  await persistContent(result.text)
  await nextTick()
  const el = editorRef.value?.$el as HTMLTextAreaElement | undefined
  el?.setSelectionRange(result.selectionStart, result.selectionEnd)
}

const handleTabClick = (tabId: string) => {
  void setActiveTab(tabId)
}

const setActiveTab = async (tabId: string) => {
  if (activeTabId.value === tabId) return
  if (activeTab.value) {
    await persistContent(content.value)
    triggerSync('tab-switch')
  }
  activeTabId.value = tabId
  if (note.value) {
    window.localStorage.setItem(getLastTabKey(note.value.id), tabId)
  }
  const nextTab = tabs.value.find((t) => t.id === tabId)
  if (nextTab) content.value = nextTab.content
  void applyCalendarJumpFromRoute()
}

const addTab = async () => {
  if (isReadOnly.value) return
  if (!note.value) return
  if (activeTab.value) await persistContent(content.value)
  const name = `Tab ${tabs.value.length + 1}`
  const newTab = await createTab({ noteId: note.value.id, name, content: '' })
  tabs.value = [...tabs.value, newTab]
  const nextOrder = [...tabOrderIds.value, newTab.id]
  await updateNote(note.value.id, { tabOrder: nextOrder })
  activeTabId.value = newTab.id
  content.value = ''
}

const renameTab = async (tabId: string) => {
  if (isReadOnly.value) return
  if (!tabId) return
  const target = tabs.value.find((t) => t.id === tabId)
  if (!target) return
  const nextName = window.prompt('Rename tab', target.name)
  if (!nextName) return
  await updateTab(tabId, { name: nextName })
  tabs.value = tabs.value.map((t) => (t.id === tabId ? { ...t, name: nextName } : t))
}

const deleteTabById = async (tabId: string) => {
  if (isReadOnly.value) return
  if (!tabId) return
  if (tabs.value.length <= 1) {
    window.alert('A note must have at least one tab.')
    return
  }
  const ok = window.confirm('Delete this tab?')
  if (!ok) return
  const nextTabs = tabs.value.filter((t) => t.id !== tabId)
  await deleteTab(tabId)
  const nextOrder = normalizeTabOrder(note.value!, nextTabs)
  await updateNote(note.value!.id, { tabOrder: nextOrder })
  tabs.value = nextTabs
  if (!nextTabs.find((t) => t.id === activeTabId.value)) {
    const nextId = nextOrder[0] || nextTabs[0]?.id || null
    activeTabId.value = nextId
    const nextTab = nextTabs.find((t) => t.id === nextId)
    content.value = nextTab?.content ?? ''
  }
}

const moveTab = async (tabId: string, direction: 1 | -1) => {
  if (!tabId) return
  if (!note.value) return
  const order = [...tabOrderIds.value]
  const idx = order.indexOf(tabId)
  if (idx === -1) return
  const swapWith = idx + direction
  if (swapWith < 0 || swapWith >= order.length) return
  const a = order[idx]
  const b = order[swapWith]
  if (!a || !b) return
  order[idx] = b
  order[swapWith] = a
  tabs.value = order.map((id) => tabs.value.find((t) => t.id === id)).filter((t): t is Tab => Boolean(t))
  await updateNote(note.value.id, { tabOrder: order })
}

const saveTitle = async () => {
  if (!note.value) return
  const nextTitle = (noteTitleDraft.value ?? '').trim() || 'Untitled note'
  if (nextTitle === note.value.title) return
  const updated = await updateNote(note.value.id, { title: nextTitle })
  if (updated) note.value = updated
  noteTitleDraft.value = updated?.title ?? nextTitle
  broadcastChange(updated?.updatedAt)
}

const togglePin = async () => {
  if (!note.value || isReadOnly.value) return
  const nextPinned = note.value.pinnedAt ? null : new Date().toISOString()
  const updated = await updateNote(note.value.id, { pinnedAt: nextPinned })
  if (updated) note.value = updated
  broadcastChange(updated?.updatedAt)
}

const noteColors = [
  null,
  '#94a3b8',
  '#f87171',
  '#fb923c',
  '#fbbf24',
  '#a3e635',
  '#34d399',
  '#2dd4bf',
  '#22d3ee',
  '#60a5fa',
  '#818cf8',
  '#a78bfa',
  '#e879f9',
  '#fb7185',
  '#f472b6',
  '#c084fc',
]

const saveColor = async (color: string | null) => {
  if (!note.value) return
  noteColorDraft.value = color
  const updated = await updateNote(note.value.id, { color })
  if (updated) note.value = updated
}

const toggleColorPicker = () => {
  colorPickerOpen.value = !colorPickerOpen.value
}

const closeColorPicker = () => {
  colorPickerOpen.value = false
}

const computeVisualRowStartAndCount = (lineIndex: number) => {
  const cols = wrapCols.value > 0 ? wrapCols.value : Number.POSITIVE_INFINITY
  const lines = content.value.replace(/\r\n/g, '\n').split('\n')
  const clampedIndex = Math.max(0, Math.min(lineIndex, lines.length - 1))
  let rowStart = 0
  for (let i = 0; i < clampedIndex; i++) {
    const len = (lines[i] ?? '').length
    const rows = cols === Number.POSITIVE_INFINITY ? 1 : Math.max(1, Math.ceil(len / cols))
    rowStart += rows
  }
  const currentLen = (lines[clampedIndex] ?? '').length
  const rowCount = cols === Number.POSITIVE_INFINITY ? 1 : Math.max(1, Math.ceil(currentLen / cols))
  return { rowStart, rowCount }
}

const getEditorMetrics = () => {
  const el = editorRef.value?.$el as HTMLTextAreaElement | undefined
  if (!el) {
    return { scrollTop: scrollTop.value, paddingTop: paddingTop.value ?? 0 }
  }
  const styles = getComputedStyle(el)
  const padding = parseFloat(styles.paddingTop)
  return {
    scrollTop: el.scrollTop,
    paddingTop: Number.isFinite(padding) ? padding : paddingTop.value ?? 0,
  }
}

const highlightCalendarLine = (lineIndex: number) => {
  if (clearCalendarJumpTimer) {
    window.clearTimeout(clearCalendarJumpTimer)
    clearCalendarJumpTimer = null
  }
  const { rowStart, rowCount } = computeVisualRowStartAndCount(lineIndex)
  const metrics = getEditorMetrics()
  calendarJumpRect.value = {
    top: metrics.paddingTop + rowStart * lineHeight.value - metrics.scrollTop,
    height: rowCount * lineHeight.value,
  }
  clearCalendarJumpTimer = window.setTimeout(() => {
    calendarJumpRect.value = null
    clearCalendarJumpTimer = null
  }, 2000)
}

const findCalendarJumpTarget = (date: string, snippet?: string) => {
  const normalizedContent = content.value.replace(/\r\n/g, '\n')
  const lines = normalizedContent.split('\n')
  let offset = 0
  const regex = /@(\d{4}-\d{2}-\d{2})/g

  let firstMatch: { pos: number; lineIndex: number } | null = null

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? ''
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(line))) {
      if (match[1] !== date) continue
      const tokenEnd = match.index + match[0].length
      const after = line.slice(tokenEnd).trim()
      const after10 = after.slice(0, 10)
      const pos = offset + match.index
      if (!firstMatch) firstMatch = { pos, lineIndex }
      if (snippet && after10 === snippet) return { pos, lineIndex }
    }
    offset += line.length + 1
  }

  return firstMatch
}

const scrollToPosition = (pos: number, lineIndex: number) => {
  const el = editorRef.value?.$el as HTMLTextAreaElement | undefined
  if (!el) return
  const { rowStart } = computeVisualRowStartAndCount(lineIndex)
  el.focus()
  el.setSelectionRange(pos, pos)
  const target =
    (paddingTop.value ?? 0) + rowStart * lineHeight.value - viewportHeight.value / 2 + lineHeight.value
  if (!Number.isNaN(target)) {
    el.scrollTop = Math.max(0, target)
    scrollTop.value = el.scrollTop
    viewportHeight.value = el.clientHeight
  }
}

const applyCalendarJumpFromRoute = async () => {
  const date = route.query.date as string | undefined
  if (!date) return
  const snippet = route.query.snippet as string | undefined

  await nextTick()
  const target = findCalendarJumpTarget(date, snippet)
  if (!target) return
  scrollToPosition(target.pos, target.lineIndex)
  requestAnimationFrame(() => highlightCalendarLine(target.lineIndex))
}

const applyLineJumpFromRoute = async () => {
  const lineRaw = route.query.line as string | undefined
  if (!lineRaw) return
  const lineIndex = Number(lineRaw)
  if (!Number.isFinite(lineIndex)) return

  await nextTick()
  scrollToLine(lineIndex)
}

const scrollToLine = (lineIndex: number) => {
  const el = editorRef.value?.$el as HTMLTextAreaElement | undefined
  if (!el) return
  const clamped = Math.max(0, Math.min(lineIndex, lines.value.length - 1))
  const pos = lines.value.slice(0, clamped).reduce((acc, l) => acc + l.length + 1, 0)
  scrollToPosition(pos, clamped)
  highlightTagLine(clamped)
}

const highlightTagLine = (lineIndex: number) => {
  if (clearTagJumpTimer) {
    window.clearTimeout(clearTagJumpTimer)
    clearTagJumpTimer = null
  }
  const { rowStart, rowCount } = computeVisualRowStartAndCount(lineIndex)
  const metrics = getEditorMetrics()
  tagJumpRect.value = {
    top: metrics.paddingTop + rowStart * lineHeight.value - metrics.scrollTop,
    height: rowCount * lineHeight.value,
  }
  clearTagJumpTimer = window.setTimeout(() => {
    tagJumpRect.value = null
    clearTagJumpTimer = null
  }, 1200)
}

const toggleChecklistLine = async (lineIndex: number) => {
  const lines = content.value.split('\n')
  const line = lines[lineIndex]
  if (line === undefined) return
  const pattern = /^(\s*-\s\[)( |x|X)(\])/
  if (!pattern.test(line)) return
  const replaced = line.replace(pattern, (_match, prefix: string, marker: string, suffix: string) => {
    const nextMarker = marker.toLowerCase() === 'x' ? ' ' : 'x'
    return `${prefix}${nextMarker}${suffix}`
  })
  lines[lineIndex] = replaced
  const next = lines.join('\n')
  content.value = next
  await persistContent(next)
}

const handleGutterLink = (payload: { urls: string[] }) => {
  const target =
    payload.urls.length === 1
      ? payload.urls[0]
      : window.prompt('Open which link?', payload.urls.join('\n'))
  if (target) window.open(target, '_blank')
  editorRef.value?.focus()
}

const handleGutterTags = () => {
  editorRef.value?.focus()
}

const handleGutterImages = async (payload: { imageIds: string[] }) => {
  const id = payload.imageIds[0]
  if (id) {
    await openImageById(id)
  }
  editorRef.value?.focus()
}

const openDatePopover = async (date: string) => {
  datePopoverLoading.value = true
  datePopover.value = { date, entries: [] }
  const [notes, tabs] = await Promise.all([listActiveNotes(), listAllTabs()])
  datePopover.value = { date, entries: buildCalendarEntriesForRange(notes, tabs, { start: date, end: date }) }
  datePopoverLoading.value = false
}

const entryLabel = (entry: CalendarEntry) => {
  const text = (entry.textAfterToken || '').trim()
  if (text.length) return text
  return entry.firstTabName || entry.noteTitle
}

const openCalendarEntryFromPopover = (entry: CalendarEntry) => {
  const snippet = (entry.textAfterToken || '').slice(0, 10)
  datePopover.value = null
  datePopoverLoading.value = false
  router.push({
    name: 'note-editor',
    params: { id: entry.noteId },
    query: { date: entry.tokenDate, tab: entry.tabId, ...(snippet ? { snippet } : {}) },
  })
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

const gatherExportData = async (tabIds: string[]) => {
  if (!note.value) return null
  const noteId = note.value.id
  const chosenTabs = tabs.value.filter((t) => tabIds.includes(t.id))
  const tabOrder = note.value.tabOrder.filter((id) => tabIds.includes(id))
  const images = await listImages({ noteId })
  const imagesForTabs = images.filter((img) => tabIds.includes(img.tabId))

  const imageData: {
    id: string
    tabId: string
    mime: string
    base64: string
    width?: number
    height?: number
    thumbnailDataUrl?: string
  }[] = []
  for (const img of imagesForTabs) {
    const base64 = await blobToDataUrl(img.blob)
    imageData.push({
      id: img.id,
      tabId: img.tabId,
      mime: img.mime,
      base64: base64.split(',')[1] ?? '',
      width: img.width,
      height: img.height,
      thumbnailDataUrl: img.thumbnailDataUrl,
    })
  }

  return {
    version: '1',
    note: { title: note.value.title, color: note.value.color ?? null },
    tabs: chosenTabs.map((t) => ({ id: t.id, name: t.name, content: t.content })),
    tabOrder,
    images: imageData,
  }
}

const escapeHtml = (str: string) =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const buildHtmlExport = (data: Awaited<ReturnType<typeof gatherExportData>>) => {
  if (!data) return ''
  const imageMap: Record<string, string> = {}
  data.images?.forEach((img) => {
    imageMap[img.id] = `data:${img.mime};base64,${img.base64}`
  })

  const renderContent = (text: string) => {
    const lines = text.split('\n')
    const htmlLines = lines.map((line) => {
      const escaped = escapeHtml(line)
      return escaped.replace(/!\[image:([^\]]+)\]/g, (_m, id) => {
        const src = imageMap[id] ?? ''
        return src ? `<a class="note-img-link" href="${src}" target="_blank" rel="noreferrer"><img class="note-img" data-full="${src}" src="${src}" /></a>` : _m
      })
    })
    return htmlLines.join('<br>')
  }

  const tabButtonsHtml = data.tabs
    .map((tab, idx) => `<button class="tab-btn" data-tab="${tab.id}">${escapeHtml(tab.name || `Tab ${idx + 1}`)}</button>`)
    .join('')

  const tabContentsHtml = data.tabs
    .map((tab) => `<div class="tab-content" data-tab="${tab.id}" style="display:none;">${renderContent(tab.content)}</div>`)
    .join('')

  const initialTab = data.tabOrder[0] ?? data.tabs[0]?.id ?? ''

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(data.note.title || 'Exported Note')}</title>
  <style>
    :root { --editor-font: 'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Menlo, Consolas, monospace; }
    body { font-family: var(--editor-font); background: #0b1021; color: #e5e7eb; margin: 0; padding: 16px; }
    h1 { margin: 0 0 12px; font-size: 20px; }
    .tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
    .tab-btn { border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #e5e7eb; padding: 6px 10px; cursor: pointer; }
    .tab-btn.active { border-color: rgba(129,140,248,0.8); background: rgba(129,140,248,0.15); }
    .tab-content { border: 1px solid rgba(255,255,255,0.1); padding: 12px; background: rgba(255,255,255,0.03); min-height: 200px; line-height: 1.6; font-family: var(--editor-font); }
    img.note-img { width: 100px; height: auto; display: block; margin: 8px 0; cursor: pointer; }
    .note-img-link { display: inline-block; }
  </style>
</head>
<body>
  <h1>${escapeHtml(data.note.title || 'Exported Note')}</h1>
  <div class="tabs">${tabButtonsHtml}</div>
  <div class="tab-contents">${tabContentsHtml}</div>
  <script type="application/json" id="jotrip-export">${JSON.stringify(data)}<\/script>
  <script>
    (function() {
      const tabs = Array.from(document.querySelectorAll('.tab-btn'));
      const contents = Array.from(document.querySelectorAll('.tab-content'));
      const show = (id) => {
        tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === id));
        contents.forEach((c) => c.style.display = c.dataset.tab === id ? 'block' : 'none');
      };
      tabs.forEach((btn) => btn.addEventListener('click', () => show(btn.dataset.tab)));
      document.querySelectorAll('.note-img-link').forEach((link) => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const href = link.getAttribute('href');
          if (!href) return;
          const win = window.open('', '_blank');
          if (!win) return;
          win.document.write('<!doctype html><html><head><title>Image</title></head><body style=\"margin:0;background:#0b1021;display:flex;align-items:center;justify-content:center;\"><img src=\"' + href + '\" style=\"max-width:100%;max-height:100vh;\" /></body></html>');
          win.document.close();
        });
      });
      show('${initialTab}');
    })();
  <\/script>
</body>
</html>`
}

const downloadFile = (filename: string, content: string, mime = 'text/plain') => {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const openExportDialog = () => {
  exportSelectedTabIds.value = tabs.value.map((t) => t.id)
  exportDialogOpen.value = true
}

const exportAsHtml = async () => {
  const data = await gatherExportData(exportSelectedTabIds.value)
  if (!data) return
  const html = buildHtmlExport(data)
  downloadFile(`${note.value?.title || 'note'}.html`, html, 'text/html')
  exportDialogOpen.value = false
}

const exportAsTxt = () => {
  if (!note.value) return
  const parts: string[] = []
  tabs.value.forEach((tab, idx) => {
    parts.push(`=== ${tab.name || 'Tab ' + (idx + 1)} ===`)
    parts.push(tab.content)
    parts.push('')
  })
  downloadFile(`${note.value.title || 'note'}.txt`, parts.join('\n'), 'text/plain')
  exportDialogOpen.value = false
}

const handleGutterDates = async (payload: { dates: string[] }) => {
  const date =
    payload.dates.length === 1
      ? payload.dates[0]
      : window.prompt('Which date?', payload.dates.join('\n')) ?? undefined
  if (!date) return
  await openDatePopover(date)
  editorRef.value?.focus()
}

const handleScroll = (payload: {
  scrollTop: number
  clientHeight: number
  lineHeight: number
  paddingTop: number
  paddingBottom: number
}) => {
  scrollTop.value = payload.scrollTop
  viewportHeight.value = payload.clientHeight
  if (payload.lineHeight) lineHeight.value = payload.lineHeight
  paddingTop.value = payload.paddingTop
  paddingBottom.value = payload.paddingBottom
}

const handleCursorLine = (payload: { lineIndex: number }) => {
  cursorLine.value = payload.lineIndex
}

const handleHoverRect = (payload: { top: number; height: number } | null) => {
  hoverRect.value = payload
}

const handleWrapCols = (payload: { cols: number }) => {
  wrapCols.value = payload.cols
}

const requestImageThumb = async (payload: { imageId: string }) => {
  const id = payload.imageId
  if (imageThumbs.value[id]) return
  const img = await getImage(id)
  if (img?.thumbnailDataUrl) {
    imageThumbs.value = { ...imageThumbs.value, [id]: img.thumbnailDataUrl }
  }
}

const handleFileInput = () => {
  if (isReadOnly.value) return
  fileInputRef.value?.click()
}

const handleOutsideClick = (evt: MouseEvent | TouchEvent) => {
  const target = evt.target as Node

  if (colorPickerOpen.value) {
    const panel = colorPickerRef.value
    const trigger = colorTriggerRef.value
    if ((panel && panel.contains(target)) || (trigger && trigger.contains(target))) return
    closeColorPicker()
  }

  if (datePopover.value) {
    const panel = datePopoverRef.value
    if (panel && panel.contains(target)) return
    datePopover.value = null
    datePopoverLoading.value = false
  }

  if (exportDialogOpen.value) {
    const exportPanel = exportPanelRef.value
    if (exportPanel && exportPanel.contains(target)) return
    exportDialogOpen.value = false
  }
}

const makeShortImageId = (file?: File) => {
  const base =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().split('-')[0]
      : Math.random().toString(36).slice(2, 10)

  const name = file?.name?.trim()
  if (!name) return base
  const withoutExt = name.replace(/\.[a-z0-9]+$/i, '')
  const slug = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 12)
  return slug ? `${base}-${slug}` : base
}

const handleFiles = async (files: FileList | File[] | null) => {
  if (!files || !('length' in files) || !files.length || !note.value || !activeTab.value) return
  const list = Array.from(files as FileList | File[])
  for (const file of list) {
    if (!file.type.startsWith('image/')) continue
    const processed = await processImageFile(file)
    const id = makeShortImageId(file)
    const saved = await storeImage({
      id,
      noteId: note.value.id,
      tabId: activeTab.value.id,
      mime: processed.mime,
      blob: processed.blob,
      width: processed.width,
      height: processed.height,
      thumbnailDataUrl: processed.thumbnailDataUrl,
    })
    if (saved.thumbnailDataUrl) {
      imageThumbs.value = { ...imageThumbs.value, [saved.id]: saved.thumbnailDataUrl }
    }
    insertImagePlaceholder(saved.id)
  }
  if (fileInputRef.value) fileInputRef.value.value = ''
}

const insertImagePlaceholder = (imageId: string) => {
  const el = editorRef.value?.$el as HTMLTextAreaElement | undefined
  const placeholder = `![image:${imageId}]`
  const value = content.value
  if (el) {
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? start
    const needsLeading = start > 0 && value[start - 1] !== '\n' ? '\n' : ''
    const needsTrailing = end < value.length ? (value[end] !== '\n' ? '\n' : '') : '\n'
    const nextValue = value.slice(0, start) + needsLeading + placeholder + needsTrailing + value.slice(end)
    const nextCursor = start + needsLeading.length + placeholder.length + needsTrailing.length
    content.value = nextValue
    persistContent(nextValue)
    nextTick(() => {
      el.focus()
      el.setSelectionRange(nextCursor, nextCursor)
    })
  } else {
    const nextValue = `${value}\n${placeholder}\n`
    content.value = nextValue
    persistContent(nextValue)
  }
}

const handlePaste = (event: ClipboardEvent) => {
  const items = event.clipboardData?.items
  if (!items) return
  const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'))
  if (imageItem) {
    event.preventDefault()
    const file = imageItem.getAsFile()
    if (file) {
      handleFiles([file])
    }
  }
}

const ensureFullImageSrc = async (imageId: string) => {
  if (fullImageSrcs.value[imageId]) return fullImageSrcs.value[imageId]
  const image = await getImage(imageId)
  if (!image) return null
  const url = URL.createObjectURL(image.blob)
  fullImageSrcs.value = { ...fullImageSrcs.value, [imageId]: url }
  return url
}

const openImageById = async (imageId: string) => {
  activeImageId.value = imageId
  const full = await ensureFullImageSrc(imageId)
  if (full) imageModalSrc.value = full
}

const closeImageModal = () => {
  imageModalSrc.value = null
  activeImageId.value = null
}

const imageIndex = computed(() => {
  if (!activeImageId.value) return -1
  return imageIdsInContent.value.indexOf(activeImageId.value)
})

const canPrevImage = computed(() => imageIndex.value > 0)
const canNextImage = computed(() => imageIndex.value >= 0 && imageIndex.value < imageIdsInContent.value.length - 1)

const showPrevImage = async () => {
  if (!canPrevImage.value) return
  const nextId = imageIdsInContent.value[imageIndex.value - 1]
  if (nextId) await openImageById(nextId)
}

const showNextImage = async () => {
  if (!canNextImage.value) return
  const nextId = imageIdsInContent.value[imageIndex.value + 1]
  if (nextId) await openImageById(nextId)
}

onMounted(async () => {
  document.addEventListener('pointerdown', handleOutsideClick, true)
  await ensureNoteAndTab()
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleOutsideClick, true)
  if (clearCalendarJumpTimer) {
    window.clearTimeout(clearCalendarJumpTimer)
    clearCalendarJumpTimer = null
  }
  if (clearTagJumpTimer) {
    window.clearTimeout(clearTagJumpTimer)
    clearTagJumpTimer = null
  }
  teardownChannel()
  void saveTitle()
  triggerSync('note-leave')
})

watch(
  () => route.query,
  () => {
    const tabParam = route.query.tab as string | undefined
    if (tabParam && tabs.value.find((t) => t.id === tabParam)) {
      setActiveTab(tabParam)
      return
    }
    void applyCalendarJumpFromRoute()
    void applyLineJumpFromRoute()
  }
)

watch(
  () => tabs.value,
  () => {
    if (tabs.value.length && !activeTab.value) {
      const first = tabs.value[0]
      if (first) {
        activeTabId.value = first.id
        content.value = first.content
      }
    }
  }
)
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-2 overflow-hidden sm:gap-4" v-if="!loading && note && activeTab">
    <div
      v-if="isReadOnly"
      class="flex items-center gap-2 border border-yellow-400/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-200"
    >
      🔒 Read-only: open in another tab
    </div>
    <header class="relative flex shrink-0 items-center gap-2">
      <input
        v-model="noteTitleDraft"
        class="min-w-0 flex-1 border border-white/10 bg-white/5 px-2 py-1.5 text-xl font-semibold text-white outline-none sm:px-3 sm:py-2"
        placeholder="Untitled note"
        @blur="saveTitle"
        @keydown.enter.prevent="saveTitle"
        :disabled="isReadOnly"
      />
      <button
        ref="colorTriggerRef"
        type="button"
        class="h-9 w-9 border border-white/15 sm:h-10 sm:w-10"
        :style="{ backgroundColor: noteColorDraft ?? 'rgba(255,255,255,0.06)' }"
        @click="toggleColorPicker"
        :disabled="isReadOnly"
        aria-label="Pick note color"
      ></button>
      <button
        type="button"
        class="border border-white/15 px-2 py-1.5 text-xs text-white sm:px-3 sm:py-2"
        @click="openExportDialog"
        :disabled="isReadOnly"
      >
        Export
      </button>
      <button
        type="button"
        class="border border-white/15 px-2 py-1.5 text-xs text-white sm:px-3 sm:py-2"
        @click="togglePin"
        :disabled="isReadOnly"
      >
        <span :class="note?.pinnedAt ? 'text-white' : 'text-white/40 grayscale'">📌</span>
      </button>

      <div
        v-if="colorPickerOpen"
        ref="colorPickerRef"
        class="absolute right-0 top-full z-40 mt-2 border border-white/15 bg-slate-900 p-2 shadow-2xl sm:p-3"
      >
        <div class="grid grid-cols-8 gap-2">
          <button
            v-for="(c, idx) in noteColors"
            :key="idx"
            type="button"
            class="h-7 w-7 border border-white/15"
            :style="{ backgroundColor: c ?? 'rgba(255,255,255,0.06)' }"
            :class="(noteColorDraft ?? null) === (c ?? null) ? 'ring-2 ring-white/60' : ''"
            @click="saveColor(c); closeColorPicker()"
            :aria-label="c ? `Set color ${c}` : 'Set default color'"
          ></button>
        </div>
      </div>
      <div
        v-if="exportDialogOpen"
        ref="exportPanelRef"
        class="absolute right-0 top-full z-40 mt-2 w-56 border border-white/15 bg-slate-900 p-3 text-sm text-white shadow-2xl"
      >
        <p class="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Export tabs</p>
        <div class="mb-3 max-h-40 space-y-2 overflow-auto border border-white/10 p-2">
          <label
            v-for="tab in tabs"
            :key="tab.id"
            class="flex items-center gap-2 text-xs"
          >
            <input
              type="checkbox"
              class="h-4 w-4"
              :checked="exportSelectedTabIds.includes(tab.id)"
              @change="
                (e) => {
                  const checked = (e.target as HTMLInputElement).checked
                  toggleExportTab(tab.id, checked)
                }
              "
            />
            <span class="truncate">{{ tab.name }}</span>
          </label>
        </div>
        <div class="flex gap-2">
          <button class="flex-1 border border-indigo-300/40 bg-indigo-500/20 px-2 py-1" @click="exportAsHtml">
            HTML
          </button>
          <button class="flex-1 border border-white/20 px-2 py-1" @click="exportAsTxt">TXT</button>
        </div>
      </div>
    </header>

    <div
      class="tab-strip relative flex items-center gap-2 overflow-x-auto overflow-y-visible whitespace-nowrap text-white text-sm shrink-0 order-1 sm:order-none no-scrollbar"
    >
      <div
        v-for="tabItem in tabs"
        :key="tabItem.id"
        class="relative inline-flex"
      >
        <div class="pointer-events-none absolute left-0 top-0 bottom-0 w-1 bg-white/10" aria-hidden="true">
          <div
            v-if="tabChecklistStats[tabItem.id]?.total"
            class="absolute bottom-0 left-0 right-0"
            :style="{
              height: `${Math.round(
                ((tabChecklistStats[tabItem.id]?.checked || 0) /
                  Math.max(1, tabChecklistStats[tabItem.id]?.total || 1)) *
                  100
              )}%`,
              backgroundColor: noteColorDraft ?? 'rgba(52, 211, 153, 0.8)',
            }"
          ></div>
        </div>
        <button
          class="px-2 py-1.5 pl-4 border-b border-white/10 sm:px-3 sm:py-2"
          :style="
            activeTabId === tabItem.id && noteColorDraft
              ? { backgroundColor: noteColorDraft, color: '#0b1021' }
              : undefined
          "
          :class="activeTabId === tabItem.id ? 'text-white' : 'bg-transparent text-slate-200'"
          @click="handleTabClick(tabItem.id)"
          :disabled="isReadOnly"
        >
          {{ tabItem.name }}
        </button>
      </div>
      <button class="px-2 py-1.5 text-lg sm:px-3 sm:py-2" type="button" @click="addTab" :disabled="isReadOnly">＋</button>
    </div>

    <div class="flex flex-wrap items-center border border-white/15 text-white text-sm shrink-0 order-4 sm:order-none">
      <button class="px-2 py-1.5 sm:px-3 sm:py-2" type="button" @click="applyFormat('header')" :disabled="isReadOnly">#</button>
      <button class="px-2 py-1.5 sm:px-3 sm:py-2" type="button" @click="applyFormat('checklist')" :disabled="isReadOnly">☐</button>
      <button class="px-2 py-1.5 sm:px-3 sm:py-2" type="button" @click="handleFileInput" :disabled="isReadOnly">🖼</button>
      <span class="self-center text-[11px] text-slate-400" v-if="saving">Saving…</span>
      <div class="ml-auto flex items-center divide-x divide-white/15">
        <button class="px-2 py-1.5 sm:px-3 sm:py-2" type="button" @click="activeTabId && moveTab(activeTabId, -1)" :disabled="isReadOnly">←</button>
        <button class="px-2 py-1.5 sm:px-3 sm:py-2" type="button" @click="activeTabId && moveTab(activeTabId, 1)" :disabled="isReadOnly">→</button>
        <button class="px-2 py-1.5 sm:px-3 sm:py-2" type="button" @click="activeTabId && renameTab(activeTabId)" :disabled="isReadOnly">✎</button>
        <button
          class="px-2 py-1.5 sm:px-3 sm:py-2 text-red-200"
          type="button"
          @click="activeTabId && deleteTabById(activeTabId)"
          :disabled="isReadOnly"
        >
          ✕
        </button>
      </div>
    </div>

    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      multiple
      class="hidden"
      @change="handleFiles(($event.target as HTMLInputElement).files)"
    />

    <div class="relative flex flex-1 min-h-0 items-start border border-white/10 bg-white/5 overflow-hidden order-3 sm:order-none">
      <div
        v-for="hl in visibleTagHighlights"
        :key="hl.lineIndex"
        class="pointer-events-none absolute left-0 right-0 z-0"
        :class="hl.priority ? 'bg-orange-500/15' : 'bg-emerald-500/15'"
        :style="{ top: `${hl.top}px`, height: `${hl.height}px` }"
      ></div>
      <div
        v-if="hoverRect"
        class="pointer-events-none absolute left-0 right-0 z-0 bg-white/10"
        :style="{ top: `${hoverRect.top}px`, height: `${hoverRect.height}px` }"
      ></div>
      <div
        v-if="tagJumpRect"
        class="pointer-events-none absolute left-0 right-0 z-0 border-y border-emerald-200/40 bg-emerald-400/25"
        :style="{ top: `${tagJumpRect.top}px`, height: `${tagJumpRect.height}px` }"
      ></div>
      <div
        v-if="calendarJumpRect"
        class="pointer-events-none absolute left-0 right-0 z-0 border-y border-yellow-200/30 bg-yellow-400/20"
        :style="{ top: `${calendarJumpRect.top}px`, height: `${calendarJumpRect.height}px` }"
      ></div>
      <EditorGutter
        class="relative z-10"
        :text="content"
        :parsed="parsed"
        :scroll-top="scrollTop"
        :viewport-height="viewportHeight"
        :line-height="lineHeight"
        :padding-top="paddingTop"
        :padding-bottom="paddingBottom"
        :image-thumbs="imageThumbs"
        :active-line="cursorLine"
        @toggle-checklist="toggleChecklistLine"
        @line-link="handleGutterLink"
        @line-tags="handleGutterTags"
        @line-images="handleGutterImages"
        @line-dates="handleGutterDates"
        @request-image="requestImageThumb"
        :wrap-cols="wrapCols"
        @hover-rect="handleHoverRect"
      />
      <div
        class="relative z-10 flex-1 h-full"
        :style="noteColorDraft ? { boxShadow: `inset 4px 0 0 ${noteColorDraft}` } : undefined"
      >
        <NoteEditorTextarea
          ref="editorRef"
          v-model="content"
          class="flex-1"
          placeholder="Start typing your note..."
          textarea-class="border-0 rounded-none bg-transparent shadow-none focus:border-transparent focus:ring-0"
          :readonly="isReadOnly"
          @update:modelValue="persistContent"
          @selection-change="handleSelectionChange"
          @scroll="handleScroll"
          @cursor-line="handleCursorLine"
          @wrap-cols="handleWrapCols"
          @paste="handlePaste"
        />
        <div
          class="caret-line"
          :style="{
            top: `${caretTop + lineHeight - 1}px`,
            opacity: 0.5,
          }"
        ></div>
      </div>
    </div>

    <div
      v-if="datePopover"
      ref="datePopoverRef"
      class="fixed bottom-4 left-4 right-4 z-50 border border-white/15 bg-slate-900/95 p-4 text-white shadow-2xl sm:left-auto sm:right-6 sm:w-[420px]"
    >
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold">Calendar: {{ datePopover.date }}</p>
        <button type="button" class="border border-white/15 px-3 py-1 text-xs" @click="datePopover = null">✕</button>
      </div>
      <div v-if="datePopoverLoading" class="mt-3 text-xs text-slate-300">Loading…</div>
      <div v-else class="mt-3 max-h-[50vh] overflow-auto">
        <button
          v-for="entry in datePopover.entries"
          :key="entry.noteId + entry.tabId + entry.occurrenceIndex + entry.date"
          type="button"
          class="mb-2 w-full border border-white/10 bg-white/5 p-3 text-left text-sm hover:border-white/20"
          @click="openCalendarEntryFromPopover(entry)"
        >
          <div class="flex items-center gap-2">
            <span
              class="h-3 w-1 shrink-0"
              :style="entry.noteColor ? { backgroundColor: entry.noteColor } : { backgroundColor: 'rgba(255,255,255,0.25)' }"
            ></span>
            <span class="min-w-0 truncate font-semibold">{{ entry.noteTitle }}</span>
          </div>
          <p class="mt-1 truncate text-xs text-slate-300">{{ entryLabel(entry) }}</p>
        </button>
        <div v-if="!datePopover.entries.length" class="border border-white/10 bg-white/5 p-3 text-xs text-slate-300">
          No entries for this day.
        </div>
      </div>
    </div>

    <ImageModal
      :open="!!imageModalSrc"
      :src="imageModalSrc || undefined"
      :can-prev="canPrevImage"
      :can-next="canNextImage"
      @close="closeImageModal"
      @prev="showPrevImage"
      @next="showNextImage"
    />
  </section>

  <div v-else class="text-sm text-slate-300">Loading editor…</div>
</template>

<style scoped>
.tab-strip button {
  user-select: none;
}
</style>
