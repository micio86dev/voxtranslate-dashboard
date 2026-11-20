/**
 * Where the call app lives. The dashboard hands live work to it — a phone call, a Live Connect
 * conversation — because the audio engine (microphone, WebSocket, playback) is the call app's,
 * not the dashboard's. Same variable `Header.astro` reads for "Open call app".
 */
export const APP_URL = (import.meta.env.PUBLIC_APP_URL || 'https://app.voxtranslate.app').replace(
  /\/$/,
  '',
);

/**
 * The call app's staff page, opened on one waiting customer. The session id is the only thing
 * in the link: the call app signs in with its own session and asks the API to answer.
 */
export function liveAnswerUrl(sessionId: string, base: string = APP_URL): string {
  return `${base}/live/desks?answer=${encodeURIComponent(sessionId)}`;
}
