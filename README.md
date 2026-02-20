# Quran Digital

A modern, web-based Quran reader with a mushaf-style layout, designed to be mobile and tablet friendly.

## Features

- **Mushaf View**: Clean, ornamental layout with Arabic text and ayah markers.
- **Floating Action Menu**: Tap on any ayah to access bookmarking, translation, audio playback, and personal notes.
- **Bookmark Management**: Organize your bookmarks into custom folders.
- **Personal Notes**: Add private annotations per ayah.
- **Audio Murottal**: Multi-Qari support with auto-play and repeat functionality.
- **Search**: Fast Arabic text search across all 114 surahs.
- **Responsive Design**: Optimized for mobile, tablet, and desktop viewports.

## Tech Stack

### Frontend
- **Framework**: Angular (Standalone Components)
- **Styling**: SCSS with CSS Variables
- **State Management**: Angular Signals
- **PWA**: Offline support via Service Workers

### Backend
- **Framework**: [Hono](https://hono.dev)
- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite at the edge)
- **Caching**: Cloudflare KV

## Data Sources
- **Quran Text**: [quran-json](https://github.com/risan/quran-json)
- **Audio**: [Aladhan API / Islamic Network](https://aladhan.com/arabic-quran-api)

## Getting Started

### Prerequisites
- Node.js (Latest LTS)
- Angular CLI
- Cloudflare Wrangler (for backend)

### Development

1. **Backend**:
   ```bash
   cd backend
   npm install
   npx wrangler dev
   ```

2. **Frontend**:
   ```bash
   cd frontend
   npm install
   npm start
   ```

## Deployment
The project is designed to be hosted on **Cloudflare Pages** (frontend) and **Cloudflare Workers** (backend).

## License
[Specify License if any, e.g., MIT]
