<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { createNote, createTab, deleteNote, initDatabase, listNotes, updateNote } from '../db'
import type { Note } from '../db'

const notes = ref<Note[]>([])
const loading = ref(true)
const creating = ref(false)

const refresh = async () => {
  loading.value = true
  notes.value = await listNotes()
  loading.value = false
}

const handleCreate = async () => {
  creating.value = true
  const note = await createNote({ title: 'Untitled note' })
  const tab = await createTab({ noteId: note.id, name: 'Main', content: '' })
  await updateNote(note.id, { tabOrder: [tab.id] })
  await refresh()
  creating.value = false
}

const handleDelete = async (id: string) => {
  await deleteNote(id)
  await refresh()
}

onMounted(async () => {
  await initDatabase()
  await refresh()
})
</script>

<template>
  <section class="space-y-6">
    <header class="flex flex-col gap-2">
      <p class="text-xs uppercase tracking-[0.2em] text-slate-400">DB Demo</p>
      <h1 class="text-2xl font-semibold text-white">IndexedDB CRUD</h1>
      <p class="text-sm text-slate-300">
        Temporary screen to prove the Dexie-backed repository works and persists after refresh.
      </p>
    </header>

    <div class="flex gap-3">
      <button
        type="button"
        class="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-700/30 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        @click="handleCreate"
        :disabled="creating"
      >
        {{ creating ? 'Creating...' : 'Create jot + tab' }}
      </button>
      <span class="self-center text-xs text-slate-400">
        Jots persist across reloads; delete to clear.
      </span>
    </div>

    <div class="space-y-3 rounded-2xl border border-white/10 bg-slate-900/50 p-5">
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold text-white">Jots</p>
        <span class="text-xs text-slate-400">
          {{ loading ? 'Loading...' : `${notes.length} stored` }}
        </span>
      </div>

      <div v-if="!notes.length && !loading" class="rounded-xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-slate-300">
        No jots yet. Create one to populate IndexedDB.
      </div>

      <ul class="space-y-2">
        <li
          v-for="note in notes"
          :key="note.id"
          class="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3"
        >
          <div>
            <p class="text-sm font-semibold text-white">{{ note.title }}</p>
            <p class="text-xs text-slate-400">
              Updated: {{ new Date(note.updatedAt).toLocaleString() }}
            </p>
            <p class="text-xs text-slate-500">Tabs: {{ note.tabOrder.length }}</p>
          </div>
          <button
            type="button"
            class="rounded-lg border border-white/20 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-red-400 hover:text-red-200"
            @click="handleDelete(note.id)"
          >
            Delete
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
