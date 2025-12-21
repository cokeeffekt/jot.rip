import { ref, watchEffect } from 'vue'
import { getMeta } from '../db'

export const syncActive = ref(false)
export const syncEnabled = ref(false)

watchEffect(async () => {
  const enabled = await getMeta<boolean>('sync:enabled')
  syncEnabled.value = Boolean(enabled)
})
