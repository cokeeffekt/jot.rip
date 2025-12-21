<script setup lang="ts">
const props = defineProps<{
  open: boolean
  src?: string
  canPrev?: boolean
  canNext?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'prev'): void
  (e: 'next'): void
}>()
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    @click.self="emit('close')"
  >
    <div class="relative max-h-full max-w-full bg-slate-900 p-3 shadow-2xl">
      <button
        type="button"
        class="absolute right-2 top-2 bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20"
        @click="emit('close')"
      >
        Close
      </button>
      <button
        v-if="canPrev"
        type="button"
        class="absolute left-2 top-1/2 -translate-y-1/2 bg-white/10 px-3 py-2 text-white hover:bg-white/20"
        @click="emit('prev')"
        aria-label="Previous image"
      >
        ←
      </button>
      <button
        v-if="canNext"
        type="button"
        class="absolute right-2 top-1/2 -translate-y-1/2 bg-white/10 px-3 py-2 text-white hover:bg-white/20"
        @click="emit('next')"
        aria-label="Next image"
      >
        →
      </button>
      <img v-if="src" :src="src" alt="image" class="max-h-[70vh] max-w-[80vw] rounded-xl object-contain" />
      <div v-else class="h-64 w-64 rounded-xl bg-white/5"></div>
    </div>
  </div>
</template>
