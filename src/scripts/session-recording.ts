/**
 * Session-detail recording decision logic (hotfix 0.16.1).
 *
 * `history/detail.astro` is generic across every non-webinar session: browser video/audio
 * calls AND phone calls (linked from `phone/detail.astro`) both land there for the
 * transcript, its translation and exports. Its own "Load recording" control speaks the
 * browser ROOM-recording endpoint (`/api/business/rooms/{id}/recording/url`), which is
 * never populated for a phone call — a telephone leg is not a WebRTC room, and a phone
 * call's own recording lives on the VoIP-specific endpoint shown on its own detail page.
 * Offering that control there is a promise the page cannot keep, so it is suppressed when
 * the caller marks the link as coming from a phone call (`?kind=phone`).
 */
export function showsRoomRecording(sessionKind: string | null | undefined): boolean {
  return sessionKind !== 'phone';
}
