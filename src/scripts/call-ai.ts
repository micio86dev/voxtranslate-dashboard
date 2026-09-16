/**
 * AI report + sentiment decision logic for a call/session's detail page.
 *
 * Both features read `GET /api/sessions/{id}/report` and `GET /api/sessions/{id}/sentiment`
 * (server/src/api.rs), which return `null` for "no stored analysis" rather than a 404 — the
 * session-detail page polls them on every open, and a 404 would only spam the console. A
 * plain member gets a 403 for a colleague's phone call, the same boundary the call detail
 * itself already enforces — that is a permission wall, not evidence that nothing was ever
 * generated, so it reads the same as "none" rather than as a load failure.
 *
 * `ai_analysis_requested` (hotfix 1.58.5) tells the client, for a phone call, whether the
 * caller opted into AI analysis at all. For a browser call, or an older server that has not
 * shipped the flag, it is `undefined` — the best available fallback signal is then the
 * transcript's own `status`, since an analysis reads the transcript and cannot exist before
 * it does.
 */

export type AiFeatureState = 'pending' | 'ready' | 'none' | 'notRequested' | 'error';

/** The settled outcome of one report/sentiment fetch, already unwrapped from the
 *  `PromiseSettledResult`/`ApiResult` envelopes so the decision logic below never touches
 *  a promise or a DOM element directly. */
export type AiFetchOutcome<T> =
  | { kind: 'rejected' }
  | { kind: 'http-error'; status: number }
  | { kind: 'ok'; row: T | null };

/** Narrow a `Promise.allSettled` result for one `getSessionReport`/`getSessionSentiment`
 *  call into an `AiFetchOutcome`. A `request()` in `lib/api.ts` never actually rejects
 *  today (it catches its own fetch failures into `{ ok: false, status: 0 }`), but this
 *  still handles a genuine rejection defensively rather than assuming that contract holds
 *  forever. */
export function classifyAiFetch<T>(
  result: PromiseSettledResult<{ ok: boolean; status: number; data: T | null }>,
): AiFetchOutcome<T> {
  if (result.status === 'rejected') return { kind: 'rejected' };
  const res = result.value;
  if (!res.ok) return { kind: 'http-error', status: res.status };
  return { kind: 'ok', row: res.data };
}

/** Whether `row` carries the field the report section actually renders. An empty object —
 *  exactly what a loose "truthy object" check let through — is rejected here, not treated
 *  as a stored report. */
export function isReportRow(row: unknown): row is { markdown: string } {
  return (
    !!row &&
    typeof row === 'object' &&
    typeof (row as { markdown?: unknown }).markdown === 'string' &&
    (row as { markdown: string }).markdown.trim() !== ''
  );
}

/** Whether `row` carries the fields the sentiment section actually renders: an overall
 *  mood, and `speakers`/`key_moments` arrays it iterates with `.map`. */
export function isSentimentRow(row: unknown): row is {
  result: {
    overall: { score: number; mood: string };
    speakers: unknown[];
    key_moments: unknown[];
  };
} {
  if (!row || typeof row !== 'object') return false;
  const result = (row as { result?: unknown }).result;
  if (!result || typeof result !== 'object') return false;
  const overall = (result as { overall?: unknown }).overall;
  if (
    !overall ||
    typeof overall !== 'object' ||
    typeof (overall as { mood?: unknown }).mood !== 'string' ||
    typeof (overall as { score?: unknown }).score !== 'number'
  ) {
    return false;
  }
  const speakers = (result as { speakers?: unknown }).speakers;
  const keyMoments = (result as { key_moments?: unknown }).key_moments;
  return Array.isArray(speakers) && Array.isArray(keyMoments);
}

/**
 * `outcome` is the fetch outcome for one feature (report or sentiment); `isValidRow`
 * is `isReportRow`/`isSentimentRow` for that feature; `transcriptStatus` is the
 * transcript's own `status` (`TranscriptDoc.status`); `aiRequested` is
 * `ai_analysis_requested` from the call detail, `undefined` when unknown.
 */
export function aiFeatureState(
  outcome: AiFetchOutcome<unknown>,
  isValidRow: (row: unknown) => boolean,
  transcriptStatus: string | null | undefined,
  aiRequested: boolean | null | undefined,
): AiFeatureState {
  if (outcome.kind === 'rejected') return 'error';
  if (outcome.kind === 'http-error') {
    return outcome.status === 403 ? 'none' : 'error';
  }
  if (isValidRow(outcome.row)) return 'ready';
  if (aiRequested === false) return 'notRequested';
  if (transcriptStatus === 'processing' || aiRequested === true) return 'pending';
  return 'none';
}

/** Translation key for a sentiment mood the server reports. Unknown moods read as neutral,
 *  never as a raw code, mirroring `phone-dialer.refusalKey`'s fallback rule. */
export function sentimentMoodKey(mood: string | null | undefined): string {
  switch (mood) {
    case 'positive':
      return 'transcript.sentimentMoodPositive';
    case 'negative':
      return 'transcript.sentimentMoodNegative';
    case 'mixed':
      return 'transcript.sentimentMoodMixed';
    default:
      return 'transcript.sentimentMoodNeutral';
  }
}

/**
 * A -1..1 sentiment score as a signed percentage, e.g. `0.8` → `"+80"`.
 *
 * `null`/non-numeric renders as an em dash rather than `"0"` — a speaker the model never
 * scored (silent, or dropped as malformed) is not the same claim as a speaker scored
 * perfectly neutral.
 */
export function formatSentimentScore(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return '—';
  const pct = Math.round(score * 100);
  return pct > 0 ? `+${pct}` : `${pct}`;
}
