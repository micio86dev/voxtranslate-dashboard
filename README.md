# voxtranslate-dashboard

**VoxTranslate for Business** — the authenticated B2B organization dashboard (Astro 5).
Lives as a git submodule at `dashboard/` inside the main VoxTranslate repo, with its own
deploy pipeline (separate from the consumer call app).

Org owners and members manage their workspace here: members & invites, teams, projects,
scheduled meetings, call history & transcripts, analytics, notifications, and
**credits & subscriptions** (Business / Enterprise plans).

## Stack

- **Astro 5** — static SSG (`output: 'static'`, `trailingSlash: 'always'`)
- **Tailwind CSS v4** via `@tailwindcss/vite` (tokens in `src/styles/global.css`)
- **i18n** — Astro native routing, 5 locales: `en` (default), `it`, `es`, `de`, `fr`
- **Auth** — Sign in with Google (GSI) → `POST {API}/api/auth/google` → JWT in `localStorage`
- **Data** — Rust API under `/api/business/...` (typed client in `src/lib/api.ts`)
- **Hosting** — Vercel (project `voxtranslate-dashboard`, `https://dashboard.voxtranslate.app`)

## Run locally

```bash
npm install
PUBLIC_API_BASE=http://localhost:3001 PUBLIC_GOOGLE_CLIENT_ID=… npm run dev
npm run typecheck   # astro check
npm run lint        # prettier --check
npm run build       # static output → dist/
```

## Environment

| Variable | Description |
|---|---|
| `PUBLIC_API_BASE` | Rust API origin, no trailing slash. Local: `http://localhost:3001`; prod: `https://api.voxtranslate.app`. |
| `PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth client id (same project as the call app). |

Both are `PUBLIC_` (client-side) values baked into the JS at build time. Production values
live in a **committed** `.env.production` (read by `astro build`), so every build — local or
on Vercel — bakes the correct API base + client id without relying on provider env vars.

## Branching & deploy (Git Flow)

| Branch | Purpose | Deploy |
|---|---|---|
| `feature/<name>` | work, off `develop` | preview |
| `develop` | integration | **staging** |
| `release/<X.Y.Z>` | release prep off `develop` (bump version, tag `vX.Y.Z`) | — |
| `main` | production | **prod** |
| `hotfix/<name>` | urgent prod fix off `main` | via release to `main` |

Merge with `--no-ff`; after every merge, delete the closed branch locally **and** on the
remote. Releases merge into both `main` (tagged) and `develop`.

See `CLAUDE.md` for architecture, conventions, and directory structure.
