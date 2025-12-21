# Local-first Jots PWA

I spent nearly twenty years trying to like note-taking apps.

I tried the clever ones, the beautiful ones, the ones with backlinks and graphs and promises of a better brain. I tried systems, workflows, methods with names. Every time, I bounced off. Too much structure, too much ceremony, too much friction between thought and text.

I always came back to plain text files. A folder. A cursor. Words on disk. It wasn’t elegant, but it stayed out of my way.

Still, I kept looking for something better — something just as simple, but a little more intentional. Something that didn’t demand an account, a cloud, or a philosophy. Something that assumed my thoughts were already complicated enough.

jot.rip is what that search quietly turned into.

It’s offline-first, fast, and plain-text friendly. A single textarea editor. A predictable gutter. Optional sync, only if you want it. No accounts. No onboarding. No insistence that you do things the right way.

In the end, I never actually built my dream notes app. But after about twelve hours of back-and-forth, Codex did — and it turns out, that’s good enough.

And it’s open source.

So if this is almost what you want, but not quite it, you too can go ask Codex to build what you want.

If you have an opinion or a feature request, fork it. If you find a bug, send a PR.

A mobile-first, offline-first jots app built with Vue.

This app uses **plain text** as the source of truth, enhanced with:
- `#tags` for collections
- `@dates` for calendar views
- checklists, links, and images
- encrypted per-note sync across devices

The backend is intentionally dumb: it stores encrypted blobs only.

---

## Tech Stack

Frontend:
- Vue 3 + TypeScript + Vite
- Vue Router for navigation and layout
- Tailwind CSS with forms plugin
- PWA manifest and basic service worker

Backend:
- Node.js
- File-based storage
- No database

---

## Project Principles

- Local-first
- Plain text always visible
- Keyboard-first editing
- No rich-text editors
- No server-side interpretation of data

---

## Scripts
- `npm run dev` — start the Vite dev server
- `npm run build` — type-check with `vue-tsc` and build for production
- `npm run server` — run the minimal filesystem sync API (see “Self-hosted sync”)

## IndexedDB demo
- Run `npm run dev` and open `/db-demo` to create/list/delete notes via the Dexie-backed repository (data persists after refresh).

## Editor demo
- Run `npm run dev`, open `/` (Jots), create a jot, then open it to edit the first tab in the single-textarea editor.
- Toolbar covers header/checklist helpers; `#` and `@` typing triggers show hints; `@today` and `@YYYY/M/D` normalize on space/enter.

## Calendar demo
- Add text with `@YYYY-MM-DD` tokens to a jot tab (e.g. `Trip plan @2024-12-18 book flights`).
- Open `/calendar`, pick the month, tap a day dot to see entries, then click "Open" to jump into the editor at that token. Use Prev/Next in the editor to move between same-date matches.

## Images demo
- In a note, click “Add Image” or paste an image; a placeholder `![image:<id>]` is inserted and the image is stored locally.
- Reload to confirm the image persists; gutter shows a thumbnail on the placeholder line; clicking the thumbnail opens a modal.

## Self-hosted sync (server)
- A tiny Node API serves encrypted blobs from the filesystem. Endpoints:
  - `GET /health`
  - `GET /changes?since=<iso>` — change log since timestamp
  - `GET /blob/<key>` — fetch a blob
  - `PUT /blob/<key>` — store a blob (raw bytes)
- Keys are simple paths such as `tabs/<id>.json`, `notes/<id>.json`, `images/<id>.bin`. The API is dumb and never sees plaintext.
- Auth (optional): set `AUTH_TOKEN` and send `Authorization: Bearer <token>`.
- Run locally: `npm run server` (defaults to port 4000, data in `./data`).
- Docker: `docker build -t jotrip-sync . && docker run -p 4000:4000 -v $(pwd)/data:/data jotrip-sync`.

## Docker image
The included Dockerfile builds the client and serves it with the sync API.
- Build: `npm run docker:build` (runs `npm run build` then `docker build -t jotrip:local .`)
- Run: `npm run docker:run` (serves on port 4000, mounts `./data` for storage)
- Environment vars (optional):
  - `PORT` (default 4000)
  - `DATA_DIR` (default `/data` in the container)
  - `DIST_DIR` (default `/app/dist`)
Push your own image: `docker tag jotrip:local yourname/jotrip:latest && docker push yourname/jotrip:latest`

### Example docker-compose
```yaml
version: '3.8'
services:
  jotrip:
    image: jotrip:local # or yourname/jotrip:latest
    build: .
    ports:
      - '4000:4000'
    environment:
      - PORT=4000
      - DATA_DIR=/data
      - DIST_DIR=/app/dist
    volumes:
      - ./data:/data
    restart: unless-stopped
```
