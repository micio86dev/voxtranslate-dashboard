/** Small pure helpers shared by the Live Connect pages. */
import type { LiveParticipant } from '../../lib/api';

/** Owners and admins manage desks, delete conversations and see usage; the server enforces it. */
export function isAdminRole(role: string | undefined | null): boolean {
  return role === 'owner' || role === 'admin';
}

const STATUSES = new Set(['waiting', 'active', 'ended', 'expired']);

export function statusKey(status: string): string {
  return STATUSES.has(status) ? `live.status.${status}` : 'live.status.unknown';
}

const END_REASONS = new Set([
  'ended_by_host',
  'ended_by_guest',
  'ended_by_staff',
  'ended_by_billing',
  'billing_error',
  'expired',
  'abandoned',
  'max_duration',
  'desk_revoked',
  'desk_regenerated',
]);

/** Translation key for why a conversation ended; `null` when it has not (or nothing was recorded). */
export function endReasonKey(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return END_REASONS.has(reason) ? `live.endReason.${reason}` : 'live.endReason.other';
}

/** A language's name in the viewer's language; the upper-cased code when the runtime cannot. */
export function langName(code: string | null | undefined, viewerLang: string): string {
  if (!code) return '';
  try {
    const name = new Intl.DisplayNames([viewerLang], { type: 'language' }).of(code);
    if (name && name.toLowerCase() !== code.toLowerCase()) return name;
  } catch {
    /* a code the runtime rejects */
  }
  return code.toUpperCase();
}

/**
 * Which side of the transcript a speaker is on: 0 or 1, stable for the whole conversation, so
 * the two people keep their colour. Known participants take their side in join order; a
 * speaker whose peer id changed (a reconnect) is matched by name; anyone else takes the next
 * free side.
 */
export function speakerSides(
  participants: LiveParticipant[],
  utterances: { speaker_id: string; speaker_name: string }[],
): (speakerId: string, speakerName: string) => 0 | 1 {
  const byId = new Map<string, 0 | 1>();
  const byName = new Map<string, 0 | 1>();
  let next = 0;
  const assign = (): 0 | 1 => {
    const side = (next % 2) as 0 | 1;
    next += 1;
    return side;
  };
  for (const p of participants) {
    const side = assign();
    byId.set(p.peer_id, side);
    if (!byName.has(p.display_name)) byName.set(p.display_name, side);
  }
  const resolve = (id: string, name: string): 0 | 1 => {
    const known = byId.get(id) ?? byName.get(name);
    if (known !== undefined) {
      byId.set(id, known);
      return known;
    }
    const side = assign();
    byId.set(id, side);
    byName.set(name, side);
    return side;
  };
  // Resolve in transcript order up front so lookups never depend on call order.
  for (const u of utterances) resolve(u.speaker_id, u.speaker_name);
  return resolve;
}

/** `(3) Title` while somebody waits, the plain title otherwise. */
export function titleWithBadge(title: string, count: number): string {
  return count > 0 ? `(${count}) ${title}` : title;
}
