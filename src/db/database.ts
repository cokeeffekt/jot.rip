import Dexie, { type Table } from 'dexie'
import type { Collection, Image, Meta, Note, Tab } from './types'

export const DB_NAME = 'jotrip'
export const DB_VERSION = 1

class JotripDatabase extends Dexie {
  notes!: Table<Note, string>
  tabs!: Table<Tab, string>
  collections!: Table<Collection, string>
  images!: Table<Image, string>
  meta!: Table<Meta, string>

  constructor() {
    super(DB_NAME)

    this.version(DB_VERSION).stores({
      notes: 'id, updatedAt, primaryDate',
      tabs: 'id, noteId, updatedAt',
      collections: 'id',
      images: 'id, noteId, tabId',
      meta: 'key',
    })
  }
}

let dbInstance: JotripDatabase | null = null

export function getDb(): JotripDatabase {
  if (!dbInstance) {
    dbInstance = new JotripDatabase()
  }
  return dbInstance
}

export async function initDatabase() {
  const db = getDb()
  if (!db.isOpen()) {
    await db.open()
  }
  return db
}

export type Database = JotripDatabase
