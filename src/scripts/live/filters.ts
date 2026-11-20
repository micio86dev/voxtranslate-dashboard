/** Query building and small helpers for the sessions list and the language pickers. */
import type { LanguageMetaDto, LiveSessionStatus, LiveSessionsQuery } from '../../lib/api';
import { langName } from './format';
import { dayStartIso, nextDayStartIso } from './range';

export const PAGE_SIZE = 25;
const MAX_LIMIT = 100;
const STATUSES: LiveSessionStatus[] = ['waiting', 'active', 'ended', 'expired'];

/** What the filter bar holds. Dates are `YYYY-MM-DD` from `<input type=date>`. */
export interface SessionFilters {
  status: string;
  projectId: string;
  deskId: string;
  from: string;
  to: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The API query for the filter bar and a 1-based page. */
export function sessionsQuery(
  f: SessionFilters,
  page: number,
  pageSize: number,
): LiveSessionsQuery {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(pageSize)));
  const q: LiveSessionsQuery = { limit };
  if ((STATUSES as string[]).includes(f.status)) q.status = f.status as LiveSessionStatus;
  if (f.projectId) q.project_id = f.projectId;
  if (f.deskId) q.desk_id = f.deskId;
  if (DAY.test(f.from)) q.from = dayStartIso(f.from);
  if (DAY.test(f.to)) q.to = nextDayStartIso(f.to);
  if (page > 1) q.offset = (page - 1) * limit;
  return q;
}

/** True while any listed conversation can still change: the list should keep refreshing. */
export function anyOpen(rows: { status: string }[]): boolean {
  return rows.some((r) => r.status === 'waiting' || r.status === 'active');
}

export interface PageWindow {
  from: number;
  to: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export function pageWindow(p: { total: number; offset: number; count: number }): PageWindow {
  const from = p.count === 0 ? 0 : p.offset + 1;
  const to = p.offset + p.count;
  return { from, to, total: p.total, hasPrev: p.offset > 0, hasNext: to < p.total };
}

export const FALLBACK_LANGUAGES = [
  'en',
  'it',
  'es',
  'de',
  'fr',
  'pt',
  'nl',
  'ru',
  'zh',
  'ja',
  'ar',
  'hi',
];

/** `<option>` data for a language select: the shared catalogue, or a built-in short list. */
export function languageOptions(
  catalogue: LanguageMetaDto[] | null | undefined,
  viewerLang: string,
): { code: string; label: string }[] {
  const codes = catalogue && catalogue.length ? catalogue.map((l) => l.code) : FALLBACK_LANGUAGES;
  return codes
    .map((code) => ({ code, label: langName(code, viewerLang) }))
    .sort((a, b) => a.label.localeCompare(b.label, viewerLang));
}
