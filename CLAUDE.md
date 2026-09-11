# CLAUDE.md — VoxTranslate for Business (dashboard)

Authenticated B2B organization dashboard for VoxTranslate. Lives as a git submodule
at `dashboard/` inside the main VoxTranslate repo; separate deploy from the call app.

## Stack

- **Framework:** Astro 5 (static SSG, `output: 'static'`, `trailingSlash: 'always'`)
- **Styling:** Tailwind CSS v4 via `@tailwindcss/vite` (tokens in `src/styles/global.css` with `@theme`)
- **i18n:** Astro native i18n routing — 5 locales: `en` (default), `it`, `es`, `de`, `fr`.
  The product's other 84 locales fall back to English here (`useTranslations`).
- **Auth:** Sign in with Google (GSI) → `POST {API}/api/auth/google` → JWT in `localStorage`
  (separate origin from the call app, so its own token). Route guarding is client-side.
- **Data:** all from the Rust API under `/api/business/...` (typed client in `src/lib/api.ts`).
- **Hosting:** Vercel (static SSG) — project `voxtranslate-dashboard`, served at
  `https://dashboard.voxtranslate.app`. Deploys via Vercel's Git integration.

## Directory structure

```
src/
  components/layout/Header.astro
  components/phone/SectionNav.astro
  layouts/BaseLayout.astro
  lib/{auth,api,i18n}.ts
  scripts/app-boot.ts          # auth gate + org load + header wiring (org-scoped pages)
  scripts/{phone-dialer,phone-catalogue}.ts  # pure dialer logic, unit-tested
  pages/
    index.astro                # root: soft browser-lang redirect
    [lang]/index.astro         # login gate (Google sign-in)
    [lang]/onboarding.astro    # create first org
    [lang]/dashboard.astro     # overview + org switcher
    [lang]/members.astro       # members + invite modal + roles
    [lang]/projects/{index,new,detail}.astro
    [lang]/phone.astro         # dialer (spec 0111)
    [lang]/phone/{calls,detail,settings}.astro   # history · one call · org policy (0112)
    [lang]/join.astro          # accept an invite (?token=)
    …                          # indicative, not exhaustive — history, webinars, credits,
                               # teams, analytics, search and insights also live here
  i18n/{en,it,es,de,fr}.json
  styles/global.css
public/{favicon.svg,_headers}
```

## Conventions

- Files: kebab-case. Components: PascalCase `.astro`. All copy via `useTranslations(lang)` →
  `t('key')`; never hardcode strings. Dynamic resource ids use a `?id=`/`?token=` query param
  (the app is static, so no `[id]` prerender).
- Commits: Conventional Commits. Branching follows **Git Flow** — see below.

## Branching & deploy (Git Flow)

This repo follows **Git Flow** (project-wide rule):

- `feature/<name>` — branch off `develop`; merge back into `develop` (`--no-ff`).
- `develop` — integration branch. Merging here triggers the **staging** deploy.
- `release/<X.Y.Z>` — cut from `develop` (three-number version, e.g. `release/0.2.0`):
  bump `package.json`, merge into `main` **and** back into `develop`, tag `vX.Y.Z`.
- `main` — production. Pushing it (release/hotfix close) triggers the **prod** deploy.
- `hotfix/<name>` — branch off `main` for urgent prod fixes; merge to `main` + `develop`.
- After every merge, **prune the closed branch locally and on the remote**.

## Environment

| Variable | Description |
|---|---|
| `PUBLIC_API_BASE` | Rust API origin, no trailing slash. Local: `http://localhost:3001`; prod: `https://api.voxtranslate.app`. |
| `PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth client id (same project as the call app). |

Both are `PUBLIC_` (client-side) values baked into the shipped JS at build time. They
live in a **committed** `.env.production` (read by `astro build`) — intentionally not
Vercel project env vars, so every build (local or on the host) bakes the right values.
A plain build with neither set falls back to `localhost:3001` (broken prod). See the
`dashboard-prod-deploy-bakes-localhost` note for the history.

The API server's `ALLOWED_ORIGINS` must include this app's origin (CORS).

## Run locally

```bash
npm install
PUBLIC_API_BASE=http://localhost:3001 PUBLIC_GOOGLE_CLIENT_ID=… npm run dev
npm run typecheck && npm run build
```
