# Local-first Jots PWA — Scope (IndexedDB + Encrypted Per-Note Sync)

## Goal

A **mobile-first** notes app built with **Vue** as a **Progressive Web App (PWA)**, styled with **Tailwind CSS**, focused on:

- **Grouping / collections**
- **Calendar mode** browsing
- **Named tabs inside each note**
- **Offline-first** with **encrypted per-note sync** (manifest + note/image blobs)

**Frontend:** Vue + Tailwind CSS, delivered as a PWA.  
**Source of truth:** client-side **IndexedDB**.  
**Backend:** simple Node.js service storing encrypted blobs only (no database, no inspection).

---

## MVP Feature Scope

### Jots
- Create, edit, delete notes
- Jots list with search
- Title + created/updated timestamps

### Tabs within a note
- Multiple named tabs per note
- Create / rename / reorder / delete tabs

### Minimal formatting (Markdown-like)
- Headers
- **bold**
- *italic*
- ~~strike~~
- Links
- Lists and checklists (same thing)

Checklist syntax:
- `- [ ] item`
- `- [x] item`

Only `[ ]` ↔ `[x]` is toggled.

---

## Images
- Inserted as `![image:<imageId>]`
- Stored separately in IndexedDB
- Client-side resize/compression
- Gutter may show thumbnails
- Tap opens viewer

---

## Tags (`#tags`)
- Global
- Syntax: `#tag-name`
- Allowed chars: A–Z, a–z, 0–9, `_`, `-`
- `/` not allowed
- Ends on whitespace / newline / punctuation

Editor behavior:
- `#` opens picker
- Prefix filters (`#th`)
- Create if no match
- Auto-trailing space

---

## Calendar (`@date`)
- Syntax: `@YYYY-MM-DD`
- Line-level
- Only text **after token on same line** is used
- Line boundary = newline (`\n`), treat `\r\n` as `\n`

Calendar view:
- Computed from text
- Month view
- Not stored as entities

Navigation:
- Open note
- Scroll to token
- No persistent IDs
- Multiple matches → first + Next/Previous

Helpers:
- `@` opens date picker
- Natural typing allowed
- Normalize on space/newline only if unambiguous

---

## Editor UX

### Editing surface
- Single textarea
- No view/edit toggle
- Keyboard-first

### Optional preview
- Read-only
- Below textarea or collapsible
- Debounced
- Interactive only when keyboard closed

### Left gutter
Per visible line:
- Checkbox icon
- Image thumbnail
- Link icon
- Tag icon

Actions do not move caret.

---

## Data Model

### Note
- id
- title
- createdAt
- updatedAt
- tabOrder
- collectionIds

### Tab
- id
- noteId
- name
- content
- updatedAt

### Collection
- id
- name
- createdAt

### Image
- id
- noteId
- tabId
- mime
- blob
- width?
- height?
- createdAt

---

## IndexedDB
Stores:
- notes
- tabs
- collections
- images
- meta

Meta:
- deviceId
- lastSyncAt

---

## Sync & Encryption

### Identity
- Secret Key generated on first run
- Acts as ID + auth + encryption key
- User must save it

### Encryption
- Client-side (WebCrypto, AES-GCM)
- Server stores opaque blobs only

### Units
- Encrypted note blobs
- Encrypted image blobs
- Encrypted manifest

### Sync behavior
- On boot:
  - fetch manifest
  - auto-pull non-conflicting updates
  - prompt on conflict
- Conflicts create duplicate notes

---

## Backend API

- PUT /api/manifest
- GET /api/manifest
- PUT /api/note/:noteId/:rev
- GET /api/note/:noteId/:rev
- PUT /api/image/:imageId/:rev
- GET /api/image/:imageId/:rev

Auth:
- `Authorization: Bearer <SecretKey>`

---

## Acceptance Criteria
- Fully offline
- Plain text editor
- Gutter interactivity
- Calendar + tags derived from text
- Encrypted per-note sync
- Auto-pull updates
- Prompt on conflict
