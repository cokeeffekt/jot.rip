import type { Note, Tab } from '../db'
import type { CalendarEntry } from './types'

type CacheValue = { key: string; entries: TokenEntry[] }
const cache = new Map<string, CacheValue>()

type RepeatUnit = 'd' | 'w' | 'm' | 'y'
type SpanUnit = 'd' | 'w' | 'm' | 'y'
type TokenRules = { span?: { n: number; unit: SpanUnit }; repeat?: { n: number; unit: RepeatUnit } }

type TokenEntry = Omit<CalendarEntry, 'date'> & { tokenRules: TokenRules }

const dateRegex = /@(\d{4}-\d{2}-\d{2})(\[[^\]]+\])?/g

const pad = (n: number) => n.toString().padStart(2, '0')
const formatDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseDate = (ymd: string) => {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const y = Number(m[1])
  const month = Number(m[2]) - 1
  const day = Number(m[3])
  const d = new Date(y, month, day)
  if (Number.isNaN(d.getTime())) return null
  return d
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

const addUnit = (date: Date, n: number, unit: RepeatUnit) => {
  if (unit === 'd') return addDays(date, n)
  if (unit === 'w') return addWeeks(date, n)
  if (unit === 'm') return addMonthsClamped(date, n)
  return addYearsClamped(date, n)
}

const parseRules = (rawBracket?: string | null): TokenRules => {
  const rules: TokenRules = {}
  if (!rawBracket) return rules
  const inner = rawBracket.startsWith('[') ? rawBracket.slice(1, -1) : rawBracket
  const parts = inner
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)

  for (const part of parts) {
    const short = part.match(/^(s|r)(\d+)([dwmy])$/i)
    if (short) {
      const kind = short[1]?.toLowerCase()
      const n = Number(short[2])
      const unit = short[3]?.toLowerCase() as RepeatUnit
      if (!Number.isFinite(n) || n <= 0) continue
      if (kind === 's') rules.span = { n, unit }
      if (kind === 'r') rules.repeat = { n, unit }
      continue
    }
    const named = part.match(/^(span|repeat)=(\d+)([dwmy])$/i)
    if (named) {
      const kind = named[1]?.toLowerCase()
      const n = Number(named[2])
      const unit = named[3]?.toLowerCase() as RepeatUnit
      if (!Number.isFinite(n) || n <= 0) continue
      if (kind === 'span') rules.span = { n, unit }
      if (kind === 'repeat') rules.repeat = { n, unit }
    }
  }
  return rules
}

const scanTab = (tab: Tab, note: Note, firstTabName?: string): TokenEntry[] => {
  const entries: TokenEntry[] = []
  const lines = tab.content.replace(/\r\n/g, '\n').split('\n')
  let globalIndex = 0
  let offset = 0

  lines.forEach((line, lineIndex) => {
    dateRegex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = dateRegex.exec(line))) {
      const tokenDate = match[1]
      if (!tokenDate) continue
      const bracket = match[2]
      const tokenRules = parseRules(bracket)

      const tokenEnd = match.index + match[0].length
      const textAfter = line.slice(tokenEnd).trim()
      entries.push({
        tokenDate,
        noteId: note.id,
        noteTitle: note.title ?? 'Untitled',
        firstTabName,
        noteColor: note.color ?? null,
        tabId: tab.id,
        occurrenceIndex: globalIndex,
        textAfterToken: textAfter,
        lineSnippet: textAfter.slice(0, 40),
        lineIndex,
        tokenRules,
      })
      globalIndex++
    }
    offset += line.length + 1
  })

  return entries
}

const occursInRange = (start: Date, end: Date, rangeStart: Date, rangeEnd: Date) => {
  return start.getTime() <= rangeEnd.getTime() && end.getTime() >= rangeStart.getTime()
}

const expandTokenForRange = (token: TokenEntry, rangeStart: Date, rangeEnd: Date): CalendarEntry[] => {
  const anchor = parseDate(token.tokenDate)
  if (!anchor) return []
  anchor.setHours(0, 0, 0, 0)

  const span = token.tokenRules.span ?? { n: 1, unit: 'd' }
  const repeat = token.tokenRules.repeat

  const maxIterations = 800
  const result: CalendarEntry[] = []

  let occurrenceStart = anchor
  for (let i = 0; i < maxIterations; i++) {
    const occurrenceEnd = addDays(addUnit(occurrenceStart, span.n, span.unit as RepeatUnit), -1)
    if (occurrenceStart.getTime() > rangeEnd.getTime()) break

    if (occursInRange(occurrenceStart, occurrenceEnd, rangeStart, rangeEnd)) {
      const dayStart = new Date(Math.max(occurrenceStart.getTime(), rangeStart.getTime()))
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(Math.min(occurrenceEnd.getTime(), rangeEnd.getTime()))
      dayEnd.setHours(0, 0, 0, 0)

      for (let day = new Date(dayStart); day.getTime() <= dayEnd.getTime(); day = addDays(day, 1)) {
        const { tokenRules: _rules, ...rest } = token
        result.push({
          ...rest,
          date: formatDate(day),
          tokenDate: token.tokenDate,
        })
      }
    }

    if (!repeat) break
    occurrenceStart = addUnit(occurrenceStart, repeat.n, repeat.unit)
  }

  return result
}

export const buildCalendarEntriesForRange = (notes: Note[], tabs: Tab[], range: { start: string; end: string }) => {
  const rangeStart = parseDate(range.start)
  const rangeEnd = parseDate(range.end)
  if (!rangeStart || !rangeEnd) return [] as CalendarEntry[]
  rangeStart.setHours(0, 0, 0, 0)
  rangeEnd.setHours(0, 0, 0, 0)

  const noteMap = new Map(notes.map((n) => [n.id, n]))
  const tabById = new Map(tabs.map((t) => [t.id, t]))
  const tabsByNoteId = new Map<string, Tab[]>()
  tabs.forEach((t) => {
    const list = tabsByNoteId.get(t.noteId) ?? []
    list.push(t)
    tabsByNoteId.set(t.noteId, list)
  })

  const firstTabNameByNoteId = new Map<string, string>()
  notes.forEach((note) => {
    const tabOrderFirst = note.tabOrder?.[0]
    const firstTab =
      (tabOrderFirst ? tabById.get(tabOrderFirst) : undefined) ??
      (tabsByNoteId.get(note.id) ?? [])[0]
    if (firstTab?.name) firstTabNameByNoteId.set(note.id, firstTab.name)
  })

  const result: CalendarEntry[] = []

  tabs.forEach((tab) => {
    const note = noteMap.get(tab.noteId)
    if (!note) return

    const firstTabName = firstTabNameByNoteId.get(note.id)
    const key = `${tab.id}:${tab.updatedAt}:${note.updatedAt}:${firstTabName ?? ''}`
    const cached = cache.get(tab.id)
    if (cached && cached.key === key) {
      cached.entries.forEach((token) => result.push(...expandTokenForRange(token, rangeStart, rangeEnd)))
      return
    }

    const entries = scanTab(tab, note, firstTabName)
    cache.set(tab.id, { key, entries })
    entries.forEach((token) => result.push(...expandTokenForRange(token, rangeStart, rangeEnd)))
  })

  return result
}
