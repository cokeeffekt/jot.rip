import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import Calendar from '../views/Calendar.vue'
import DbDemo from '../views/DbDemo.vue'
import Help from '../views/Help.vue'
import Home from '../views/Home.vue'
import ImportView from '../views/Import.vue'
import NoteEditor from '../views/NoteEditor.vue'
import NotesList from '../views/NotesList.vue'
import Settings from '../views/Settings.vue'
import About from '../views/About.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', name: 'home', component: Home },
        { path: 'notes', name: 'notes', component: NotesList },
        { path: 'notes/:id', name: 'note-editor', component: NoteEditor, props: true },
        { path: 'calendar', name: 'calendar', component: Calendar },
        { path: 'settings', name: 'settings', component: Settings },
        { path: 'import', name: 'import', component: ImportView },
        { path: 'help', name: 'help', component: Help },
        { path: 'db-demo', name: 'db-demo', component: DbDemo },
        { path: 'about', name: 'about', component: About },
      ],
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

export default router
