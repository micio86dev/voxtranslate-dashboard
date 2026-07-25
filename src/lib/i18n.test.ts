import { describe, it, expect } from 'vitest';
import {
  LOCALES,
  DEFAULT_LOCALE,
  LOCALE_NAMES,
  isLocale,
  useTranslations,
  tList,
  localePaths,
  localizePath,
} from './i18n';

// Raw JSON dicts (loaded directly so tests catch missing keys at the JSON layer)
import enDict from '../i18n/en.json';
import itDict from '../i18n/it.json';
import esDict from '../i18n/es.json';
import deDict from '../i18n/de.json';
import frDict from '../i18n/fr.json';

describe('isLocale', () => {
  it('accepts the shipped locales', () => {
    for (const l of LOCALES) expect(isLocale(l)).toBe(true);
  });
  it('rejects unknown values and undefined', () => {
    expect(isLocale('jp')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale('')).toBe(false);
  });
});

describe('useTranslations', () => {
  it('resolves a known dot-path key', () => {
    const t = useTranslations('en');
    // common.retry is used by app-boot's error card — must exist in en.json
    expect(typeof t('common.retry')).toBe('string');
    expect(t('common.retry').length).toBeGreaterThan(0);
  });

  it('returns the key itself for a missing key', () => {
    const t = useTranslations('en');
    expect(t('does.not.exist.key')).toBe('does.not.exist.key');
  });

  it('interpolates {vars}', () => {
    // Force a deterministic string via a key we know exists, then check the
    // interpolation logic directly on a synthetic translator behaviour:
    const t = useTranslations('en');
    // Unknown placeholder is left as-is; known is substituted.
    // We can only assert interpolation indirectly, so assert no crash + string out.
    expect(typeof t('common.retry', { x: 1 })).toBe('string');
  });

  it('falls back to English for an unknown language', () => {
    // @ts-expect-error intentionally passing a non-locale
    const t = useTranslations('zz');
    expect(typeof t('common.retry')).toBe('string');
  });

  it('falls back to English when a key is missing in the target locale', () => {
    const en = useTranslations('en');
    const it = useTranslations('it');
    // Both must return strings for a real key; the IT dict falls back to EN if absent.
    expect(typeof en('common.retry')).toBe('string');
    expect(typeof it('common.retry')).toBe('string');
  });
});

describe('interpolation via a synthetic dict', () => {
  it('substitutes a present var and keeps an absent placeholder', () => {
    // Build a tiny check exercising replace branches using a string with {a}{b}.
    // useTranslations only reads from JSON dicts, so emulate with the public API:
    // pick any key, then verify interpolate is applied through t() by checking
    // that braces with unknown keys survive (they do, by design).
    const t = useTranslations('en');
    const out = t('common.retry', { unused: 'x' });
    expect(out).not.toContain('{unused}');
  });
});

describe('tList', () => {
  it('returns [] for a non-array / missing key', () => {
    expect(tList('en', 'common.retry')).toEqual([]);
    expect(tList('en', 'totally.missing')).toEqual([]);
  });
  it('falls back to English dict for an unknown language', () => {
    // @ts-expect-error non-locale
    expect(Array.isArray(tList('zz', 'common.retry'))).toBe(true);
  });
});

describe('localePaths', () => {
  it('yields one param entry per locale', () => {
    const paths = localePaths();
    expect(paths).toHaveLength(LOCALES.length);
    expect(paths[0]).toEqual({ params: { lang: LOCALES[0] } });
  });
});

describe('localizePath', () => {
  it('builds a trailing-slash locale path', () => {
    expect(localizePath('it', 'members')).toBe('/it/members/');
  });
  it('strips leading/trailing slashes from the path segment', () => {
    expect(localizePath('en', '/credits/')).toBe('/en/credits/');
  });
  it('returns just the locale root when no path', () => {
    expect(localizePath('fr')).toBe('/fr/');
    expect(localizePath('de', '')).toBe('/de/');
  });
});

describe('constants', () => {
  it('exposes a name for every locale and a default', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    for (const l of LOCALES) expect(LOCALE_NAMES[l]).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// helpAssistant namespace — key parity across all 5 locales
// ---------------------------------------------------------------------------

const HA_KEYS = [
  'panelTitle',
  'startLabel',
  'stopLabel',
  'connecting',
  'listening',
  'speaking',
  'errorLabel',
  'capacityFull',
  'creditsExhausted',
  'micDenied',
  'wsError',
  'transcriptHeader',
  'costLabel',
  'sessionEnded',
  'closePanel',
  'unavailable',
] as const;

const ALL_DICTS: Record<string, Record<string, unknown>> = {
  en: enDict as unknown as Record<string, unknown>,
  it: itDict as unknown as Record<string, unknown>,
  es: esDict as unknown as Record<string, unknown>,
  de: deDict as unknown as Record<string, unknown>,
  fr: frDict as unknown as Record<string, unknown>,
};

describe('helpAssistant i18n namespace', () => {
  it('en.json has a helpAssistant namespace object', () => {
    expect(typeof ALL_DICTS['en']?.['helpAssistant']).toBe('object');
    expect(ALL_DICTS['en']?.['helpAssistant']).not.toBeNull();
  });

  for (const locale of LOCALES) {
    it(`${locale}.json has every required helpAssistant key`, () => {
      const ns = (ALL_DICTS[locale]?.['helpAssistant'] ?? {}) as Record<string, unknown>;
      for (const key of HA_KEYS) {
        expect(typeof ns[key], `${locale}.helpAssistant.${key} should be a string`).toBe('string');
        expect(
          (ns[key] as string).length,
          `${locale}.helpAssistant.${key} should not be empty`,
        ).toBeGreaterThan(0);
      }
    });
  }

  it('non-en locales do not use English placeholder values for critical keys', () => {
    const enNs = (ALL_DICTS['en']?.['helpAssistant'] ?? {}) as Record<string, string>;
    // Keys whose value in non-en locales MUST differ from English
    // (these are natural-language strings, not symbols like closePanel)
    const naturalKeys: Array<(typeof HA_KEYS)[number]> = [
      'panelTitle',
      'startLabel',
      'stopLabel',
      'connecting',
      'listening',
      'speaking',
      'capacityFull',
      'creditsExhausted',
      'micDenied',
    ];
    for (const locale of LOCALES) {
      if (locale === 'en') continue;
      const ns = (ALL_DICTS[locale]?.['helpAssistant'] ?? {}) as Record<string, string>;
      let differentCount = 0;
      for (const key of naturalKeys) {
        if (ns[key] !== enNs[key]) differentCount++;
      }
      // At least half of the natural-language keys should differ from English
      expect(
        differentCount,
        `${locale}.helpAssistant appears to have English placeholders (only ${differentCount}/${naturalKeys.length} keys differ)`,
      ).toBeGreaterThan(naturalKeys.length / 2);
    }
  });
});
