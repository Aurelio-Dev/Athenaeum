# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start Tauri desktop app (runs Vite + Rust backend together)
npm run tauri dev

# Frontend only (Vite dev server on port 1420)
npm run dev

# Type check without emitting
npm run typecheck

# Build frontend
npm run build

# Build desktop app
npm run tauri build
```

There are no tests configured in this project.

## Architecture

**Athenaeum** is a Portuguese-language desktop app for managing a personal PDF library. It uses:

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS
- **Backend/Shell:** Rust + Tauri v2 (replaces Electron)
- **Database:** SQLite via `@tauri-apps/plugin-sql`

### Data Flow

The frontend calls SQLite directly through `@tauri-apps/plugin-sql` — there is no REST API or backend service layer. All database logic lives in [src/lib/database.ts](src/lib/database.ts). Tauri commands (defined in [src-tauri/src/lib.rs](src-tauri/src/lib.rs)) handle things that require native OS access: file picker dialog (`rfd` crate), opening files in the system file manager, and base64-encoding PDFs to pass them to the frontend.

### Frontend Structure

```
src/
├── app/App.tsx            # Root — renders LibraryView
├── main.tsx               # React entry point
├── features/library/      # Entire app feature set lives here
│   └── LibraryView.tsx    # Central state + layout orchestrator
├── components/            # Shared UI primitives (AppShell, Sidebar, etc.)
├── lib/database.ts        # All SQLite queries and mutations
├── types/library.ts       # Core type definitions
└── styles/
    ├── index.css          # Tailwind + CSS custom properties (design tokens)
    └── designTokens.ts    # Utility functions for tone/status → class mappings
```

State is managed with plain React hooks (`useState`, `useCallback`, `useEffect`) — no Redux or Zustand. Navigation uses a custom `LibraryRoute` discriminated union instead of React Router.

### Database Schema

The SQLite schema (initialized as a single migration in [src-tauri/src/lib.rs](src-tauri/src/lib.rs)) includes:

- `Collections`, `Documents`, `Authors`, `Tags`, `Document_Tags` tables
- `documents_fts` — FTS5 virtual table for full-text search
- Cascading deletes on foreign keys
- 30-day auto-purge trigger for trashed items

Arrays (e.g., authors) are stored as strings joined by `char(31)` (unit separator) and split on read.

### Key Types

Defined in [src/types/library.ts](src/types/library.ts):

- `LibraryDocument` — the main document entity (title, authors, tags, status, progress, notes, reading location)
- `DocumentStatus` — `"not-started" | "in-progress" | "completed" | "error" | "trashed"`
- `Tone` — `"violet" | "indigo" | "blue" | "teal" | "rose" | "amber"` (tag color schemes)
- `ReadingLocation` — scroll ratio, page number, zoom level for resume-reading

### Design System

Color tokens are CSS custom properties defined in [src/styles/index.css](src/styles/index.css) (surfaces, text, sidebar, primary, tag tones, status). Tailwind is configured with these tokens in [tailwind.config.cjs](tailwind.config.cjs). Mapping helpers (tone → Tailwind classes, status → badge style) live in [src/styles/designTokens.ts](src/styles/designTokens.ts).

The UI language is pt-BR throughout.

### Pre-defined Tag Categories

The app ships with a fixed tag taxonomy: `ML`, `Sistemas/Infra`, `PLN`, `Visão Computacional`, `Teoria/Matemática`, `Segurança IA/Ética`. New tags can be added but these are the seeds in [src/data/mockDocuments.ts](src/data/mockDocuments.ts).
