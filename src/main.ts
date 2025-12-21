import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'
import { registerServiceWorker } from './pwa/registerServiceWorker'
import { initDatabase } from './db'
import { startSyncPolling } from './sync/poller'

const applyViewportHeight = () => {
  const set = () => {
    const height = window.visualViewport?.height ?? window.innerHeight
    document.documentElement.style.setProperty('--app-height', `${height}px`)
  }
  set()
  window.addEventListener('resize', set, { passive: true })
  window.visualViewport?.addEventListener('resize', set, { passive: true })
  window.visualViewport?.addEventListener('scroll', set, { passive: true })
}

const applyTheme = () => {
  const key = 'jotrip:theme'
  const stored = window.localStorage.getItem(key)
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)')?.matches ?? false
  const theme = stored === 'light' || stored === 'dark' ? stored : prefersLight ? 'light' : 'dark'
  document.documentElement.classList.toggle('theme-light', theme === 'light')
}

applyViewportHeight()
applyTheme()

const app = createApp(App)

app.use(router)
app.mount('#app')

registerServiceWorker()
initDatabase().catch(() => {})
startSyncPolling()
