# SYNKRA Design

An all-in-one, browser-based design studio: posters, social posts, stories, slides, invitations, resumes, thumbnails and business cards. Start from a template or a blank page, edit everything, and export PNG, JPG, SVG, PDF, MP4, WebM or GIF.

## Product areas

- **Home** — the dashboard you land on after signing up or logging in.
- **Design Studio** — the complete editor: templates, brand kits, uploads, folders, starring, trash, sharing with comments, animation, background removal, presenter view and in-browser exports.
- **Video Editor** — a future product area (stub).
- **AI Studio** — a future product area (stub).

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript
- Tailwind CSS 4 + CSS Modules with a shared token layer (`studio/styles/tokens.css`, `studio/styles/synku.css`)
- Prisma ORM (SQLite), Zustand, TanStack Query
- Fabric v7 editing engine, yjs realtime (mini-service under `mini-services/realtime`)
- Design language: Soft Bento Minimalism (see `docs` in the design spec)

## Getting started

```bash
bun install
cp .env.example .env          # then adjust paths if needed
bun run db:push               # create the database schema
bunx tsx scripts/seed.ts      # seed templates, fonts, element packs, audio and the background-removal model
bun run dev                   # http://localhost:3000
```

Quality checks:

```bash
bun run lint
```

## Project layout

| Path | Purpose |
| --- | --- |
| `src/app` | Next.js host: metadata, the catch-all route that mounts the studio, `/api/v1` service endpoints, `/media` file handler |
| `src/server` | Service layer: auth, designs, sharing, library, files, email |
| `studio/` | The studio application (marketing pages, auth, dashboard, editor, presenter view) |
| `prisma/` | Database schema |
| `scripts/seed.ts` | Content seeding (templates, fonts, elements, audio, models) |
| `mini-services/realtime` | Realtime collaboration WebSocket service |
| `public/` | Static assets and the web manifest |

## License

Portions of this software are built on the Doory editor and are released under the Attribution Assurance License — see `LICENSE` and `LICENSE-AUTHORS.md`.
