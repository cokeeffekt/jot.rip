import {
  listNotes,
  listAllTabs,
  listImages,
  putNoteRaw,
  putTabRaw,
  putImageRaw,
  getNote,
  getTab,
  getImage,
  type Note,
  type Tab,
  type Image,
  setMeta,
  getMeta,
  listTombstones,
  setTombstone,
  deleteNote,
  deleteTab,
  deleteImage,
} from '../db'

type SyncConfig = {
  baseUrl: string
  username: string
  password: string
  passphrase: string
}

type RemoteEnvelope =
  | { kind: 'note'; note: Note }
  | { kind: 'tab'; tab: Tab }
  | { kind: 'image'; image: Image; base64?: string }
  | { kind: 'tombstone'; target: 'note' | 'tab' | 'image'; id: string; updatedAt: string }

const keyForNote = (id: string) => `notes/${id}.json`
const keyForTab = (id: string) => `tabs/${id}.json`
const keyForImage = (id: string) => `images/${id}.json`
const keyForTombstone = (target: 'note' | 'tab' | 'image', id: string) => `deleted/${target}s/${id}.json`

const headers = (cfg: SyncConfig) => {
  const h: Record<string, string> = {}
  const basic = btoa(`${cfg.username}:${cfg.password}`)
  h['Authorization'] = `Basic ${basic}`
  return h
}

const toBase64 = (buf: ArrayBuffer | ArrayBufferView) => {
  const bytes =
    buf instanceof ArrayBuffer
      ? new Uint8Array(buf)
      : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk)
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

const fromBase64 = (b64: string) => {
  const binary = atob(b64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const deriveKey = async (passphrase: string, salt: Uint8Array) => {
  const enc = new TextEncoder().encode(passphrase)
  const baseKey = await crypto.subtle.importKey('raw', enc, 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

const encryptPayload = async (plain: string, passphrase: string) => {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain))
  return {
    version: '1',
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(cipher),
  }
}

const decryptPayload = async (payload: { salt: string; iv: string; ciphertext: string }, passphrase: string) => {
  const salt = fromBase64(payload.salt)
  const iv = fromBase64(payload.iv)
  const data = fromBase64(payload.ciphertext)
  const key = await deriveKey(passphrase, salt)
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  return new TextDecoder().decode(plainBuf)
}

const fetchJson = async (url: string, cfg: SyncConfig) => {
  const res = await fetch(url, { headers: { ...headers(cfg) } })
  if (!res.ok) throw new Error(`Request failed ${res.status}`)
  return res.json()
}

const putBlob = async (url: string, body: string | ArrayBuffer, cfg: SyncConfig) => {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', ...headers(cfg) },
    body,
  })
  if (!res.ok) throw new Error(`PUT failed ${res.status}`)
  return res.json()
}

const getBlob = async (url: string, cfg: SyncConfig) => {
  const res = await fetch(url, { headers: { ...headers(cfg) } })
  if (!res.ok) throw new Error(`GET failed ${res.status}`)
  const buf = await res.arrayBuffer()
  return new TextDecoder().decode(buf)
}

const imageToBase64 = (img: Image) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = reject
    reader.readAsDataURL(img.blob)
  })

const base64ToBlob = (b64: string, mime: string) => {
  const binary = atob(b64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

const applyRemote = async (envelope: RemoteEnvelope) => {
  if (envelope.kind === 'note') {
    const existing = await getNote(envelope.note.id)
    if (existing && existing.updatedAt && envelope.note.updatedAt) {
      if (new Date(envelope.note.updatedAt).getTime() <= new Date(existing.updatedAt).getTime()) {
        console.debug('[sync] skip note (stale)', envelope.note.id)
        return
      }
    }
    await putNoteRaw(envelope.note)
    console.debug('[sync] applied note', envelope.note.id, envelope.note.title)
    return
  }
  if (envelope.kind === 'tab') {
    const existing = await getTab(envelope.tab.id)
    if (existing && existing.updatedAt && envelope.tab.updatedAt) {
      if (new Date(envelope.tab.updatedAt).getTime() <= new Date(existing.updatedAt).getTime()) {
        console.debug('[sync] skip tab (stale)', envelope.tab.id)
        return
      }
    }
    await putTabRaw(envelope.tab)
    console.debug('[sync] applied tab', envelope.tab.id)
    return
  }
  if (envelope.kind === 'image') {
    const existing = await getImage(envelope.image.id)
    if (existing?.createdAt && envelope.image.createdAt) {
      if (new Date(envelope.image.createdAt).getTime() <= new Date(existing.createdAt).getTime()) {
        console.debug('[sync] skip image (stale)', envelope.image.id)
        return
      }
    }
    const blob = envelope.base64 ? base64ToBlob(envelope.base64, envelope.image.mime) : envelope.image.blob
    await putImageRaw({ ...envelope.image, blob })
    console.debug('[sync] applied image', envelope.image.id)
    return
  }
  if (envelope.kind === 'tombstone') {
    console.debug('[sync] apply tombstone', envelope.target, envelope.id)
    await setTombstone(envelope.target, envelope.id, envelope.updatedAt)
    if (envelope.target === 'note') {
      await deleteNote(envelope.id)
    } else if (envelope.target === 'tab') {
      await deleteTab(envelope.id)
    } else if (envelope.target === 'image') {
      await deleteImage(envelope.id)
    }
  }
}

const pullChanges = async (cfg: SyncConfig, since?: string | null) => {
  const sinceParam = since ? `?since=${encodeURIComponent(since)}` : ''
  const { changes, now } = await fetchJson(`${cfg.baseUrl}/changes${sinceParam}`, cfg)
  console.debug('[sync] pull', { since, count: changes?.length ?? 0 })
  let latest = now ? Date.parse(now) : 0
  for (const change of changes || []) {
    const key: string | undefined = change?.key
    if (!key) continue
    if (change.updatedAt) {
      const t = Date.parse(change.updatedAt)
      if (t > latest) latest = t
    }
    try {
      const raw = await getBlob(`${cfg.baseUrl}/blob/${encodeURIComponent(key)}`, cfg)
      const payload = JSON.parse(raw)
      const plain = await decryptPayload(payload, cfg.passphrase)
      const env: RemoteEnvelope = JSON.parse(plain)
      console.debug('[sync] apply', { key, kind: env.kind, updatedAt: change.updatedAt })
      await applyRemote(env)
    } catch (err) {
      console.error('Failed to apply change', key, err)
    }
  }
  return latest || null
}

const pushAll = async (cfg: SyncConfig, since?: string | null) => {
  const sinceTs = since ? Date.parse(since) : 0
  const [notes, tabs, images, tombstones] = await Promise.all([listNotes(), listAllTabs(), listImages(), listTombstones(since)])
  for (const note of notes) {
    if (sinceTs && Date.parse(note.updatedAt) <= sinceTs) continue
    const env: RemoteEnvelope = { kind: 'note', note }
    const encrypted = await encryptPayload(JSON.stringify(env), cfg.passphrase)
    await putBlob(`${cfg.baseUrl}/blob/${encodeURIComponent(keyForNote(note.id))}`, JSON.stringify(encrypted), cfg)
  }
  for (const tab of tabs) {
    if (sinceTs && Date.parse(tab.updatedAt) <= sinceTs) continue
    const env: RemoteEnvelope = { kind: 'tab', tab }
    const encrypted = await encryptPayload(JSON.stringify(env), cfg.passphrase)
    await putBlob(`${cfg.baseUrl}/blob/${encodeURIComponent(keyForTab(tab.id))}`, JSON.stringify(encrypted), cfg)
  }
  for (const img of images) {
    if (sinceTs && Date.parse(img.createdAt) <= sinceTs && Date.parse(img.createdAt) <= sinceTs) continue
    const env: RemoteEnvelope = { kind: 'image', image: { ...img, blob: undefined as any }, base64: await imageToBase64(img) }
    const encrypted = await encryptPayload(JSON.stringify(env), cfg.passphrase)
    await putBlob(`${cfg.baseUrl}/blob/${encodeURIComponent(keyForImage(img.id))}`, JSON.stringify(encrypted), cfg)
  }
  for (const t of tombstones) {
    const val = t.value as any
    const env: RemoteEnvelope = {
      kind: 'tombstone',
      target: val.kind,
      id: val.id,
      updatedAt: val.updatedAt,
    }
    const encrypted = await encryptPayload(JSON.stringify(env), cfg.passphrase)
    await putBlob(`${cfg.baseUrl}/blob/${encodeURIComponent(keyForTombstone(val.kind, val.id))}`, JSON.stringify(encrypted), cfg)
  }
}

export const syncNow = async (cfg: SyncConfig) => {
  const base = cfg.baseUrl?.trim().replace(/\/+$/, '')
  if (!base) throw new Error('Missing base URL')

  const last = await getMeta<string>('sync:last')

  console.debug('[sync] starting', { last })
  const latestRemote = await pullChanges({ ...cfg, baseUrl: base }, last)
  console.debug('[sync] pull done', { latestRemote: latestRemote ? new Date(latestRemote).toISOString() : null })
  await pushAll({ ...cfg, baseUrl: base }, last)

  const nowTs = latestRemote || Date.now()
  const nowIso = new Date(nowTs).toISOString()
  await setMeta('sync:last', nowIso)
  console.debug('[sync] finished', { next: nowIso })
  return nowIso
}
