import { describe, expect, it } from 'vitest';
import { aiFeatureState, formatSentimentScore, sentimentMoodKey } from './call-ai';

describe('aiFeatureState', () => {
  it('is ready once the server has a stored row, whatever else is true', () => {
    expect(aiFeatureState({ id: 'r1' }, 'processing')).toBe('ready');
    expect(aiFeatureState({ id: 'r1' }, 'ready')).toBe('ready');
    expect(aiFeatureState({ id: 'r1' }, null)).toBe('ready');
  });

  it('is pending while the transcript itself is still being produced', () => {
    // A report/sentiment analysis reads the transcript, so it cannot exist before the
    // transcript does — reporting "none" here would read as a call nobody asked to
    // analyse, when the answer just has not arrived yet.
    expect(aiFeatureState(null, 'processing')).toBe('pending');
  });

  it('is none once the transcript is settled and no row ever appeared', () => {
    for (const status of ['ready', 'none', 'failed', null, undefined]) {
      expect(aiFeatureState(null, status)).toBe('none');
    }
  });

  it('treats a non-object row the same as no row', () => {
    // The unauthenticated/failure fallback path can hand back `{}` rather than `null`;
    // it must not be mistaken for a stored analysis.
    expect(aiFeatureState(undefined, 'ready')).toBe('none');
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
