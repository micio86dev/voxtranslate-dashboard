// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Canonical origin (authenticated B2B app). Served on Vercel.
// `import.meta.env` does not exist in the Astro config, so read process.env here.
const SITE = (process.env.PUBLIC_SITE_ORIGIN || 'https://dashboard.voxtranslate.app').replace(
  /\/$/,
  '',
);

// 5 app locales. Keep in sync with src/i18n/*.json and src/lib/i18n.ts.
export const LOCALES = ['en', 'it', 'es', 'de', 'fr'];

export default defineConfig({
  site: SITE,
  // Static prerender → flat files in dist/, deployed to Vercel.
  // The app is auth-gated client-side; data is fetched at runtime from the API.
  output: 'static',
  trailingSlash: 'always',
  i18n: {
    defaultLocale: 'en',
    locales: LOCALES,
    routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false },
  },
  vite: {
    // Cast: astro's bundled vite types and the top-level vite/tailwind types drift,
    // producing a benign Plugin<->PluginOption mismatch under `astro check`.
    plugins: [/** @type {any} */ (tailwindcss())],
  },
});
