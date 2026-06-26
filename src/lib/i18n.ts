/**
 * Lightweight i18n over src/i18n/*.json (mirrors the marketing site).
 *
 * URLs are locale-prefixed (/en/…, /it/…). `useTranslations(lang)` returns a
 * `t(key, vars?)` lookup with dot-path keys, {var} interpolation, and graceful
 * fallback to English for any missing key (the dashboard ships 5 locales; the
 * rest of the product's 84 locales fall back to English here).
 */
import en from '../i18n/en.json';
import it from '../i18n/it.json';
import es from '../i18n/es.json';
import de from '../i18n/de.json';
import fr from '../i18n/fr.json';

export const LOCALES = ['en', 'it', 'es', 'de', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  it: 'Italiano',
  es: 'Español',
  de: 'Deutsch',
  fr: 'Français',
};

type Dict = Record<string, unknown>;
const DICTS: Record<Locale, Dict> = { en, it, es, de, fr };

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

function lookup(dict: Dict, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Dict)) {
      return (acc as Dict)[part];
    }
    return undefined;
  }, dict);
}

function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Returns a translator bound to `lang`, falling back to English. */
export function useTranslations(lang: Locale) {
  const dict = DICTS[lang] ?? DICTS[DEFAULT_LOCALE];
  return function t(key: string, vars?: Record<string, string | number>): string {
    const value = lookup(dict, key) ?? lookup(DICTS[DEFAULT_LOCALE], key);
    if (typeof value === 'string') return interpolate(value, vars);
    return key; // surfaces missing keys instead of crashing
  };
}

/**
 * Reads an array value (e.g. a plan's feature bullets) for `lang`, falling back
 * to English. Returns `[]` when the key is missing or not a string array.
 */
export function tList(lang: Locale, key: string): string[] {
  const dict = DICTS[lang] ?? DICTS[DEFAULT_LOCALE];
  const value = lookup(dict, key) ?? lookup(DICTS[DEFAULT_LOCALE], key);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** All paths for `getStaticPaths` — one per locale. */
export function localePaths() {
  return LOCALES.map((lang) => ({ params: { lang } }));
}

/** Build a locale-prefixed path (trailing slash): localizePath('it','members') -> '/it/members/'. */
export function localizePath(lang: Locale, path = ''): string {
  const clean = path.replace(/^\/+/, '').replace(/\/+$/, '');
  return clean ? `/${lang}/${clean}/` : `/${lang}/`;
}
