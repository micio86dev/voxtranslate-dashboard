import { describe, expect, it } from 'vitest';
import {
  aiFeatureState,
  classifyAiFetch,
  formatSentimentScore,
  isReportRow,
  isSentimentRow,
  sentimentMoodKey,
  type AiFetchOutcome,
} from './call-ai';

const ok = <T>(row: T | null): AiFetchOutcome<T> => ({ kind: 'ok', row });
const httpError = (status: number): AiFetchOutcome<never> => ({ kind: 'http-error', status });
const rejected: AiFetchOutcome<never> = { kind: 'rejected' };

const VALID_REPORT = { markdown: 'Great meeting.' };
const VALID_SENTIMENT = {
  result: {
    overall: { score: 0.5, mood: 'positive' },
    speakers: [{ name: 'Alex', talk_pct: 100, score: 0.5, mood: 'positive' }],
    key_moments: [],
    timeline: [],
    window_secs: 120,
  },
};

describe('isReportRow', () => {
  it('accepts a row carrying non-blank markdown', () => {
    expect(isReportRow(VALID_REPORT)).toBe(true);
  });

  it('rejects an empty object, null, and a row with blank/missing markdown', () => {
    // `{}` is exactly what an unauthenticated/failure fallback path can hand back — it
    // must never be mistaken for a stored report just because it is an object.
    expect(isReportRow({})).toBe(false);
    expect(isReportRow(null)).toBe(false);
    expect(isReportRow(undefined)).toBe(false);
    expect(isReportRow({ markdown: '' })).toBe(false);
    expect(isReportRow({ markdown: '   ' })).toBe(false);
    expect(isReportRow({ markdown: 42 })).toBe(false);
  });
});

describe('isSentimentRow', () => {
  it('accepts a row carrying the fields the page actually renders', () => {
    expect(isSentimentRow(VALID_SENTIMENT)).toBe(true);
  });

  it('rejects an empty object and null', () => {
    expect(isSentimentRow({})).toBe(false);
    expect(isSentimentRow(null)).toBe(false);
    expect(isSentimentRow(undefined)).toBe(false);
  });

  it('rejects a row missing the overall mood', () => {
    expect(isSentimentRow({ result: { overall: {}, speakers: [], key_moments: [] } })).toBe(false);
  });

  it('rejects a row whose speakers or key_moments are not arrays', () => {
    expect(
      isSentimentRow({
        result: { overall: { score: 0, mood: 'neutral' }, speakers: 'nope', key_moments: [] },
      }),
    ).toBe(false);
    expect(
      isSentimentRow({
        result: { overall: { score: 0, mood: 'neutral' }, speakers: [], key_moments: null },
      }),
    ).toBe(false);
  });
});

describe('classifyAiFetch', () => {
  it('reads a rejected promise as "rejected"', () => {
    expect(classifyAiFetch({ status: 'rejected', reason: new Error('boom') })).toEqual({
      kind: 'rejected',
    });
  });

  it('reads a non-ok response as "http-error", carrying its status', () => {
    expect(
      classifyAiFetch({ status: 'fulfilled', value: { ok: false, status: 403, data: null } }),
    ).toEqual({ kind: 'http-error', status: 403 });
  });

  it('reads an ok response as "ok", carrying its row (including null)', () => {
    expect(
      classifyAiFetch({ status: 'fulfilled', value: { ok: true, status: 200, data: null } }),
    ).toEqual({ kind: 'ok', row: null });
    expect(
      classifyAiFetch({
        status: 'fulfilled',
        value: { ok: true, status: 200, data: VALID_REPORT },
      }),
    ).toEqual({ kind: 'ok', row: VALID_REPORT });
  });
});

describe('aiFeatureState', () => {
  it('is ready only once the row actually validates', () => {
    expect(aiFeatureState(ok(VALID_REPORT), isReportRow, 'processing', undefined)).toBe('ready');
  });

  it('is NOT ready for an ok response carrying an empty object — the bug this fixes', () => {
    // `{}` (or any object missing the fields the page renders) must never read as a
    // stored analysis just because it is truthy and an object.
    expect(aiFeatureState(ok({}), isReportRow, 'ready', undefined)).not.toBe('ready');
    expect(aiFeatureState(ok({}), isReportRow, 'ready', undefined)).toBe('none');
  });

  it('is pending while the transcript itself is still being produced', () => {
    expect(aiFeatureState(ok(null), isReportRow, 'processing', undefined)).toBe('pending');
  });

  it('is pending when the call explicitly requested AI analysis but no row exists yet', () => {
    expect(aiFeatureState(ok(null), isReportRow, 'ready', true)).toBe('pending');
  });

  it('is notRequested when the call explicitly did not ask for AI analysis', () => {
    expect(aiFeatureState(ok(null), isReportRow, 'ready', false)).toBe('notRequested');
    expect(aiFeatureState(ok(null), isReportRow, 'processing', false)).toBe('notRequested');
  });

  it('is none once the transcript is settled, nothing was requested, and no row ever appeared', () => {
    for (const status of ['ready', 'none', 'failed', null, undefined]) {
      expect(aiFeatureState(ok(null), isReportRow, status, undefined)).toBe('none');
    }
  });

  it('is error for a rejected fetch', () => {
    expect(aiFeatureState(rejected, isReportRow, 'ready', undefined)).toBe('error');
  });

  it('is error for a 5xx or other unexpected HTTP failure', () => {
    expect(aiFeatureState(httpError(500), isReportRow, 'ready', undefined)).toBe('error');
    expect(aiFeatureState(httpError(0), isReportRow, 'ready', undefined)).toBe('error');
    expect(aiFeatureState(httpError(401), isReportRow, 'ready', undefined)).toBe('error');
  });

  it('treats a 403 like "no access to see", not a load failure — same boundary as call detail', () => {
    expect(aiFeatureState(httpError(403), isReportRow, 'ready', undefined)).toBe('none');
  });
});

describe('sentimentMoodKey', () => {
  it('maps every mood the server can report', () => {
    expect(sentimentMoodKey('positive')).toBe('transcript.sentimentMoodPositive');
    expect(sentimentMoodKey('negative')).toBe('transcript.sentimentMoodNegative');
    expect(sentimentMoodKey('mixed')).toBe('transcript.sentimentMoodMixed');
    expect(sentimentMoodKey('neutral')).toBe('transcript.sentimentMoodNeutral');
  });

  it('falls back to neutral for anything it does not recognise', () => {
    expect(sentimentMoodKey(null)).toBe('transcript.sentimentMoodNeutral');
    expect(sentimentMoodKey(undefined)).toBe('transcript.sentimentMoodNeutral');
    expect(sentimentMoodKey('ecstatic')).toBe('transcript.sentimentMoodNeutral');
  });
});

describe('formatSentimentScore', () => {
  it('renders a -1..1 score as a signed percentage', () => {
    expect(formatSentimentScore(0.8)).toBe('+80');
    expect(formatSentimentScore(-0.6)).toBe('-60');
    expect(formatSentimentScore(0)).toBe('0');
  });

  it('renders a missing or non-numeric score as an em dash, never as zero', () => {
    // A speaker the model never scored is not the same as a speaker scored neutral.
    expect(formatSentimentScore(null)).toBe('—');
    expect(formatSentimentScore(undefined)).toBe('—');
    expect(formatSentimentScore(NaN)).toBe('—');
  });
});
