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
- **Hosting:** Cloudflare Pages (static), like the marketing site.

## Directory structure

```
src/
  components/layout/Header.astro
  layouts/BaseLayout.astro
  lib/{auth,api,i18n}.ts
  scripts/app-boot.ts          # auth gate + org load + header wiring (org-scoped pages)
  pages/
    index.astro                # root: soft browser-lang redirect
    [lang]/index.astro         # login gate (Google sign-in)
    [lang]/onboarding.astro    # create first org
    [lang]/dashboard.astro     # overview + org switcher
    [lang]/members.astro       # members + invite modal + roles
    [lang]/projects/{index,new,detail}.astro
    [lang]/join.astro          # accept an invite (?token=)
  i18n/{en,it,es,de,fr}.json
  styles/global.css
public/{favicon.svg,_headers}
```

## Conventions

- Files: kebab-case. Components: PascalCase `.astro`. All copy via `useTranslations(lang)` →
  `t('key')`; never hardcode strings. Dynamic resource ids use a `?id=`/`?token=` query param
  (the app is static, so no `[id]` prerender).
- Commits: Conventional Commits. Branches: `main` = production.

## Environment

| Variable | Description |
|---|---|
| `PUBLIC_API_BASE` | Rust API origin (Railway), no trailing slash. Local: `http://localhost:3001`. |
| `PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth client id (same project as the call app). |

The API server's `ALLOWED_ORIGINS` must include this app's origin (CORS).

## Run locally

```bash
npm install
PUBLIC_API_BASE=http://localhost:3001 PUBLIC_GOOGLE_CLIENT_ID=… npm run dev
npm run typecheck && npm run build
```
