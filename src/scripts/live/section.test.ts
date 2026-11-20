import { beforeEach, describe, expect, it } from 'vitest';
import { applyLiveNav } from './section';

beforeEach(() => {
  document.body.innerHTML =
    '<nav><a data-live-tab="sessions">S</a><a data-live-tab="usage">U</a></nav>';
});

describe('applyLiveNav', () => {
  it('shows the usage tab to owners and admins', () => {
    for (const role of ['owner', 'admin']) {
      applyLiveNav(role);
      expect(document.querySelector('[data-live-tab=usage]')?.classList.contains('hidden')).toBe(
        false,
      );
    }
  });
  it('hides it from members and when the role is unknown, leaving the other tabs alone', () => {
    for (const role of ['member', 'guest', undefined]) {
      applyLiveNav(role);
      expect(document.querySelector('[data-live-tab=usage]')?.classList.contains('hidden')).toBe(
        true,
      );
      expect(document.querySelector('[data-live-tab=sessions]')?.classList.contains('hidden')).toBe(
        false,
      );
    }
  });
});
