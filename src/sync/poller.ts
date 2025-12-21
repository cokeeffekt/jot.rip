import { getMeta, setMeta } from '../db'
import { syncNow } from './client'
import { syncActive } from './state'

const TEN_MINUTES = 10 * 60 * 1000

let intervalId: number | null = null
let inFlight: Promise<void> | null = null

type SyncConfig =
  | {
      baseUrl: string
      username: string
      password: string
      passphrase: string
    }
  | null

const loadConfig = async (): Promise<SyncConfig> => {
  const enabled = await getMeta<boolean>('sync:enabled')
  if (!enabled) return null
  const baseUrl = (await getMeta<string>('sync:url'))?.trim() || ''
  const username = (await getMeta<string>('sync:username'))?.trim() || ''
  const password = (await getMeta<string>('sync:password'))?.trim() || ''
  const passphrase = (await getMeta<string>('sync:passphrase'))?.trim() || ''
  if (!baseUrl || !username || !password || !passphrase) return null
  return { baseUrl, username, password, passphrase }
}

const runSync = async (reason: string) => {
  if (inFlight) return inFlight
  inFlight = (async () => {
    const cfg = await loadConfig()
    if (!cfg) return
    try {
      syncActive.value = true
      const ts = await syncNow(cfg)
      await setMeta('sync:last', ts)
      if (reason) console.debug('[sync] completed', reason, ts)
      window.dispatchEvent(new CustomEvent('jotrip:sync-complete', { detail: { ts, reason } }))
    } catch (err) {
      console.error('[sync] failed', reason, err)
    } finally {
      syncActive.value = false
      inFlight = null
    }
  })()
  return inFlight
}

export const triggerSync = (reason = 'manual') => {
  void runSync(reason)
}

const onVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    triggerSync('visibility')
  }
}

export const startSyncPolling = () => {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  triggerSync('startup')
  intervalId = window.setInterval(() => triggerSync('interval'), TEN_MINUTES)
  document.addEventListener('visibilitychange', onVisibilityChange)
}

export const stopSyncPolling = () => {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  document.removeEventListener('visibilitychange', onVisibilityChange)
}
