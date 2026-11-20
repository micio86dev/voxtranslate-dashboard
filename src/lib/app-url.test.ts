import { describe, expect, it } from 'vitest';
import { APP_URL, liveAnswerUrl } from './app-url';

describe('liveAnswerUrl', () => {
  it('deep-links the call app staff page with the session to answer', () => {
    expect(liveAnswerUrl('abc-123', 'https://app.example.test')).toBe(
      'https://app.example.test/live/desks?answer=abc-123',
    );
  });

  it('escapes the id so it can never add a parameter or a path', () => {
    const url = liveAnswerUrl('a&b=c/../d', 'https://app.example.test');
    expect(url).toBe('https://app.example.test/live/desks?answer=a%26b%3Dc%2F..%2Fd');
  });

  it('defaults to the configured call app origin, without a trailing slash', () => {
    expect(APP_URL.endsWith('/')).toBe(false);
    expect(liveAnswerUrl('x')).toBe(`${APP_URL}/live/desks?answer=x`);
  });
});
