import { describe, expect, it } from 'vitest';
import {
  anyOpen,
  FALLBACK_LANGUAGES,
  languageOptions,
  pageWindow,
  sessionsQuery,
  type SessionFilters,
} from './filters';
import { dayStartIso, nextDayStartIso } from './range';

const empty: SessionFilters = { status: '', projectId: '', deskId: '', from: '', to: '' };

describe('sessionsQuery', () => {
  it('is empty filters and the first page by default', () => {
    expect(sessionsQuery(empty, 1, 25)).toEqual({ limit: 25 });
  });

  it('maps every filter, turning day inputs into local-day bounds', () => {
    const q = sessionsQuery(
      { status: 'active', projectId: 'p1', deskId: 'd1', from: '2026-03-01', to: '2026-03-31' },
      3,
      25,
    );
    expect(q).toEqual({
      status: 'active',
      project_id: 'p1',
      desk_id: 'd1',
      from: dayStartIso('2026-03-01'),
      to: nextDayStartIso('2026-03-31'),
      limit: 25,
      offset: 50,
    });
  });

  it('ignores a status the server would refuse', () => {
    expect(sessionsQuery({ ...empty, status: 'bogus' }, 1, 25).status).toBeUndefined();
  });

  it('ignores a half-typed date rather than sending garbage', () => {
    expect(sessionsQuery({ ...empty, from: '2026-3-1' }, 1, 25).from).toBeUndefined();
  });

  it('never asks for more than the server allows (100) or less than one', () => {
    expect(sessionsQuery(empty, 1, 500).limit).toBe(100);
    expect(sessionsQuery(empty, 1, 0).limit).toBe(1);
    expect(sessionsQuery(empty, 0, 25).offset).toBeUndefined();
  });
});

describe('anyOpen', () => {
  it('is true while any listed conversation is waiting or active', () => {
    expect(anyOpen([{ status: 'ended' }, { status: 'active' }])).toBe(true);
    expect(anyOpen([{ status: 'waiting' }])).toBe(true);
    expect(anyOpen([{ status: 'ended' }, { status: 'expired' }])).toBe(false);
    expect(anyOpen([])).toBe(false);
  });
});

describe('pageWindow', () => {
  it('describes the visible slice and which neighbours exist', () => {
    expect(pageWindow({ total: 60, offset: 0, count: 25 })).toEqual({
      from: 1,
      to: 25,
      total: 60,
      hasPrev: false,
      hasNext: true,
    });
    expect(pageWindow({ total: 60, offset: 50, count: 10 })).toMatchObject({
      from: 51,
      to: 60,
      hasPrev: true,
      hasNext: false,
    });
  });
  it('is empty for no rows', () => {
    expect(pageWindow({ total: 0, offset: 0, count: 0 })).toMatchObject({
      from: 0,
      to: 0,
      hasPrev: false,
      hasNext: false,
    });
  });
});

describe('languageOptions', () => {
  it('names the catalogue languages in the viewer language, sorted by name', () => {
    const opts = languageOptions(
      [
        {
          code: 'it',
          native: 'Italiano',
          english: 'Italian',
          region: 'Europe',
          rtl: false,
          flag: 'IT',
        },
        {
          code: 'en',
          native: 'English',
          english: 'English',
          region: 'Europe',
          rtl: false,
          flag: 'GB',
        },
      ],
      'en',
    );
    expect(opts).toEqual([
      { code: 'en', label: 'English' },
      { code: 'it', label: 'Italian' },
    ]);
  });

  it('falls back to a built-in list when the catalogue is unavailable', () => {
    const opts = languageOptions(null, 'en');
    expect(opts.map((o) => o.code)).toEqual(expect.arrayContaining(['en', 'it', 'es', 'de', 'fr']));
    expect(opts).toHaveLength(FALLBACK_LANGUAGES.length);
    expect(languageOptions([], 'en')).toHaveLength(FALLBACK_LANGUAGES.length);
  });
});
