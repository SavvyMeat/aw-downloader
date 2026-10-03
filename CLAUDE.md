# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AW Downloader automates anime downloads from AnimeWorld with Sonarr integration. It syncs monitored anime series from Sonarr, finds missing episodes, and queues them for download. The app is distributed as a single Docker container exposing port 6547.

## Development Commands

### Backend (`backend/`) 
```bash
npm run dev        # Dev server with HMR
npm run build      # Compile TypeScript
npm start          # Production server
npm test           # Run Jest tests
npm run lint       # ESLint
npm run typecheck  # TypeScript check (noEmit)
```

### Frontend (`frontend/`)
```bash
npm run dev    # Dev server
npm run build  # Static export to ./build
npm run lint   # ESLint
```

### Docker
```bash
docker compose up --build   # Build and run full stack
```

The entrypoint auto-runs database migrations before starting. `compose.yaml` reads `APP_KEY` from a `.env` file next to it (gitignored); generate a key with `openssl rand -base64 24` or `docker run ... keygen`.

### Sandbox environment
A stack separate from the real AW instance, for manual testing: Sonarr + Radarr (pinned to the versions in use) + the local AW build. Web UIs on localhost: Sonarr :18989, Radarr :17878, AW :16547.
```bash
docker compose -f compose.sandbox.yaml up -d --build --wait   # start the sandbox
docker compose -f compose.sandbox.yaml run --rm tests         # optional: configure it and run sandbox/tests/*.test.mjs
docker compose -f compose.sandbox.yaml down -v                # stop and wipe all data
```
AW uses the real AnimeWorld (searches and download links), so internet is required. By default `sandbox/hooks/redirect-downloads.mjs`, preloaded into AW via `NODE_OPTIONS`, redirects every video download to a short generated video served by the `fixtures` service; start the stack with `SANDBOX_FAKE_DOWNLOADS=false` to download the real files. The automated tests go through the real AW tasks (`fetch_wanted`, `fetch_wanted_films`); `sandbox/tests/setup.mjs` is idempotent (test series: SAKAMOTO DAYS, test film: One Piece Film Red), but the tests need episodes S01E01–S01E05 without files, so use `down -v` before re-running them.

## Architecture

**Backend**: AdonisJS 6 (TypeScript) + SQLite (better-sqlite3) + Lucid ORM  
**Frontend**: Next.js 16 + React 19 + Tailwind CSS 4 + Radix UI  
**Notifications**: Apprise (installed in Docker image)  

### Database Schema (5 tables)
- `series` — Sonarr-synced anime, tracks title, status, poster, preferred language, absolute numbering flag
- `seasons` — AnimeWorld identifiers stored as JSON array (for multi-part anime)
- `configs` — Key-value store for all app settings
- `root_folders` — Maps Sonarr paths to container-local paths
- `notifications` — Notification configs with per-event filtering

### Backend Key Services (`backend/app/services/`)
- **MetadataSyncService** — Orchestrates full sync: Sonarr → AniList/Jikan → AnimeWorld identifier search → poster cache
- **AnimeworldService** — Scrapes AnimeWorld (Cheerio + cookie jar, SSL disabled), respects dub/sub preference
- **SonarrService** — Wraps Sonarr REST API with caching via AdonisJS cache service
- **DownloadQueue** — EventEmitter-based queue; configurable concurrency (1–10); emits success/error for notifications
- **NotificationService** — Sends Apprise notifications on download events

### Scheduled Tasks (`backend/app/tasks/`)
Three cron-scheduled tasks managed by a `CronHelper` singleton:
1. **UpdateMetadataTask** (default 120 min) — Sync series/seasons from Sonarr + AnimeWorld
2. **FetchWantedTask** (default 30 min) — Pull missing episodes from Sonarr, enqueue them
3. **DownloadEpisodesTask** (continuous) — Process queue, trigger Sonarr rename on success

### REST API (`/api/*`)
`series`, `seasons`, `tasks`, `configs`, `download-queue`, `logs`, `root-folders`, `notifications`, `health`, `sonarr`

All routes defined in `backend/start/routes.ts`.

## Key Conventions

- **Path aliases**: Backend imports use `#` prefix (e.g. `#services/sonarr`) — configured in `backend/package.json` `imports` field
- **Multi-part anime**: A season can have multiple AnimeWorld identifiers stored as a JSON array in `seasons.identifiers`
- **Absolute numbering**: Some series have `absoluteNumbering: true` — episodes are numbered continuously across seasons
- **Language preference**: Per-series dub/sub preference stored in `series.preferredLanguage`
- **UI language**: UI and log messages are in Italian
- **Poster caching**: Posters fetched from Sonarr and cached locally, refreshed every 48 hours

## Docker Notes

- Runs rootless; mounted volumes (`config/`, `data/`) need appropriate permissions for the container user
- `compose.yaml` mounts `./config` and `./data` and requires `APP_KEY` (from `.env`: `docker compose` stops with an error if it is missing)
- Cross-platform builds use QEMU via GitHub Actions workflow
