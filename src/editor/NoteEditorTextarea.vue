<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { insertChecklist, toggleHeader } from './format'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  textareaClass?: string
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'selection-change', payload: { start: number; end: number }): void
  (e: 'tag-trigger', payload: { query: string; lineIndex: number; charIndex: number }): void
  (e: 'date-trigger', payload: { query: string; lineIndex: number; charIndex: number }): void
  (e: 'scroll', payload: { scrollTop: number; clientHeight: number; lineHeight: number; paddingTop: number; paddingBottom: number }): void
  (e: 'paste', payload: ClipboardEvent): void
  (e: 'cursor-line', payload: { lineIndex: number }): void
  (e: 'wrap-cols', payload: { cols: number }): void
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const pendingSelection = ref<number | null>(null)
let resizeObserver: ResizeObserver | null = null
let measurementTextarea: HTMLTextAreaElement | null = null
let lastWrapCols = 0
let isNormalizingDate = false
const localValue = computed({
  get: () => props.modelValue,
  set: (val: string) => emit('update:modelValue', val),
})

const reportSelection = () => {
  const el = textareaRef.value
  if (!el) return
  emit('selection-change', { start: el.selectionStart, end: el.selectionEnd })
  const lineIndex = el.value.slice(0, el.selectionStart).split('\n').length - 1
  emit('cursor-line', { lineIndex })
}

const emitTriggers = () => {
  const el = textareaRef.value
  if (!el) return
  const cursor = el.selectionStart
  const lineIndex = el.value.slice(0, cursor).split('\n').length - 1
  const lineStart = el.value.lastIndexOf('\n', cursor - 1) + 1
  const prefix = el.value.slice(lineStart, cursor)

  const tagMatch = prefix.match(/(?:^|[\s])#([A-Za-z0-9_-]*)$/)
  if (tagMatch) {
    emit('tag-trigger', { query: tagMatch[1] ?? '', lineIndex, charIndex: cursor - lineStart })
  }

  const dateMatch = prefix.match(/(?:^|[\s])@([^\s]*)$/)
  if (dateMatch) {
    emit('date-trigger', { query: dateMatch[1] ?? '', lineIndex, charIndex: cursor - lineStart })
  }
}

const normalizeDateToken = (trailingChar = ''): boolean => {
  const el = textareaRef.value
  if (!el) return false

  const cursor = el.selectionStart
  const lineStart = el.value.lastIndexOf('\n', cursor - 1) + 1
  const prefix = el.value.slice(lineStart, cursor)
  const tokenMatch = prefix.match(/@([^\s]*)$/)
  if (!tokenMatch) return false

  const raw = tokenMatch[1] ?? ''
  const normalized = normalizeDate(raw)
  if (!normalized) return false

  const start = cursor - raw.length - 1
  const before = el.value.slice(0, start)
  const after = el.value.slice(el.selectionEnd)
  const nextValue = `${before}@${normalized}${trailingChar}${after}`
  const nextCursor = start + normalized.length + 1 + trailingChar.length
  pendingSelection.value = nextCursor
  emit('update:modelValue', nextValue)
  nextTick(() => setPendingSelection())
  return true
}

const normalizeDateTokenAfterDelimiter = (): boolean => {
  const el = textareaRef.value
  if (!el) return false
  if (isNormalizingDate) return false

  const cursor = el.selectionStart
  if (!cursor) return false
  const delimiter = el.value[cursor - 1]
  if (delimiter !== ' ' && delimiter !== '\n') return false

  const virtualCursor = cursor - 1
  const lineStart = el.value.lastIndexOf('\n', virtualCursor - 1) + 1
  const prefix = el.value.slice(lineStart, virtualCursor)
  const tokenMatch = prefix.match(/@([^\s]*)$/)
  if (!tokenMatch) return false

  const raw = tokenMatch[1] ?? ''
  const normalized = normalizeDate(raw)
  if (!normalized) return false

  const start = virtualCursor - raw.length - 1
  const before = el.value.slice(0, start)
  const after = el.value.slice(cursor)
  const nextValue = `${before}@${normalized}${delimiter}${after}`
  const nextCursor = start + 1 + normalized.length + 1

  isNormalizingDate = true
  pendingSelection.value = nextCursor
  emit('update:modelValue', nextValue)
  nextTick(() => {
    setPendingSelection()
    isNormalizingDate = false
  })
  return true
}

const insertLiteral = (text: string) => {
  const el = textareaRef.value
  if (!el) return
  const start = el.selectionStart
  const value = el.value
  const nextValue = value.slice(0, start) + text + value.slice(start + text.length)
  const nextCursor = start + text.length
  pendingSelection.value = nextCursor
  emit('update:modelValue', nextValue)
  nextTick(() => setPendingSelection())
}

const setValueAndCursor = (nextValue: string, nextCursor: number) => {
  pendingSelection.value = nextCursor
  emit('update:modelValue', nextValue)
  nextTick(() => setPendingSelection())
}

const handleChecklistEnter = (): boolean => {
  const el = textareaRef.value
  if (!el) return false
  const start = el.selectionStart
  const end = el.selectionEnd
  if (start !== end) return false

  const value = el.value
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const newlineIndex = value.indexOf('\n', start)
  const lineEnd = newlineIndex === -1 ? value.length : newlineIndex
  const line = value.slice(lineStart, lineEnd)

  if (!/^\s*-\s\[( |x|X)\]/.test(line)) return false

  const emptyUnchecked = /^\s*-\s\[\s\]\s*$/.test(line)
  if (emptyUnchecked) {
    const before = value.slice(0, lineStart)
    const after = value.slice(lineEnd)
    setValueAndCursor(before + after, lineStart)
    return true
  }

  const indent = line.match(/^(\s*)-/)?.[1] ?? ''
  const insert = `\n${indent}- [ ] `
  setValueAndCursor(value.slice(0, start) + insert + value.slice(end), start + insert.length)
  return true
}

const formatLocalYmd = (date: Date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const daysInMonth = (year: number, monthIndex: number) => new Date(year, monthIndex + 1, 0).getDate()

const addDays = (date: Date, days: number) => {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

const addWeeks = (date: Date, weeks: number) => addDays(date, weeks * 7)

const addMonthsClamped = (date: Date, months: number) => {
  const base = new Date(date)
  const m = base.getMonth()
  const day = base.getDate()

  const targetMonthIndex = m + months
  const target = new Date(base)
  target.setDate(1)
  target.setMonth(targetMonthIndex)

  const maxDay = daysInMonth(target.getFullYear(), target.getMonth())
  target.setDate(Math.min(day, maxDay))
  return target
}

const addYearsClamped = (date: Date, years: number) => addMonthsClamped(date, years * 12)

const startOfWeekMonday = (date: Date) => {
  const d = new Date(date)
  const dow = d.getDay() // 0=Sun ... 6=Sat
  const daysSinceMonday = (dow + 6) % 7
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysSinceMonday)
  return d
}

const endOfWeekSunday = (date: Date) => {
  const start = startOfWeekMonday(date)
  const end = addDays(start, 6)
  end.setHours(0, 0, 0, 0)
  return end
}

const endOfMonth = (date: Date) => {
  const d = new Date(date)
  const y = d.getFullYear()
  const m = d.getMonth()
  const last = new Date(y, m + 1, 0)
  last.setHours(0, 0, 0, 0)
  return last
}

const endOfYear = (date: Date) => {
  const d = new Date(date)
  const last = new Date(d.getFullYear(), 11, 31)
  last.setHours(0, 0, 0, 0)
  return last
}

const normalizeDate = (input: string): string | null => {
  if (!input) return null
  const keyword = input.toLowerCase()
  const now = new Date()
  if (keyword === 'today') return formatLocalYmd(now)
  if (keyword === 'tomorrow') return formatLocalYmd(addDays(now, 1))
  if (keyword === 'yesterday') return formatLocalYmd(addDays(now, -1))
  if (keyword === 'inaweek') return formatLocalYmd(addWeeks(now, 1))
  if (keyword === 'nextweek') return formatLocalYmd(startOfWeekMonday(addWeeks(now, 1)))
  if (keyword === 'thisweek') return formatLocalYmd(startOfWeekMonday(now))
  if (keyword === 'nextmonth') return formatLocalYmd(addMonthsClamped(now, 1))
  if (keyword === 'nextyear') return formatLocalYmd(addYearsClamped(now, 1))
  if (keyword === 'eow') return formatLocalYmd(endOfWeekSunday(now))
  if (keyword === 'eom') return formatLocalYmd(endOfMonth(now))
  if (keyword === 'eoy') return formatLocalYmd(endOfYear(now))
  if (keyword === 'weekday') {
    const dow = now.getDay()
    if (dow >= 1 && dow <= 5) return formatLocalYmd(now)
    return formatLocalYmd(startOfWeekMonday(addWeeks(now, 1)))
  }
  if (keyword === 'nextweekday') {
    const dow = now.getDay()
    if (dow >= 1 && dow <= 4) return formatLocalYmd(addDays(now, 1))
    if (dow === 5) return formatLocalYmd(startOfWeekMonday(addWeeks(now, 1)))
    return formatLocalYmd(startOfWeekMonday(addWeeks(now, 1)))
  }

  const relMatch = keyword.match(/^in(\d+)(day|days|week|weeks|month|months|year|years)$/)
  if (relMatch) {
    const n = Number(relMatch[1])
    if (!Number.isFinite(n) || n < 0) return null
    const unit = relMatch[2]
    if (unit === 'day' || unit === 'days') return formatLocalYmd(addDays(now, n))
    if (unit === 'week' || unit === 'weeks') return formatLocalYmd(addWeeks(now, n))
    if (unit === 'month' || unit === 'months') return formatLocalYmd(addMonthsClamped(now, n))
    if (unit === 'year' || unit === 'years') return formatLocalYmd(addYearsClamped(now, n))
  }

  const weekdays: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  }
  const weekdayAliases: Record<string, string> = {
    sun: 'sunday',
    mon: 'monday',
    tue: 'tuesday',
    tues: 'tuesday',
    wed: 'wednesday',
    thu: 'thursday',
    thur: 'thursday',
    thurs: 'thursday',
    fri: 'friday',
    sat: 'saturday',
  }
  const resolvedWeekday = weekdayAliases[keyword] ?? keyword
  if (resolvedWeekday in weekdays) {
    const targetDow = weekdays[resolvedWeekday]!
    const d = new Date()
    const currentDow = d.getDay()
    const diff = (targetDow - currentDow + 7) % 7
    d.setDate(d.getDate() + diff)
    return formatLocalYmd(d)
  }

  const nextWeekdayMatch = keyword.match(/^next([a-z]+)$/)
  if (nextWeekdayMatch) {
    const maybe = nextWeekdayMatch[1] ?? ''
    const resolved = weekdayAliases[maybe] ?? maybe
    if (resolved in weekdays) {
      const targetDow = weekdays[resolved]!
      const d = new Date()
      const currentDow = d.getDay()
      const diff = ((targetDow - currentDow + 7) % 7) || 7
      d.setDate(d.getDate() + diff)
      return formatLocalYmd(d)
    }
  }

  const dashed = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (dashed) {
    const y = dashed[1]
    const m = dashed[2]
    const d = dashed[3]
    if (!y || !m || !d) return null
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  const slashed = input.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (slashed) {
    const y = slashed[1]
    const m = slashed[2]
    const d = slashed[3]
    if (!y || !m || !d) return null
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  return null
}

const handleInput = () => {
  // Mobile browsers often won't fire useful keydown events for Space/Enter.
  // If the user just inserted a delimiter, normalize by looking one char back.
  normalizeDateTokenAfterDelimiter()
  emitTriggers()
  reportSelection()
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === ' ') {
    const normalized = normalizeDateToken(' ')
    if (normalized) {
      event.preventDefault()
    }
  }
  if (event.key === 'Enter') {
    const normalized = normalizeDateToken(' ')
    if (normalized) {
      event.preventDefault()
      insertLiteral('\n')
      return
    }
    const checklistHandled = handleChecklistEnter()
    if (checklistHandled) {
      event.preventDefault()
    }
  }
}

const handleKeyup = () => {
  emitTriggers()
  reportSelection()
}

const handleScroll = () => {
  const el = textareaRef.value
  if (!el) return
  const styles = getComputedStyle(el)
  const lh = parseFloat(styles.lineHeight)
  const paddingTop = parseFloat(styles.paddingTop)
  const paddingBottom = parseFloat(styles.paddingBottom)
  emit('scroll', {
    scrollTop: el.scrollTop,
    clientHeight: el.clientHeight,
    lineHeight: lh,
    paddingTop,
    paddingBottom,
  })
}

const ensureMeasurementTextarea = (source: HTMLTextAreaElement) => {
  if (measurementTextarea) return measurementTextarea
  const el = document.createElement('textarea')
  el.setAttribute('aria-hidden', 'true')
  el.tabIndex = -1
  el.style.position = 'absolute'
  el.style.left = '-10000px'
  el.style.top = '0'
  el.style.height = '0'
  el.style.overflow = 'hidden'
  el.style.whiteSpace = 'pre-wrap'
  el.style.resize = 'none'
  document.body.appendChild(el)
  measurementTextarea = el
  syncMeasurementStyles(source)
  return el
}

const syncMeasurementStyles = (source: HTMLTextAreaElement) => {
  if (!measurementTextarea) return
  const styles = getComputedStyle(source)
  measurementTextarea.style.boxSizing = styles.boxSizing
  measurementTextarea.style.fontFamily = styles.fontFamily
  measurementTextarea.style.fontSize = styles.fontSize
  measurementTextarea.style.fontWeight = styles.fontWeight
  measurementTextarea.style.letterSpacing = styles.letterSpacing
  measurementTextarea.style.lineHeight = styles.lineHeight
  measurementTextarea.style.padding = styles.padding
  measurementTextarea.style.border = styles.border
  measurementTextarea.style.width = `${source.clientWidth}px`
}

const computeWrapCols = () => {
  const source = textareaRef.value
  if (!source) return
  const measurer = ensureMeasurementTextarea(source)
  syncMeasurementStyles(source)

  measurer.value = 'M'
  const base = measurer.scrollHeight
  if (!base) return

  const withinOneLine = (height: number) => height <= base + 0.5

  let lo = 1
  let hi = 5000
  let best = 1
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    measurer.value = 'M'.repeat(mid)
    const h = measurer.scrollHeight
    if (withinOneLine(h)) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  const cols = Math.max(1, best)
  if (cols !== lastWrapCols) {
    lastWrapCols = cols
    emit('wrap-cols', { cols })
  }
}

const applyFormatting = (type: 'header' | 'checklist') => {
  const el = textareaRef.value
  if (!el) return
  if (props.readonly) return
  const start = el.selectionStart
  const value = el.value

  let result: ReturnType<typeof toggleHeader> | ReturnType<typeof insertChecklist>

  if (type === 'header') result = toggleHeader(value, start)
  else result = insertChecklist(value, start)

  emit('update:modelValue', result.text)
  requestAnimationFrame(() => {
    el.selectionStart = result.selectionStart
    el.selectionEnd = result.selectionEnd
    reportSelection()
  })
}

defineExpose({
  focus: () => textareaRef.value?.focus(),
  applyFormatting,
})

onMounted(() => {
  reportSelection()
  handleScroll()
  computeWrapCols()
  const el = textareaRef.value
  if (el && 'ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(() => computeWrapCols())
    resizeObserver.observe(el)
  } else {
    window.addEventListener('resize', computeWrapCols)
  }
})

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  window.removeEventListener('resize', computeWrapCols)
  if (measurementTextarea && measurementTextarea.parentNode) {
    measurementTextarea.parentNode.removeChild(measurementTextarea)
  }
  measurementTextarea = null
})

watch(
  () => props.modelValue,
  () => {
    requestAnimationFrame(() => {
      setPendingSelection()
      reportSelection()
    })
  }
)

const setPendingSelection = () => {
  const el = textareaRef.value
  if (!el) return
  if (pendingSelection.value !== null) {
    const pos = pendingSelection.value
    el.selectionStart = pos
    el.selectionEnd = pos
    pendingSelection.value = null
  }
}
</script>

<template>
  <textarea
    ref="textareaRef"
    v-model="localValue"
    :class="['editor-textarea', textareaClass]"
    :placeholder="placeholder"
    :readonly="!!readonly"
    @input="handleInput"
    @keyup="handleKeyup"
    @select="reportSelection"
    @mouseup="reportSelection"
    @keydown="handleKeydown"
    @scroll="handleScroll"
    @paste="emit('paste', $event)"
  ></textarea>
</template>
