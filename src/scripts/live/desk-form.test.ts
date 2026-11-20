import { describe, expect, it } from 'vitest';
import { deskPatch, normalizeLang, parseLanguages, validateDeskForm } from './desk-form';
import type { LiveDesk } from '../../lib/api';

const valid = {
  name: ' Front desk ',
  location: ' Milan, ground floor ',
  defaultLang: 'IT',
  languages: ['en', 'ES', 'en'],
  projectId: 'proj-1',
};

describe('normalizeLang (mirrors the server rule)', () => {
  it('lower-cases and trims a code of 1-8 letters, digits or dashes', () => {
    expect(normalizeLang(' PT-br ')).toBe('pt-br');
    expect(normalizeLang('en')).toBe('en');
  });
  it('refuses auto, empty, too long and odd characters', () => {
    expect(normalizeLang('auto')).toBeNull();
    expect(normalizeLang('')).toBeNull();
    expect(normalizeLang('abcdefghi')).toBeNull();
    expect(normalizeLang('en_US')).toBeNull();
    expect(normalizeLang('e n')).toBeNull();
  });
});

describe('parseLanguages', () => {
  it('splits a typed list on commas and spaces, dropping blanks', () => {
    expect(parseLanguages('en, it  es,, ')).toEqual(['en', 'it', 'es']);
    expect(parseLanguages('')).toEqual([]);
  });
});

describe('validateDeskForm', () => {
  it('returns the API body: trimmed, lower-cased, de-duplicated', () => {
    const r = validateDeskForm(valid);
    expect(r).toEqual({
      ok: true,
      input: {
        name: 'Front desk',
        location_label: 'Milan, ground floor',
        default_lang: 'it',
        languages: ['en', 'es'],
        project_id: 'proj-1',
      },
    });
  });

  it('a name is required', () => {
    const r = validateDeskForm({ ...valid, name: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.name).toBe('live.desks.form.nameRequired');
  });

  it('a name is at most 100 characters and a location at most 150', () => {
    const r = validateDeskForm({ ...valid, name: 'x'.repeat(101), location: 'y'.repeat(151) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.name).toBe('live.desks.form.nameTooLong');
      expect(r.errors.location).toBe('live.desks.form.locationTooLong');
    }
  });

  it('the project is mandatory', () => {
    const r = validateDeskForm({ ...valid, projectId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.projectId).toBe('live.desks.form.projectRequired');
  });

  it('the default language must be a real code', () => {
    for (const defaultLang of ['', 'auto', 'not a lang']) {
      const r = validateDeskForm({ ...valid, defaultLang });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.defaultLang).toBe('live.desks.form.langInvalid');
    }
  });

  it('every optional language must be valid, at most 20', () => {
    const bad = validateDeskForm({ ...valid, languages: ['en', 'auto'] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.languages).toBe('live.desks.form.langInvalid');
    const many = validateDeskForm({
      ...valid,
      languages: Array.from({ length: 21 }, (_, i) => `l${i}`),
    });
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.errors.languages).toBe('live.desks.form.tooManyLanguages');
  });

  it('an empty location is omitted, an empty language list is allowed', () => {
    const r = validateDeskForm({ ...valid, location: '  ', languages: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.location_label).toBe('');
      expect(r.input.languages).toEqual([]);
    }
  });
});

describe('deskPatch', () => {
  const desk: LiveDesk = {
    id: 'd1',
    org_id: 'o1',
    project_id: 'proj-1',
    name: 'Front desk',
    location_label: 'Milan',
    default_lang: 'it',
    languages: ['en'],
    public_id: 'abc',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
  };
  const input = {
    name: 'Front desk',
    location_label: 'Milan',
    default_lang: 'it',
    languages: ['en'],
    project_id: 'proj-1',
  };

  it('sends only what changed', () => {
    expect(deskPatch(desk, input)).toEqual({});
    expect(deskPatch(desk, { ...input, name: 'Back desk' })).toEqual({ name: 'Back desk' });
    expect(deskPatch(desk, { ...input, languages: ['en', 'fr'], project_id: 'p2' })).toEqual({
      languages: ['en', 'fr'],
      project_id: 'p2',
    });
  });

  it('can clear the location', () => {
    expect(deskPatch(desk, { ...input, location_label: '' })).toEqual({ location_label: '' });
    expect(deskPatch({ ...desk, location_label: null }, { ...input, location_label: '' })).toEqual(
      {},
    );
  });

  it('treats the language list as a set', () => {
    expect(
      deskPatch({ ...desk, languages: ['en', 'fr'] }, { ...input, languages: ['fr', 'en'] }),
    ).toEqual({});
  });

  it('compares the default language and a desk with no project', () => {
    expect(deskPatch(desk, { ...input, default_lang: 'de' })).toEqual({ default_lang: 'de' });
    expect(deskPatch({ ...desk, project_id: null }, input)).toEqual({ project_id: 'proj-1' });
  });
});
