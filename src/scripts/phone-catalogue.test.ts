import { describe, expect, it } from 'vitest';
import {
  engineById,
  groupedLanguageOptions,
  keepLanguage,
  languageLabel,
  languageOptions,
  tierOptions,
  usableCallerIds,
  validateDial,
  type EngineOption,
  type LanguageCatalogue,
} from './phone-catalogue';

const CATALOGUE: LanguageCatalogue = {
  regions: ['Europe', 'Asia'],
  languages: [
    {
      code: 'it',
      native: 'Italiano',
      english: 'Italian',
      region: 'Europe',
      rtl: false,
      flag: '🇮🇹',
    },
    { code: 'en', native: 'English', english: 'English', region: 'Europe', rtl: false, flag: '🇬🇧' },
    { code: 'zh', native: '中文', english: 'Chinese', region: 'Asia', rtl: false, flag: '🇨🇳' },
    { code: 'ar', native: 'العربية', english: 'Arabic', region: 'Asia', rtl: true, flag: '🇸🇦' },
  ],
};

const STANDARD: EngineOption = {
  id: 'standard',
  display_name: 'Standard',
  tier: 'standard',
  rate_per_minute: 0.0045,
  input_languages: ['it', 'en', 'zh'],
  output_languages: ['it', 'en', 'zh'],
};

const ENHANCED: EngineOption = {
  id: 'cartesia',
  display_name: 'Enhanced',
  tier: 'enhanced',
  rate_per_minute: 0.0666,
  input_languages: ['it', 'en'],
  output_languages: ['it', 'en'],
};

const ENGINES = [STANDARD, ENHANCED];

describe('languageLabel', () => {
  it('names a language the way the call app does — native first', () => {
    expect(languageLabel(CATALOGUE.languages[0])).toContain('Italiano');
  });

  it('adds the English name when it differs, so a picker is searchable in one language', () => {
    const zh = languageLabel(CATALOGUE.languages[2]);
    expect(zh).toContain('中文');
    expect(zh).toContain('Chinese');
  });

  it('does not repeat itself when native and English agree', () => {
    // "English — English" is noise, and it is the language most people scan for.
    expect(languageLabel(CATALOGUE.languages[1])).toBe('🇬🇧 English');
  });
});

describe('languageOptions', () => {
  it('offers only what the engine can actually speak', () => {
    const codes = languageOptions(CATALOGUE, STANDARD.output_languages).map((o) => o.code);
    expect(codes).toEqual(expect.arrayContaining(['it', 'en', 'zh']));
    // Arabic is in the catalogue but not in this engine's list. Offering it would let the
    // user pick a language the engine will refuse, which surfaces as a failed call.
    expect(codes).not.toContain('ar');
  });

  it('ignores a code the engine claims but the catalogue has never heard of', () => {
    // The two sources are deployed separately; an option with no name is unusable.
    const codes = languageOptions(CATALOGUE, ['it', 'kl']).map((o) => o.code);
    expect(codes).toEqual(['it']);
  });

  it('returns nothing when the engine lists nothing, rather than the whole catalogue', () => {
    // Falling back to "everything" here would quietly re-introduce the bug this module
    // exists to prevent: offering languages the engine cannot serve.
    expect(languageOptions(CATALOGUE, [])).toEqual([]);
  });

  it('carries the rtl flag through, so a picker can render Arabic correctly', () => {
    const ar = languageOptions(CATALOGUE, ['ar'])[0];
    expect(ar.rtl).toBe(true);
  });
});

describe('groupedLanguageOptions', () => {
  it('groups by region in the catalogue order, not alphabetically', () => {
    const groups = groupedLanguageOptions(CATALOGUE, ['zh', 'it', 'en']);
    expect(groups.map((g) => g.region)).toEqual(['Europe', 'Asia']);
    expect(groups[0].options.map((o) => o.code)).toEqual(['it', 'en']);
    expect(groups[1].options.map((o) => o.code)).toEqual(['zh']);
  });

  it('drops a region with nothing in it', () => {
    const groups = groupedLanguageOptions(CATALOGUE, ['zh']);
    expect(groups.map((g) => g.region)).toEqual(['Asia']);
  });
});

describe('tierOptions', () => {
  it('lists every engine with its user-facing rate', () => {
    const opts = tierOptions(ENGINES);
    expect(opts.map((o) => o.id)).toEqual(['standard', 'cartesia']);
    expect(opts[0].rate_per_minute).toBe(0.0045);
  });
});

describe('engineById', () => {
  it('finds an engine', () => {
    expect(engineById(ENGINES, 'cartesia')?.tier).toBe('enhanced');
  });

  it('returns null for an id it does not know, rather than the first engine', () => {
    // Silently falling back to engine[0] would bill the user for a tier they did not pick.
    expect(engineById(ENGINES, 'premium')).toBeNull();
    expect(engineById(ENGINES, '')).toBeNull();
  });
});

describe('keepLanguage', () => {
  it('keeps a selection the new engine still supports', () => {
    expect(keepLanguage(ENHANCED, 'it', 'output')).toBe(true);
  });

  it('drops a selection the new engine cannot serve', () => {
    // Switching Standard -> Enhanced with Chinese selected must clear it. Leaving it
    // selected sends a language the engine will refuse (spec 0112 R1).
    expect(keepLanguage(ENHANCED, 'zh', 'output')).toBe(false);
  });

  it('reads the input list for the caller and the output list for the recipient', () => {
    const lopsided: EngineOption = {
      ...STANDARD,
      input_languages: ['it'],
      output_languages: ['zh'],
    };
    expect(keepLanguage(lopsided, 'it', 'input')).toBe(true);
    expect(keepLanguage(lopsided, 'it', 'output')).toBe(false);
    expect(keepLanguage(lopsided, 'zh', 'output')).toBe(true);
    expect(keepLanguage(lopsided, 'zh', 'input')).toBe(false);
  });

  it('drops an empty selection', () => {
    expect(keepLanguage(STANDARD, '', 'output')).toBe(false);
  });
});

describe('validateDial', () => {
  const ok = {
    destination: '+8613800138000',
    sourceLanguage: 'it',
    targetLanguage: 'zh',
    engineId: 'standard',
    projectId: null as string | null,
  };

  it('accepts a complete request', () => {
    expect(validateDial(ok, { engines: ENGINES, requireProject: false })).toBeNull();
  });

  it('refuses an empty source language instead of sending one', () => {
    // This is the shipped bug (spec 0112 D1): `?.value ?? "en"` yields "" because `??`
    // does not catch the empty string, so every call carried an empty language.
    expect(
      validateDial({ ...ok, sourceLanguage: '' }, { engines: ENGINES, requireProject: false }),
    ).toEqual({ field: 'source', key: 'phone.error.sourceLanguageRequired' });
  });

  it('refuses an empty target language', () => {
    expect(
      validateDial({ ...ok, targetLanguage: '' }, { engines: ENGINES, requireProject: false }),
    ).toEqual({ field: 'target', key: 'phone.error.targetLanguageRequired' });
  });

  it('refuses a language the chosen engine does not support', () => {
    expect(
      validateDial(
        { ...ok, engineId: 'cartesia', targetLanguage: 'zh' },
        { engines: ENGINES, requireProject: false },
      ),
    ).toEqual({ field: 'target', key: 'phone.error.languageNotInTier' });
  });

  it("refuses a destination that is not dialable, in the server's own vocabulary", () => {
    // Reuses `phone.reason.number_*`, already translated in all five locales for exactly
    // these cases, rather than inventing a vaguer key beside them.
    expect(
      validateDial({ ...ok, destination: 'nope' }, { engines: ENGINES, requireProject: false }),
    ).toEqual({ field: 'destination', key: 'phone.reason.number_non_numeric' });
    expect(
      validateDial({ ...ok, destination: '+39 320' }, { engines: ENGINES, requireProject: false }),
    ).toEqual({ field: 'destination', key: 'phone.reason.number_too_short' });
  });

  it('refuses an unknown engine rather than picking one', () => {
    expect(
      validateDial({ ...ok, engineId: 'ghost' }, { engines: ENGINES, requireProject: false }),
    ).toEqual({ field: 'tier', key: 'phone.error.tierRequired' });
  });

  it('requires a project only when the organisation says so', () => {
    expect(validateDial(ok, { engines: ENGINES, requireProject: false })).toBeNull();
    expect(validateDial(ok, { engines: ENGINES, requireProject: true })).toEqual({
      field: 'project',
      key: 'phone.error.projectRequired',
    });
    expect(
      validateDial({ ...ok, projectId: 'p1' }, { engines: ENGINES, requireProject: true }),
    ).toBeNull();
  });

  it('reports the destination before the languages', () => {
    // The number is the field the user typed first and the one the server checks first
    // (`a_number_that_is_not_e164_is_refused_before_anything_else`). Reporting a language
    // problem on an unparseable number sends them to fix the wrong field.
    expect(
      validateDial(
        { ...ok, destination: 'nope', sourceLanguage: '', targetLanguage: '' },
        { engines: ENGINES, requireProject: false },
      ),
    ).toEqual({ field: 'destination', key: 'phone.reason.number_non_numeric' });
  });
});

describe('usableCallerIds', () => {
  const numbers = [
    {
      id: '1',
      e164: '+390212345678',
      country: 'IT',
      label: 'Milan Office',
      is_default: true,
      inbound_enabled: false,
      outbound_enabled: true,
      verification_status: 'verified',
    },
    {
      id: '2',
      e164: '+34911234567',
      country: 'ES',
      label: 'Sales Spain',
      is_default: false,
      inbound_enabled: false,
      outbound_enabled: true,
      verification_status: 'pending',
    },
    {
      id: '3',
      e164: '+390687654321',
      country: 'IT',
      label: 'Fax',
      is_default: false,
      inbound_enabled: false,
      outbound_enabled: false,
      verification_status: 'verified',
    },
    {
      id: '4',
      e164: '+390612345678',
      country: 'IT',
      label: 'Rejected',
      is_default: false,
      inbound_enabled: false,
      outbound_enabled: true,
      verification_status: 'rejected',
    },
  ];

  it('offers only a number that is both verified and outbound-enabled', () => {
    // `resolve_caller_id` on the server refuses anything else, so offering it would
    // produce a refusal after the user had already chosen. Same rule, stated early.
    expect(usableCallerIds(numbers).map((n) => n.e164)).toEqual(['+390212345678']);
  });

  it('offers nothing rather than something fabricated when the org owns nothing', () => {
    expect(usableCallerIds([])).toEqual([]);
  });
});
