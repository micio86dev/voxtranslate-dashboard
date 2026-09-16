/**
 * Phone call recording decision logic (hotfix 0.16.1).
 *
 * The recording URL from `GET .../voip/calls/{id}/recording` is short-lived (it is a
 * signed link to storage), so it is fetched on demand rather than cached with the call
 * detail — and a previously-fetched one must be checked for freshness before reuse
 * instead of being handed to `<audio>` again, where an expired link fails silently or
 * stops mid-playback.
 */

/**
 * Whether a previously-fetched recording URL is still safe to (re)use, given `now`.
 *
 * Anything that cannot be parsed as a date — missing, empty, malformed — is treated as
 * stale: the caller should re-fetch rather than guess.
 */
export function isRecordingUrlFresh(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return false;
  return t > now.getTime();
}

/**
 * Localized message key for a failed `getVoipCallRecording` fetch, given the server's
 * error `code` if any (`res.data?.error`).
 *
 * The server reports `recording_unavailable` on both a 404 (no recording exists) and a
 * 502 (its own upstream failed) — the CODE, not the HTTP status, is what says "there is
 * definitely no recording here." Everything else — a network error, an unrelated 5xx, a
 * 401 — is a transient failure: the recording may well exist, and the request simply
 * did not succeed, so it gets a generic "try again" message rather than a false claim
 * that no recording was ever made.
 */
export function recordingFailureKey(code: string | null | undefined): string {
  return code === 'recording_unavailable'
    ? 'phone.reason.recording_unavailable'
    : 'phone.error.actionFailed';
}
