import { describe, expect, it } from 'vitest';
import {
  endReasonKey,
  isAdminRole,
  langName,
  speakerSides,
  statusKey,
  titleWithBadge,
} from './format';

describe('isAdminRole', () => {
  it('is true for owners and admins only', () => {
    expect(isAdminRole('owner')).toBe(true);
    expect(isAdminRole('admin')).toBe(true);
    expect(isAdminRole('member')).toBe(false);
    expect(isAdminRole('guest')).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});

describe('statusKey / endReasonKey', () => {
  it('maps the four session statuses and falls back for an unknown one', () => {
    for (const s of ['waiting', 'active', 'ended', 'expired']) {
      expect(statusKey(s)).toBe(`live.status.${s}`);
    }
    expect(statusKey('weird')).toBe('live.status.unknown');
  });

  it('maps known end reasons; null is no reason, unknown is generic', () => {
    expect(endReasonKey('ended_by_guest')).toBe('live.endReason.ended_by_guest');
    expect(endReasonKey('desk_regenerated')).toBe('live.endReason.desk_regenerated');
    expect(endReasonKey('max_duration')).toBe('live.endReason.max_duration');
    expect(endReasonKey(null)).toBeNull();
    expect(endReasonKey('')).toBeNull();
    expect(endReasonKey('???')).toBe('live.endReason.other');
  });
});

describe('langName', () => {
  it('names a language in the viewer language', () => {
    expect(langName('it', 'en')).toBe('Italian');
    expect(langName('en', 'it')).toBe('inglese');
  });

  it('falls back to the upper-cased code when the runtime cannot name it', () => {
    expect(langName('zz-invalid-code-xx', 'en')).toBe('ZZ-INVALID-CODE-XX');
    expect(langName('', 'en')).toBe('');
    expect(langName(null, 'en')).toBe('');
  });
});

describe('speakerSides', () => {
  const participants = [
    { peer_id: 'p1', role: 'guest', display_name: 'Ana', lang: 'es' },
    { peer_id: 'p2', role: 'staff', display_name: 'Luca', lang: 'it' },
  ];

  it('gives each participant one stable side, in the order they joined', () => {
    const side = speakerSides(participants, []);
    expect(side('p1', 'Ana')).toBe(0);
    expect(side('p2', 'Luca')).toBe(1);
    expect(side('p1', 'Ana')).toBe(0);
  });

  it('matches a speaker whose id changed (a reconnect) by display name', () => {
    const side = speakerSides(participants, []);
    expect(side('p9-new-peer', 'Luca')).toBe(1);
  });

  it('puts an unknown speaker on the first free side, and keeps it there', () => {
    const side = speakerSides(
      [],
      [
        { speaker_id: 'x', speaker_name: 'X' },
        { speaker_id: 'y', speaker_name: 'Y' },
        { speaker_id: 'z', speaker_name: 'Z' },
      ],
    );
    expect(side('x', 'X')).toBe(0);
    expect(side('y', 'Y')).toBe(1);
    expect(side('z', 'Z')).toBe(0);
    expect(side('x', 'X')).toBe(0);
  });
});

describe('titleWithBadge', () => {
  it('prefixes a count, and is the plain title for zero', () => {
    expect(titleWithBadge('Desk console', 0)).toBe('Desk console');
    expect(titleWithBadge('Desk console', 3)).toBe('(3) Desk console');
  });
});
