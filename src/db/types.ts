export interface Note {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  tabOrder: string[]
  collectionIds: string[]
  primaryDate?: string | null
  archivedAt?: string | null
  color?: string | null
  pinnedAt?: string | null
}

export interface Tab {
  id: string
  noteId: string
  name: string
  content: string
  updatedAt: string
}

export interface Collection {
  id: string
  name: string
  createdAt: string
}

export interface Image {
  id: string
  noteId: string
  tabId: string
  mime: string
  blob: Blob
  width?: number
  height?: number
  createdAt: string
  thumbnailDataUrl?: string
}

export interface Meta {
  key: string
  value: unknown
}
