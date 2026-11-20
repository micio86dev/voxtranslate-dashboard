/** Validation of the desk create/edit form, before anything is sent. The server re-checks all of it. */
import type { LiveDesk, LiveDeskInput, LiveDeskPatch } from '../../lib/api';

export interface DeskFormValues {
  name: string;
  location: string;
  defaultLang: string;
  languages: string[];
  projectId: string;
}

export type DeskFormField = 'name' | 'location' | 'defaultLang' | 'languages' | 'projectId';

export type DeskFormResult =
  | { ok: true; input: LiveDeskInput & { location_label: string; languages: string[] } }
  | { ok: false; errors: Partial<Record<DeskFormField, string>> };

const MAX_NAME = 100;
const MAX_LOCATION = 150;
const MAX_LANGUAGES = 20;

/** The server's rule: 1-8 letters, digits or dashes, lower-cased, and never `auto`. */
export function normalizeLang(raw: string): string | null {
  const l = raw.trim().toLowerCase();
  return /^[a-z0-9-]{1,8}$/.test(l) && l !== 'auto' ? l : null;
}

/** "en, it es" → ['en', 'it', 'es'] (not yet validated). */
export function parseLanguages(raw: string): string[] {
  return raw.split(/[\s,]+/).filter(Boolean);
}

export function validateDeskForm(v: DeskFormValues): DeskFormResult {
  const errors: Partial<Record<DeskFormField, string>> = {};
  const name = v.name.trim();
  const location = v.location.trim();

  if (!name) errors.name = 'live.desks.form.nameRequired';
  else if (name.length > MAX_NAME) errors.name = 'live.desks.form.nameTooLong';
  if (location.length > MAX_LOCATION) errors.location = 'live.desks.form.locationTooLong';
  if (!v.projectId) errors.projectId = 'live.desks.form.projectRequired';

  const defaultLang = normalizeLang(v.defaultLang);
  if (!defaultLang) errors.defaultLang = 'live.desks.form.langInvalid';

  const langs: string[] = [];
  for (const raw of v.languages) {
    const l = normalizeLang(raw);
    if (!l) {
      errors.languages = 'live.desks.form.langInvalid';
      break;
    }
    if (!langs.includes(l)) langs.push(l);
  }
  if (!errors.languages && langs.length > MAX_LANGUAGES) {
    errors.languages = 'live.desks.form.tooManyLanguages';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      name,
      location_label: location,
      default_lang: defaultLang as string,
      languages: langs,
      project_id: v.projectId,
    },
  };
}

/** Only the fields that differ from the stored desk, so an edit never overwrites what it did not touch. */
export function deskPatch(current: LiveDesk, next: LiveDeskInput): LiveDeskPatch {
  const patch: LiveDeskPatch = {};
  if (next.name !== current.name) patch.name = next.name;
  if ((next.location_label ?? '') !== (current.location_label ?? '')) {
    patch.location_label = next.location_label ?? '';
  }
  if (next.default_lang !== current.default_lang) patch.default_lang = next.default_lang;
  const a = [...(next.languages ?? [])].sort();
  const b = [...current.languages].sort();
  if (a.length !== b.length || a.some((l, i) => l !== b[i])) patch.languages = next.languages ?? [];
  if (next.project_id !== current.project_id) patch.project_id = next.project_id;
  return patch;
}
