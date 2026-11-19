import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { liveErrorKey } from '../lib/api';
import { endReasonKey, statusKey } from '../scripts/live/format';
import de from './de.json';
import en from './en.json';
import es from './es.json';
import fr from './fr.json';
import italian from './it.json';

/**
 * The Live Connect copy (spec 0121). `parity.test.ts` proves the five files have the same
 * keys; this proves the keys the Live Connect code asks for exist at all (a typo in a key
 * renders the key itself, in every language, and parity cannot see it), and that the copy
 * was translated rather than pasted.
 */

type Tree = Record<string, unknown>;
const LOCALES: Record<string, Tree> = { en, it: italian, es, de, fr };

function flatten(node: Tree, prefix = ''): Record<string, string> {
  return Object.entries(node).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(acc, flatten(value as Tree, path));
    } else acc[path] = String(value);
    return acc;
  }, {});
}

const EN = flatten(en);
const ROOT = join(__dirname, '..');

function sources(): { file: string; text: string }[] {
  const dirs = [
    join(ROOT, 'pages', '[lang]', 'live'),
    join(ROOT, 'components', 'live'),
    join(ROOT, 'scripts', 'live'),
  ];
  const files = dirs.flatMap((d) =>
    readdirSync(d)
      .filter((f) => /\.(astro|ts)$/.test(f) && !f.endsWith('.test.ts'))
      .map((f) => join(d, f)),
  );
  files.push(join(ROOT, 'pages', '[lang]', 'search.astro'));
  return files.map((file) => ({ file, text: readFileSync(file, 'utf8') }));
}

describe('Live Connect keys used by the code', () => {
  it('every literal live.* and search.* key exists in en.json', () => {
    const missing: string[] = [];
    for (const { file, text } of sources()) {
      for (const m of text.matchAll(/['"`]((?:live|search)\.[A-Za-z0-9_.]+)['"`]/g)) {
        const key = m[1];
        // `live.usage.range.${…}` style prefixes end in a dot inside the quotes' interpolation.
        if (key.endsWith('.')) continue;
        if (!(key in EN)) missing.push(`${file.replace(ROOT, 'src')}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every key built from a value exists (status, end reason, error, usage column, range)', () => {
    const keys = [
      ...['waiting', 'active', 'ended', 'expired', 'x'].map(statusKey),
      ...[
        'ended_by_host',
        'ended_by_guest',
        'ended_by_staff',
        'ended_by_billing',
        'billing_error',
        'expired',
        'abandoned',
        'max_duration',
        'desk_revoked',
        'desk_regenerated',
        'something-new',
      ].map((r) => endReasonKey(r) as string),
      ...[
        'project_not_found',
        'name_required',
        'bad_lang',
        'bad_status',
        'bad_range',
        'bad_group',
        'session_not_found',
        'desk_not_found',
        'insufficient_credits',
        'subscription_required',
        'session_active',
        'already_answered',
        'session_ended',
        'session_expired',
        'rate_limited',
        'live_disabled',
        'live_busy',
        'try_again',
      ].map((code) => liveErrorKey({ status: 400, data: { code } })),
      ...[0, 401, 402, 403, 404, 429, 500].map((status) => liveErrorKey({ status })),
      ...['desk', 'project', 'day'].map((g) => `live.usage.col.${g}`),
      ...['required', 'order', 'tooLong'].map((e) => `live.usage.range.${e}`),
      ...['host', 'guest', 'staff', 'other'].map((r) => `live.role.${r}`),
    ];
    expect(keys.filter((k) => !(k in EN))).toEqual([]);
  });
});

describe('Live Connect copy across locales', () => {
  const live = Object.keys(EN).filter(
    (k) => k.startsWith('live.') || /^search\.(kind|lang|any|from|to|session)/.test(k),
  );

  it('has a non-trivial live catalogue', () => {
    expect(live.length).toBeGreaterThan(150);
  });

  // Identical to English is right for a brand, a loanword or a cognate; anything else was pasted.
  const SAME_AS_ENGLISH: Record<string, string[]> = {
    it: ['search.kindLive', 'live.nav', 'live.title', 'live.role.host', 'live.sessions.no'],
    es: ['search.kindLive', 'live.nav', 'live.title', 'live.sessions.no'],
    de: [
      'search.kindCall',
      'search.kindLive',
      'live.nav',
      'live.title',
      'live.sessions.status',
      'live.sessions.col.status',
      'live.sessions.col.credits',
      'live.detail.status',
      'live.desks.form.name',
      'live.usage.col.credits',
    ],
    fr: [
      'search.kindLabel',
      'search.kindLive',
      'live.nav',
      'live.title',
      'live.tabs.sessions',
      'live.status.active',
      'live.role.other',
      'live.sessions.title',
      'live.detail.title',
      'live.detail.participants',
      'live.usage.totalSessions',
      'live.usage.col.sessions',
    ],
  };

  for (const name of ['it', 'es', 'de', 'fr']) {
    const tree = flatten(LOCALES[name]);

    it(`${name}: no string was left in English by accident`, () => {
      const same = live.filter((k) => tree[k] === EN[k]).sort();
      expect(same).toEqual([...SAME_AS_ENGLISH[name]].sort());
    });

    it(`${name}: keeps every {placeholder} of the English string`, () => {
      const holders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      const broken = live.filter((k) => holders(tree[k]).join() !== holders(EN[k]).join());
      expect(broken).toEqual([]);
    });
  }
});
