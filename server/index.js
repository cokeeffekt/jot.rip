import { createServer } from 'http'
import fs from 'fs'
import { mkdir, readFile, writeFile, appendFile, stat, rm } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = process.env.PORT || 4000
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
const DIST_DIR = process.env.DIST_DIR || path.join(__dirname, '..', 'dist')
const ASSETS_DIR = path.join(__dirname, '..', 'assets')
const BLOB_DIR = path.join(DATA_DIR, 'blobs')
const CHANGE_DIR = path.join(DATA_DIR, 'changes')
const AUTH_DIR = path.join(DATA_DIR, 'auth')

const ensureDirs = async () => {
  await mkdir(BLOB_DIR, { recursive: true })
  await mkdir(CHANGE_DIR, { recursive: true })
  await mkdir(AUTH_DIR, { recursive: true })
}

const send = (res, status, body, headers = {}) => {
  const data = typeof body === 'string' || body instanceof Buffer ? body : JSON.stringify(body)
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
    'Content-Type': typeof body === 'string' || body instanceof Buffer ? 'application/octet-stream' : 'application/json',
    ...headers,
  })
  res.end(data)
}

const mimeFor = (filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript',
      '.mjs': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.txt': 'text/plain; charset=utf-8',
    }[ext] || 'application/octet-stream'
  )
}

const tryServeStatic = async (urlPath, method, res) => {
  if (!DIST_DIR) return false
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1)
  const safeRel = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '')
  const target = path.join(DIST_DIR, safeRel)
  const assetTarget = urlPath.startsWith('/assets/')
    ? path.join(ASSETS_DIR, path.normalize(urlPath.replace(/^\/assets\//, '')))
    : null

  try {
    if (assetTarget) {
      const info = await stat(assetTarget)
      if (info.isFile()) {
        const data = await readFile(assetTarget)
        send(res, 200, data, { 'Content-Type': mimeFor(assetTarget) })
        return true
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const info = await stat(target)
    if (info.isFile()) {
      const data = await readFile(target)
      send(res, 200, data, { 'Content-Type': mimeFor(target) })
      return true
    }
  } catch {
    // ignore
  }

  // SPA fallback to index.html for GET/HEAD when no extension or unknown path
  if (method === 'GET' || method === 'HEAD') {
    const hasExt = path.extname(safeRel)
    if (!hasExt) {
      try {
        const indexPath = path.join(DIST_DIR, 'index.html')
        const data = await readFile(indexPath)
        send(res, 200, data, { 'Content-Type': mimeFor(indexPath) })
        return true
      } catch {
        /* ignore */
      }
    }
  }

  return false
}

const parseKey = (urlPath) => {
  const raw = decodeURIComponent(urlPath.replace(/^\/blob\//, ''))
  const normalized = path.normalize(raw).replace(/^(\.\.(\/|\\|$))+/, '')
  if (!normalized || normalized.includes('..')) return null
  return normalized
}

const deriveKind = (key) => key.split('/')[0] || 'unknown'

const changeLogPath = (userId) => path.join(CHANGE_DIR, `${userId}.log`)
const authFilePath = (userId) => path.join(AUTH_DIR, `${userId}.token`)

const readChangesSince = async (userId, sinceIso) => {
  const logPath = changeLogPath(userId)
  const content = await readFile(logPath, 'utf8').catch(() => '')
  if (!content) return []
  const lines = content.split('\n').filter(Boolean)
  const sinceTs = sinceIso ? Date.parse(sinceIso) : 0
  return lines
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .filter((item) => {
      if (!item?.updatedAt) return false
      return Date.parse(item.updatedAt) > sinceTs
    })
}

const appendChange = async (userId, key, updatedAt) => {
  const logPath = changeLogPath(userId)
  if (!fs.existsSync(logPath)) {
    await writeFile(logPath, '', 'utf8')
  }
  const entry = { key, updatedAt, kind: deriveKind(key) }
  await appendFile(logPath, JSON.stringify(entry) + '\n', 'utf8')
}

const sanitizeUserId = (userId) => {
  if (!userId) return null
  const clean = userId.trim()
  if (!clean) return null
  if (!/^[a-zA-Z0-9_-]+$/.test(clean)) return null
  return clean
}

const hashPassword = (password) => {
  const salt = 'jotrip-static-salt'
  return crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')
}

const ensureUserAuth = async (req) => {
  const header = req.headers['authorization'] || ''
  if (!header.startsWith('Basic ')) return { ok: false, error: 'missing auth' }
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  const [rawUser, rawPass] = decoded.split(':')
  const userId = sanitizeUserId(rawUser || '')
  if (!userId || !rawPass) return { ok: false, error: 'invalid auth' }
  const hashed = hashPassword(rawPass)
  const file = authFilePath(userId)
  if (fs.existsSync(file)) {
    const stored = (await readFile(file, 'utf8')).trim()
    if (stored !== hashed) return { ok: false, error: 'unauthorized' }
  } else {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, hashed, 'utf8')
  }
  return { ok: true, userId }
}

const server = createServer(async (req, res) => {
  try {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      send(res, 204, '')
      return
    }

    const url = new URL(req.url || '', `http://${req.headers.host}`)

    if (url.pathname === '/health') {
      send(res, 200, { ok: true })
      return
    }

    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      !url.pathname.startsWith('/blob/') &&
      url.pathname !== '/changes'
    ) {
      const served = await tryServeStatic(url.pathname, req.method, res)
      if (served) return
    }

    const authResult = await ensureUserAuth(req)
    const userId = authResult.ok ? authResult.userId : null
    if (!authResult.ok) {
      send(res, 401, { error: authResult.error || 'unauthorized' })
      return
    }

    if (url.pathname === '/changes' && req.method === 'GET') {
      const since = url.searchParams.get('since') || ''
      if (!userId) {
        send(res, 400, { error: 'missing user' })
        return
      }
      const changes = await readChangesSince(userId, since)
      send(res, 200, { changes, now: new Date().toISOString(), user: userId })
      return
    }

    if (url.pathname === '/wipe' && req.method === 'POST') {
      if (!userId) {
        send(res, 400, { error: 'missing user' })
        return
      }
      await rm(path.join(BLOB_DIR, userId), { recursive: true, force: true })
      await rm(changeLogPath(userId), { recursive: true, force: true })
      send(res, 200, { ok: true })
      return
    }

    if (url.pathname.startsWith('/blob/')) {
      if (!userId) {
        send(res, 400, { error: 'missing user' })
        return
      }
      const key = parseKey(url.pathname)
      if (!key) {
        send(res, 400, { error: 'invalid key' })
        return
      }
      const filePath = path.join(BLOB_DIR, userId, key)

      if (req.method === 'GET') {
        const exists = fs.existsSync(filePath)
        if (!exists) {
          send(res, 404, { error: 'not found' })
          return
        }
        const data = await readFile(filePath)
        send(res, 200, data, { 'Content-Type': 'application/octet-stream' })
        return
      }

      if (req.method === 'PUT') {
        const buffers = []
        for await (const chunk of req) {
          buffers.push(chunk)
        }
        const body = Buffer.concat(buffers)
        await mkdir(path.dirname(filePath), { recursive: true })
        await writeFile(filePath, body)
        const updatedAt = new Date().toISOString()
        await appendChange(userId, key, updatedAt)
        send(res, 200, { ok: true, updatedAt })
        return
      }

      send(res, 405, { error: 'method not allowed' })
      return
    }

    send(res, 404, { error: 'not found' })
  } catch (err) {
    console.error(err)
    send(res, 500, { error: 'server error' })
  }
})

ensureDirs()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Jotrip sync API listening on http://0.0.0.0:${PORT}`)
    })
  })
  .catch((err) => {
    console.error('Failed to prepare data directory', err)
    process.exit(1)
  })
