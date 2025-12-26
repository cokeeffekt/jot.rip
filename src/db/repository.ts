import type { Collection, Image, Meta, Note, Tab } from './types'
import { getDb } from './database'

const db = getDb()

const now = () => new Date().toISOString()
export const makeId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
const makeShortId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14)

const generateNoteId = async () => {
  for (let i = 0; i < 5; i++) {
    const candidate = makeShortId()
    const existing = await db.notes.get(candidate)
    if (!existing) return candidate
  }
  // Fallback to full UUID if we somehow collide repeatedly
  return makeId()
}

const generateTabId = async () => {
  for (let i = 0; i < 5; i++) {
    const candidate = makeShortId()
    const existing = await db.tabs.get(candidate)
    if (!existing) return candidate
  }
  return makeId()
}

type CreateNoteInput = {
  title: string
  collectionIds?: string[]
  tabOrder?: string[]
  primaryDate?: string | null
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
  const id = await generateNoteId()
  const note: Note = {
    id,
    title: input.title,
    collectionIds: input.collectionIds ?? [],
    tabOrder: input.tabOrder ?? [],
    primaryDate: input.primaryDate,
    createdAt: now(),
    updatedAt: now(),
  }
  await db.notes.add(note)
  return note
}

export function getNote(id: string) {
  return db.notes.get(id)
}

export async function updateNote(id: string, updates: Partial<Omit<Note, 'id' | 'createdAt'>>): Promise<Note | undefined> {
  const existing = await db.notes.get(id)
  if (!existing) return undefined

  const updated: Note = {
    ...existing,
    ...updates,
    updatedAt: now(),
  }
  await db.notes.put(updated)
  return updated
}

export async function deleteNote(id: string) {
  await setTombstone('note', id)
  await db.transaction('rw', db.notes, db.tabs, db.images, async () => {
    await db.tabs.where('noteId').equals(id).delete()
    await db.images.where('noteId').equals(id).delete()
    await db.notes.delete(id)
  })
}

export function listNotes() {
  return db.notes.orderBy('updatedAt').reverse().toArray()
}

export async function listActiveNotes() {
  const notes = await listNotes()
  return notes.filter((n) => !n.archivedAt)
}

export async function listArchivedNotes() {
  const notes = await listNotes()
  return notes.filter((n) => Boolean(n.archivedAt))
}

// Tabs
type CreateTabInput = { noteId: string; name: string; content: string }

export async function createTab(input: CreateTabInput): Promise<Tab> {
  const id = await generateTabId()
  const tab: Tab = {
    id,
    noteId: input.noteId,
    name: input.name,
    content: input.content,
    updatedAt: now(),
  }
  await db.tabs.add(tab)
  return tab
}

export function getTab(id: string) {
  return db.tabs.get(id)
}

export async function updateTab(id: string, updates: Partial<Omit<Tab, 'id' | 'noteId'>>): Promise<Tab | undefined> {
  const existing = await db.tabs.get(id)
  if (!existing) return undefined

  const updated: Tab = {
    ...existing,
    ...updates,
    updatedAt: now(),
  }
  await db.tabs.put(updated)
  return updated
}

export async function deleteTab(id: string) {
  const tab = await db.tabs.get(id)
  if (!tab) return

  await setTombstone('tab', id)
  await db.transaction('rw', db.tabs, db.images, db.notes, async () => {
    await db.images.where('tabId').equals(tab.id).delete()
    await db.tabs.delete(tab.id)

    const note = await db.notes.get(tab.noteId)
    if (note) {
      const tabOrder = note.tabOrder.filter((t) => t !== tab.id)
      await db.notes.put({ ...note, tabOrder, updatedAt: now() })
    }
  })
}

export function listTabs(noteId: string) {
  return db.tabs.where('noteId').equals(noteId).sortBy('updatedAt')
}

export function listAllTabs() {
  return db.tabs.toArray()
}

// Collections
type CreateCollectionInput = { name: string }

export async function createCollection(input: CreateCollectionInput): Promise<Collection> {
  const collection: Collection = {
    id: makeId(),
    name: input.name,
    createdAt: now(),
  }
  await db.collections.add(collection)
  return collection
}

export async function updateCollection(
  id: string,
  updates: Partial<Omit<Collection, 'id' | 'createdAt'>>
): Promise<Collection | undefined> {
  const existing = await db.collections.get(id)
  if (!existing) return undefined

  const updated: Collection = { ...existing, ...updates }
  await db.collections.put(updated)
  return updated
}

export function deleteCollection(id: string) {
  return db.collections.delete(id)
}

export function listCollections() {
  return db.collections.toArray()
}

// Images
type StoreImageInput = {
  id?: string
  noteId: string
  tabId: string
  mime: string
  blob: Blob
  width?: number
  height?: number
  thumbnailDataUrl?: string
}

export async function storeImage(input: StoreImageInput): Promise<Image> {
  const image: Image = {
    id: input.id ?? makeId(),
    noteId: input.noteId,
    tabId: input.tabId,
    mime: input.mime,
    blob: input.blob,
    width: input.width,
    height: input.height,
    createdAt: now(),
    thumbnailDataUrl: input.thumbnailDataUrl,
  }
  await db.images.add(image)
  return image
}

export function getImage(id: string) {
  return db.images.get(id)
}

export function deleteImage(id: string) {
  return setTombstone('image', id).then(() => db.images.delete(id))
}

export function listImages(filter: { noteId?: string; tabId?: string } = {}) {
  if (filter.tabId) return db.images.where('tabId').equals(filter.tabId).toArray()
  if (filter.noteId) return db.images.where('noteId').equals(filter.noteId).toArray()
  return db.images.toArray()
}

export function listMeta() {
  return db.meta.toArray()
}

export async function clearAllData() {
  await db.transaction('rw', [db.notes, db.tabs, db.images, db.collections, db.meta], async () => {
    await Promise.all([db.notes.clear(), db.tabs.clear(), db.images.clear(), db.collections.clear(), db.meta.clear()])
  })
}

// Tombstones
type TombstoneKind = 'note' | 'tab' | 'image'

export async function setTombstone(kind: TombstoneKind, id: string, updatedAt?: string) {
  const ts = updatedAt ?? new Date().toISOString()
  const key = `tombstone:${kind}:${id}`
  const entry: Meta = { key, value: { kind, id, updatedAt: ts } }
  await db.meta.put(entry)
  return entry
}

export async function listTombstones(since?: string | null) {
  const entries = await db.meta.where('key').startsWith('tombstone:').toArray()
  if (!since) return entries
  const sinceTs = Date.parse(since)
  return entries.filter((e) => {
    const ts = (e.value as any)?.updatedAt
    return ts && Date.parse(ts) > sinceTs
  })
}

// Raw upserts for sync (bypass updatedAt mutations)
export function putNoteRaw(note: Note) {
  return db.notes.put(note)
}

export function putTabRaw(tab: Tab) {
  return db.tabs.put(tab)
}

export function putImageRaw(image: Image) {
  return db.images.put(image)
}

// Meta
export async function setMeta(key: string, value: Meta['value']) {
  const entry: Meta = { key, value }
  await db.meta.put(entry)
  return entry
}

export async function getMeta<T = Meta['value']>(key: string): Promise<T | undefined> {
  const entry = await db.meta.get(key)
  return entry?.value as T | undefined
}
