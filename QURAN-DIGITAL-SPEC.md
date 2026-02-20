# Quran Digital — Project Specification

## Overview
A web-based Quran reader with mushaf-style layout, designed to be mobile/tablet friendly. Built with Angular (frontend) and Hono on Cloudflare Workers (backend). Key differentiators: bookmark folder management, personal notes per ayah, and clean floating action menu on tap.

---

## Tech Stack

### Frontend
- **Framework**: Angular 20+ (standalone components)
- **Styling**: SCSS with CSS variables for theming
- **Font**: Amiri Quran (Arabic text), Amiri (UI Arabic), Noto Sans (UI Latin)
- **State management**: Angular Signals (simple, built-in)
- **Storage**: localStorage for MVP (bookmarks, notes, settings)
- **Audio**: HTML5 Audio API
- **Hosting**: Cloudflare Pages (auto-deploy from Git)

### Backend
- **Framework**: Hono (https://hono.dev)
- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite at edge) — for user bookmarks, notes sync
- **Cache**: Cloudflare KV — for Quran data caching
- **Language**: TypeScript
- **Deploy**: Wrangler CLI

### Why Hono?
- Built specifically for edge runtimes (Cloudflare Workers, Deno, Bun)
- Ultrafast (~0ms overhead), tiny bundle size (~14KB)
- Express-like API — familiar DX
- Built-in TypeScript support, middleware, validators
- First-class Cloudflare bindings (D1, KV, R2)
- GA (Generally Available) on Cloudflare Workers
- Easy migration path — also runs on Node.js, Deno, Bun if needed later

### Data Sources
- **Quran text (Arabic)**: `https://cdn.jsdelivr.net/npm/quran-json@3.1.2/dist/chapters/{n}.json`
- **Indonesian translation**: `https://cdn.jsdelivr.net/npm/quran-json@3.1.2/dist/chapters/id/{n}.json`
- **Audio CDN**: `https://cdn.islamic.network/quran/audio/128/{qari_id}/{absolute_ayah_number}.mp3`

---

## Backend Architecture (Hono + Cloudflare Workers)

### Project Structure
```
backend/
├── src/
│   ├── index.ts                # Main Hono app, routes
│   ├── routes/
│   │   ├── quran.ts            # Surah data endpoints
│   │   ├── search.ts           # Search endpoint
│   │   ├── bookmarks.ts        # Bookmark CRUD (D1)
│   │   └── notes.ts            # Notes CRUD (D1)
│   ├── middleware/
│   │   ├── cors.ts             # CORS for Angular frontend
│   │   └── cache.ts            # KV caching middleware
│   ├── services/
│   │   ├── quran-data.ts       # Fetch & cache Quran JSON from CDN
│   │   └── search.ts           # Search logic
│   ├── db/
│   │   ├── schema.sql          # D1 table definitions
│   │   └── migrations/         # D1 migrations
│   └── types.ts                # TypeScript types & Cloudflare bindings
├── data/
│   ├── chapters/               # 114 JSON files (Arabic) — pre-cached
│   │   ├── 1.json ... 114.json
│   └── chapters_id/            # 114 JSON files (Indonesian)
│       ├── 1.json ... 114.json
├── wrangler.toml               # Cloudflare Workers config
├── package.json
└── tsconfig.json
```

### wrangler.toml
```toml
name = "quran-api"
main = "src/index.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

# KV Namespace — Quran data cache
[[kv_namespaces]]
binding = "QURAN_CACHE"
id = "xxx"

# D1 Database — User data (bookmarks, notes)
[[d1_databases]]
binding = "DB"
database_name = "quran-db"
database_id = "xxx"
```

### Main App (src/index.ts)
```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { quranRoutes } from './routes/quran'
import { searchRoutes } from './routes/search'
import { bookmarkRoutes } from './routes/bookmarks'
import { noteRoutes } from './routes/notes'

type Bindings = {
  QURAN_CACHE: KVNamespace
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// Middleware
app.use('*', cors({
  origin: ['https://quran.yourdomain.com', 'http://localhost:4200'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
}))

// Routes
app.route('/api/quran', quranRoutes)
app.route('/api/search', searchRoutes)
app.route('/api/bookmarks', bookmarkRoutes)
app.route('/api/notes', noteRoutes)

// Health check
app.get('/', (c) => c.json({ status: 'ok', service: 'quran-api' }))

export default app
```

### API Endpoints
```
# Quran Data (cached in KV)
GET  /api/quran/surahs                    → List all 114 surahs (metadata)
GET  /api/quran/surah/:number             → Full surah with Arabic verses
GET  /api/quran/surah/:number/translation → Indonesian translation
GET  /api/quran/surah/:number/ayah/:ayah  → Single ayah + translation

# Search
GET  /api/search?q={arabic_text}          → Search across all surahs (max 30 results)

# Bookmarks (D1 — requires auth later)
GET    /api/bookmarks                     → List all bookmarks
POST   /api/bookmarks                     → Add bookmark
DELETE /api/bookmarks/:key                → Remove bookmark
DELETE /api/bookmarks/folder/:name        → Remove all bookmarks in folder

# Folders
GET    /api/bookmarks/folders             → List folders
POST   /api/bookmarks/folders             → Create folder
DELETE /api/bookmarks/folders/:name       → Delete folder (move bookmarks to "Umum")

# Notes (D1)
GET    /api/notes                         → List all notes
POST   /api/notes                         → Create/update note
DELETE /api/notes/:key                    → Delete note
```

### D1 Schema (db/schema.sql)
```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  key TEXT PRIMARY KEY,          -- "2:255"
  surah INTEGER NOT NULL,
  ayah INTEGER NOT NULL,
  surah_name_ar TEXT,
  surah_name_en TEXT,
  folder TEXT DEFAULT 'Umum',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS folders (
  name TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
  key TEXT PRIMARY KEY,          -- "2:255"
  surah INTEGER NOT NULL,
  ayah INTEGER NOT NULL,
  text TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Default folder
INSERT OR IGNORE INTO folders (name) VALUES ('Umum');

CREATE INDEX idx_bookmarks_folder ON bookmarks(folder);
CREATE INDEX idx_bookmarks_surah ON bookmarks(surah);
CREATE INDEX idx_notes_surah ON notes(surah);
```

### Example Route (routes/quran.ts)
```typescript
import { Hono } from 'hono'

type Bindings = { QURAN_CACHE: KVNamespace }

const quranRoutes = new Hono<{ Bindings: Bindings }>()

// Get surah with caching
quranRoutes.get('/surah/:number', async (c) => {
  const num = parseInt(c.req.param('number'))
  if (num < 1 || num > 114) return c.json({ error: 'Invalid surah' }, 400)

  const cacheKey = `surah:${num}`
  
  // Check KV cache first
  let data = await c.env.QURAN_CACHE.get(cacheKey, 'json')
  if (data) return c.json(data)

  // Fetch from CDN
  const res = await fetch(
    `https://cdn.jsdelivr.net/npm/quran-json@3.1.2/dist/chapters/${num}.json`
  )
  data = await res.json()

  // Cache in KV (no expiry — Quran text doesn't change)
  await c.env.QURAN_CACHE.put(cacheKey, JSON.stringify(data))

  return c.json(data)
})

export { quranRoutes }
```

---

## Data Structure

### Surah Metadata (114 entries)
```typescript
interface SurahMeta {
  number: number        // 1-114
  name: string          // "الفاتحة"
  englishName: string   // "Al-Fatihah"
  totalVerses: number   // 7
  startAyah: number     // Absolute ayah number (1-6236)
}
```

### Verse (from quran-json CDN)
```typescript
interface Verse {
  number: number        // Ayah number within surah
  text: string          // Arabic text
}

interface VerseTranslation {
  number: number
  text: string          // Arabic
  translation_id: string // Indonesian translation
}
```

### Bookmark
```typescript
interface Bookmark {
  key: string           // "2:255"
  surah: number
  ayah: number
  surahNameAr: string
  surahNameEn: string
  folder: string        // "Hafalan"
  createdAt: string     // ISO date
}
```

### Note
```typescript
interface Note {
  key: string           // "2:255"
  surah: number
  ayah: number
  text: string
  updatedAt: string
}
```

---

## Features & UI Specification

### 1. Main Layout — Mushaf View (Per Surah)

**Structure:**
- Sticky header with surah name + navigation icons
- Scrollable content area with Arabic text
- Fixed bottom navigation bar

**Header (sticky top):**
- Left: hamburger icon → opens surah list drawer
- Center: current surah name (Arabic + transliteration)
- Right: icon buttons — Search, Bookmark, Notes, Settings

**Content Area:**
- Surah header with ornamental divider, surah name in large Arabic, transliteration, ayat count
- Bismillah (except surah 1 and 9)
- Arabic text rendered RTL, inline flow with ayah number markers
- Ayah numbers displayed in circles
- Bookmarked ayahs have a small gold dot indicator on the number circle
- Ayahs with notes have dotted underline decoration

**Bottom Navigation (fixed):**
- Previous surah button
- Current position indicator: "Surah X/114"
- Next surah button

### 2. Floating Action Menu (On Ayah Tap)

When user taps/clicks on any ayah text:
- A floating dark-green pill menu appears ABOVE the tapped ayah
- Contains 4 icon buttons in a row:
  1. 🔖 **Bookmark** — opens bookmark dialog
  2. 🌐 **Translate** — shows Indonesian translation below the ayah
  3. ▶️ **Play** — plays murottal audio for that ayah
  4. 📝 **Note** — opens note editor panel

**Behavior:**
- Menu dismisses on tap outside
- Position adapts to not overflow viewport
- Mobile-friendly: large enough touch targets (min 44x44px)

### 3. Translation Display

- When "Translate" is tapped, translation appears in a card below the ayah
- Card has light background, left-aligned Indonesian text
- Stays visible until another action is taken
- Translation loaded from CDN per surah (cached after first load)

### 4. Audio Player

**Audio Bar (appears when playing):**
- Fixed position above bottom nav
- Shows: Play/Pause, current ayah info, Repeat toggle, Close
- Pill-shaped dark green container

**Audio Features:**
- Play per ayah (from floating menu)
- Auto-play: continues to next ayah when current finishes
- Repeat/loop: repeats current ayah indefinitely
- Qari selection (in Settings):
  - Mishary Rashid Alafasy (`ar.alafasy`)
  - Abdul Basit Murattal (`ar.abdulbasitmurattal`)
  - Mahmoud Khalil Al-Husary (`ar.husary`)
  - Mohamed Siddiq Al-Minshawi (`ar.minshawi`)

**Audio URL pattern:**
`https://cdn.islamic.network/quran/audio/128/{qari_id}/{absolute_ayah}.mp3`

**Absolute Ayah Calculation:**
Sum of all previous surah verse counts + current ayah number within surah.

### 5. Bookmark Management (KEY DIFFERENTIATOR)

**Adding Bookmark:**
- From floating menu → opens modal dialog
- Shows surah:ayah info
- User selects folder from existing folders
- User can create new folder inline
- Save button adds bookmark

**Bookmark Panel (side drawer):**
- Grouped by folder
- Each folder: name, count, "Hapus Semua" (delete all in folder)
- Non-default folders have delete button
- Each bookmark: surah name, ayah number, date, individual delete
- Tap bookmark → navigates to that surah

**Default folder:** "Umum" (cannot be deleted)

### 6. Notes (Personal Annotations)

**Adding Note:**
- From floating menu → opens note editor panel
- Shows surah:ayah reference
- Textarea for writing
- Save / Cancel

**Notes Panel:**
- Lists all notes across all surahs
- Each: surah reference (clickable), note text, Edit/Delete buttons

**Visual Indicator:** Ayahs with notes have dotted underline

### 7. Search

- Arabic text search across all 114 surahs
- Results: surah name, ayah number, Arabic text
- Tap result → navigates to surah
- Max 30 results

### 8. Surah List (Modal/Drawer)

- All 114 surahs with number, Arabic name, English name, ayat count
- Current surah highlighted
- Tap → navigates and closes

### 9. Settings

- Qari selection (radio buttons)
- Audio: Auto-play toggle, Repeat toggle
- Jump to surah (number input)
- Folder management: view/create/delete

---

## Design System

### Color Palette
```scss
$green-dark: #0d2818;
$green-primary: #1a3a2a;
$bg-primary: #fdf8f0;
$bg-secondary: #f5ece0;
$bg-tertiary: #ede4d4;
$gold-primary: #c4a87c;
$gold-dark: #8b7355;
$gold-indicator: #d4a017;
$text-primary: #1a0e08;
$text-secondary: #2c1810;
$text-muted: #8b7355;
$text-light: #e8dcc8;
$danger: #c0392b;
```

### Typography
```scss
.ayah-text {
  font-family: 'Amiri Quran', 'Amiri', 'Scheherazade New', serif;
  font-size: 26px;
  line-height: 2.2;
  direction: rtl;
}
.arabic-ui { font-family: 'Amiri', serif; font-weight: 700; }
.latin-ui { font-family: 'Noto Sans', sans-serif; font-size: 13px; }
```

### Component Patterns
```scss
.floating-menu {
  background: $green-primary;
  border-radius: 14px;
  padding: 6px 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.35);
}
.ayah-number {
  width: 34px; height: 34px;
  border-radius: 50%;
  border: 1.5px solid $gold-primary;
  background: rgba($gold-primary, 0.08);
}
.tag-button {
  background: rgba($green-primary, 0.1);
  border: 1px solid rgba($green-primary, 0.15);
  border-radius: 6px;
  padding: 5px 10px;
}
.side-panel {
  width: min(400px, 92vw);
  background: $bg-primary;
  box-shadow: -4px 0 30px rgba(0,0,0,0.2);
}
.ornament {
  display: flex; align-items: center; gap: 12px;
  &::before, &::after {
    content: ''; flex: 1; height: 1px;
    background: linear-gradient(90deg, transparent, $gold-primary, transparent);
  }
}
```

---

## Frontend Structure (Angular)

```
frontend/
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   ├── services/
│   │   │   │   ├── quran-data.service.ts
│   │   │   │   ├── audio.service.ts
│   │   │   │   ├── bookmark.service.ts
│   │   │   │   ├── notes.service.ts
│   │   │   │   └── storage.service.ts
│   │   │   └── models/
│   │   │       ├── surah.model.ts
│   │   │       ├── bookmark.model.ts
│   │   │       └── note.model.ts
│   │   ├── features/
│   │   │   ├── mushaf/
│   │   │   │   ├── mushaf.component.ts
│   │   │   │   ├── ayah-text.component.ts
│   │   │   │   ├── floating-menu.component.ts
│   │   │   │   └── surah-header.component.ts
│   │   │   ├── audio/
│   │   │   │   └── audio-bar.component.ts
│   │   │   ├── search/
│   │   │   │   └── search-panel.component.ts
│   │   │   ├── bookmarks/
│   │   │   │   ├── bookmark-panel.component.ts
│   │   │   │   └── bookmark-dialog.component.ts
│   │   │   ├── notes/
│   │   │   │   ├── notes-panel.component.ts
│   │   │   │   └── note-editor.component.ts
│   │   │   └── settings/
│   │   │       └── settings-panel.component.ts
│   │   ├── shared/
│   │   │   ├── components/
│   │   │   │   ├── side-panel.component.ts
│   │   │   │   ├── surah-list.component.ts
│   │   │   │   └── icon.component.ts
│   │   │   └── pipes/
│   │   │       └── arabic-number.pipe.ts
│   │   ├── app.component.ts
│   │   └── app.routes.ts
│   ├── assets/
│   │   ├── data/               # Cached Quran JSON (optional, can use API)
│   │   └── fonts/
│   ├── styles/
│   │   ├── _variables.scss
│   │   ├── _typography.scss
│   │   ├── _animations.scss
│   │   └── global.scss
│   └── index.html
├── angular.json
├── package.json
└── tsconfig.json
```

---

## Deployment Architecture

```
┌─────────────────────────────────────────────┐
│              Cloudflare Network              │
│                                              │
│  ┌──────────────┐    ┌───────────────────┐  │
│  │  CF Pages     │    │  CF Workers        │  │
│  │  (Angular)    │───▶│  (Hono API)        │  │
│  │  Static SPA   │    │                    │  │
│  └──────────────┘    │  ┌──────────┐      │  │
│                       │  │ D1 (SQL)  │      │  │
│                       │  │ bookmarks │      │  │
│                       │  │ notes     │      │  │
│                       │  └──────────┘      │  │
│                       │  ┌──────────┐      │  │
│                       │  │ KV Cache  │      │  │
│                       │  │ quran data│      │  │
│                       │  └──────────┘      │  │
│                       └───────────────────┘  │
│                              │               │
│                    ┌─────────┴─────────┐     │
│                    │ External CDNs      │     │
│                    │ • jsdelivr (JSON)  │     │
│                    │ • islamic.network  │     │
│                    │   (audio files)    │     │
│                    └───────────────────┘     │
└─────────────────────────────────────────────┘
```

---

## Available Qaris & Audio

| Qari | ID | CDN Path |
|------|----|----------|
| Mishary Rashid Alafasy | ar.alafasy | /ar.alafasy/{ayah}.mp3 |
| Abdul Basit (Murattal) | ar.abdulbasitmurattal | /ar.abdulbasitmurattal/{ayah}.mp3 |
| Mahmoud Khalil Al-Husary | ar.husary | /ar.husary/{ayah}.mp3 |
| Mohamed Siddiq Al-Minshawi | ar.minshawi | /ar.minshawi/{ayah}.mp3 |

Base URL: `https://cdn.islamic.network/quran/audio/128/`

---

## MVP Priorities

### Phase 1 (Core)
1. Surah list & navigation
2. Arabic text display (mushaf-style)
3. Floating action menu on tap
4. Indonesian translation (on demand)
5. Audio playback (single ayah, auto-play next)
6. Basic bookmarks (localStorage)
7. Hono backend: serve Quran data with KV caching

### Phase 2 (Differentiators)
1. Bookmark folders & management
2. Personal notes per ayah
3. Qari selection
4. Repeat/loop mode
5. Search across all surahs
6. D1 database for bookmarks/notes persistence

### Phase 3 (Enhancement)
1. User authentication (Cloudflare Access or custom)
2. Cloud sync (bookmarks, notes, reading position across devices)
3. Dark mode
4. Font size adjustment
5. Swipe gesture navigation
6. PWA support (offline reading via Service Worker)
7. Tafsir support (future)

---

## Notes for Claude Code

1. **Start backend first**: `npm create hono@latest quran-api -- --template cloudflare-workers` then add routes incrementally.

2. **Data seeding**: Download all 114 JSON files from jsdelivr CDN, store in KV using a seeding script (`wrangler kv:put`). Alternatively, fetch on-demand and cache.

3. **Angular frontend**: Use `ng new quran-digital --standalone --style=scss --routing=false` for simplicity.

4. **Fonts**: Import via Google Fonts in index.html:
   ```html
   <link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Amiri+Quran&family=Noto+Sans:wght@400;500;600&display=swap" rel="stylesheet">
   ```

5. **Responsive**: Mobile-first. Floating menu touch targets min 44x44px.

6. **Performance**: Lazy-load surah data. Cache in memory + KV.

7. **Local dev**: Use `wrangler dev` for backend, `ng serve` for frontend with proxy to localhost:8787.

8. **CORS**: Hono cors middleware handles cross-origin between Pages and Workers.
