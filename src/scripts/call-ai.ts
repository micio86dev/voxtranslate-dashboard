/**
 * AI report + sentiment decision logic for a call/session's detail page.
 *
 * Both features read `GET /api/sessions/{id}/report` and `GET /api/sessions/{id}/sentiment`
 * (server/src/api.rs), which return `null` for "no stored analysis" rather than a 404 — the
 * session-detail page polls them on every open, and a 404 would only spam the console.
 *
 * The dashboard has no explicit "analysis requested" flag for a call — the server side of
 * this hotfix makes sentiment auto-generate from the call's AI option, but that intent never
 * reaches the client. The best available signal is the transcript's own `status`: an
 * analysis reads the transcript, so it cannot exist before the transcript does. While the
 * transcript is still `processing`, a missing report/sentiment row is provisional
 * ("pending"); once the transcript has settled, a missing row is final ("none") — the
 * request may simply not have asked for it.
 */

export type AiFeatureState = 'pending' | 'ready' | 'none';

/**
 * `row` is whatever the server's `report`/`sentiment` GET returned, and `transcriptStatus`
 * is the transcript's own `status` field (`TranscriptDoc.status`) for the same session.
 */
export function aiFeatureState(
  row: unknown,
  transcriptStatus: string | null | undefined,
): AiFeatureState {
  if (row && typeof row === 'object') return 'ready';
  return transcriptStatus === 'processing' ? 'pending' : 'none';
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
