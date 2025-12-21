import type { Note, Tab } from '../db'

export function normalizeTabOrder(note: Note, tabs: Tab[]) {
  const existingOrder = note.tabOrder || []
  const tabIds = new Set(tabs.map((t) => t.id))
  const seen = new Set<string>()
  const ordered = existingOrder.filter((id) => tabIds.has(id) && !seen.has(id) && !!seen.add(id))
  const missing = tabs.map((t) => t.id).filter((id) => !seen.has(id) && !!seen.add(id))
  return [...ordered, ...missing]
}
