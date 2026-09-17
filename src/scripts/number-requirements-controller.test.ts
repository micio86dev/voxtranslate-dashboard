/**
 * Container tests for the number-order regulatory requirements panel (spec 0119).
 *
 * The DOM fixture below mirrors `RequirementsPanel.astro` (same ids, same `<template>`
 * structure) without needing the Astro runtime — the same approach `sub-banner.test.ts`
 * uses for its host element. The API is faked at the `createRequirementsController`
 * injection point, never at `fetch`, so these tests exercise the controller's own wiring:
 * state transitions, DOM updates, validation-before-network, and the poll-while-review
 * timer with its 40-attempt stop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequirementsController } from './number-requirements-controller';
import { POLL_INTERVAL_MS } from './number-requirements';
import type { ApiResult, RequirementsView } from '../lib/api';

function fixture(): void {
  document.body.innerHTML = `
    <div id="requirements-panel" class="hidden flex">
      <p id="requirements-for"></p>
      <button id="requirements-close" type="button"></button>
      <p id="requirements-status"></p>
      <p id="requirements-reused" class="hidden"></p>
      <div id="requirements-rejected" class="hidden">
        <p id="requirements-reject-reason"></p>
      </div>
      <div id="requirements-review-banner" class="hidden flex">
        <button id="requirements-refresh" type="button"></button>
      </div>
      <p id="requirements-approved" class="hidden"></p>
      <p id="requirements-failed-banner" class="hidden"></p>
      <p id="requirements-error" class="hidden"></p>
      <form id="requirements-form" class="grid">
        <div id="requirements-list"></div>
        <button id="requirements-save" type="button"></button>
        <button id="requirements-submit" type="submit"></button>
      </form>
    </div>
    <template id="tmpl-requirement-textual">
      <div data-requirement>
        <label data-field-label></label>
        <input type="text" data-field="value" />
        <p data-field-hint></p>
      </div>
    </template>
    <template id="tmpl-requirement-address">
      <fieldset data-requirement>
        <legend data-field-label></legend>
        <p data-field-hint></p>
        <input data-field="first_name" />
        <input data-field="last_name" />
        <input data-field="business_name" />
        <input data-field="street_address" />
        <input data-field="extended_address" />
        <input data-field="locality" />
        <input data-field="administrative_area" />
        <input data-field="postal_code" />
        <input data-field="country_code" />
      </fieldset>
    </template>
    <template id="tmpl-requirement-document">
      <div data-requirement>
        <label data-field-label></label>
        <p data-field-hint></p>
        <input type="file" data-field="file" />
        <p data-field-status></p>
      </div>
    </template>
  `;
}

function view(over: Partial<RequirementsView> = {}): RequirementsView {
  return {
    status: 'pending_regulatory',
    status_reason: null,
    group: { status: 'pending', reused: false },
    requirements: [
      {
        id: 'r1',
        name: 'Business name',
        description: 'Legal name',
        example: 'Acme',
        kind: 'textual',
      },
    ],
    ...over,
  };
}

function ok<T>(data: T, status = 200): ApiResult<T> {
  return { ok: true, status, data };
}

function fail<T>(error: string, status = 400): ApiResult<T> {
  return { ok: false, status, data: { error } as unknown as T };
}

const t = (key: string) => key;

function makeApi() {
  return {
    getNumberRequirements: vi.fn(async (_org: string, _numberId: string) => ok(view())),
    putNumberRequirements: vi.fn(async () => ok(view())),
    submitNumberRequirements: vi.fn(async () => ok({ status: 'regulatory_review' })),
    refreshNumberRequirements: vi.fn(async () =>
      ok({ status: 'regulatory_review', status_reason: null as string | null }),
    ),
    uploadRequirementDocument: vi.fn(async () =>
      ok({ requirement_id: 'r2', document: { av_scan_status: 'pending' as const } }),
    ),
  };
}

beforeEach(() => {
  fixture();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('open', () => {
  it('loads the view, shows the panel and renders one field per requirement', async () => {
    const api = makeApi();
    const controller = createRequirementsController({ orgId: 'org-1', t, api });

    await controller.open('num-1', '+390212345678');

    expect(api.getNumberRequirements).toHaveBeenCalledWith('org-1', 'num-1');
    expect(document.getElementById('requirements-panel')?.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('requirements-for')?.textContent).toBe('+390212345678');
    expect(document.querySelectorAll('[data-requirement]')).toHaveLength(1);
  });

  it('shows the reused banner when the group carries over previously approved documents', async () => {
    const api = makeApi();
    api.getNumberRequirements.mockResolvedValue(
      ok(view({ group: { status: 'approved', reused: true } })),
    );
    const controller = createRequirementsController({ orgId: 'org-1', t, api });

    await controller.open('num-1', '+390212345678');

    expect(document.getElementById('requirements-reused')?.classList.contains('hidden')).toBe(
      false,
    );
  });

  it('shows the rejection reason and still renders an editable form to fix it', async () => {
    const api = makeApi();
    api.getNumberRequirements.mockResolvedValue(
      ok(view({ status: 'regulatory_rejected', status_reason: 'Illegible ID scan' })),
    );
    const controller = createRequirementsController({ orgId: 'org-1', t, api });

    await controller.open('num-1', '+390212345678');

    expect(document.getElementById('requirements-rejected')?.classList.contains('hidden')).toBe(
      false,
    );
    expect(document.getElementById('requirements-reject-reason')?.textContent).toBe(
      'Illegible ID scan',
    );
    expect(document.getElementById('requirements-form')?.classList.contains('hidden')).toBe(false);
  });

  it('surfaces a load failure as localized copy rather than leaving a blank panel', async () => {
    const api = makeApi();
    api.getNumberRequirements.mockResolvedValue(fail('voip_misconfigured', 503));
    const controller = createRequirementsController({ orgId: 'org-1', t, api });

    await controller.open('num-1', '+390212345678');

    const error = document.getElementById('requirements-error');
    expect(error?.classList.contains('hidden')).toBe(false);
    expect(error?.textContent).toBe('phone.reason.voip_misconfigured');
  });
});

describe('save', () => {
  it('PUTs the typed textual value and re-renders the fresh view', async () => {
    const api = makeApi();
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    const input = document.querySelector<HTMLInputElement>('[data-field="value"]')!;
    input.value = 'Acme Inc';
    document
      .getElementById('requirements-save')!
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(api.putNumberRequirements).toHaveBeenCalledWith('org-1', 'num-1', [
      { requirement_id: 'r1', value: 'Acme Inc' },
    ]);
  });

  it('PUTs a structured address value gathered from its own field block', async () => {
    const api = makeApi();
    api.getNumberRequirements.mockResolvedValue(
      ok(
        view({
          requirements: [
            {
              id: 'r-addr',
              name: 'Registered address',
              description: '',
              example: '',
              kind: 'address',
            },
          ],
        }),
      ),
    );
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    const wrapper = document.querySelector('[data-requirement-id="r-addr"]')!;
    (wrapper.querySelector('[data-field="first_name"]') as HTMLInputElement).value = 'Ada';
    (wrapper.querySelector('[data-field="last_name"]') as HTMLInputElement).value = 'Lovelace';
    (wrapper.querySelector('[data-field="business_name"]') as HTMLInputElement).value = 'Acme';
    (wrapper.querySelector('[data-field="street_address"]') as HTMLInputElement).value =
      '1 Main St';
    (wrapper.querySelector('[data-field="locality"]') as HTMLInputElement).value = 'Rome';
    (wrapper.querySelector('[data-field="postal_code"]') as HTMLInputElement).value = '00100';
    (wrapper.querySelector('[data-field="country_code"]') as HTMLInputElement).value = 'IT';

    document
      .getElementById('requirements-save')!
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(api.putNumberRequirements).toHaveBeenCalledWith('org-1', 'num-1', [
      {
        requirement_id: 'r-addr',
        value: {
          first_name: 'Ada',
          last_name: 'Lovelace',
          business_name: 'Acme',
          street_address: '1 Main St',
          extended_address: '',
          locality: 'Rome',
          administrative_area: '',
          postal_code: '00100',
          country_code: 'IT',
        },
      },
    ]);
  });

  it('reports a save refusal without losing what was typed', async () => {
    const api = makeApi();
    api.putNumberRequirements.mockResolvedValue(fail('value_too_long', 400));
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    document
      .getElementById('requirements-save')!
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    const error = document.getElementById('requirements-error');
    expect(error?.textContent).toBe('phone.reason.value_too_long');
  });

  it('keeps the form usable after a save refusal, so the customer can fix and retry', async () => {
    const api = makeApi();
    api.putNumberRequirements
      .mockResolvedValueOnce(fail('value_too_long', 400))
      .mockResolvedValueOnce(ok(view()));
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    const saveBtn = document.getElementById('requirements-save') as HTMLButtonElement;
    saveBtn.dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('requirements-form')?.classList.contains('hidden')).toBe(false);
    expect(saveBtn.disabled).toBe(false);
    expect((document.getElementById('requirements-submit') as HTMLButtonElement).disabled).toBe(
      false,
    );

    saveBtn.dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(api.putNumberRequirements).toHaveBeenCalledTimes(2);
    expect(document.getElementById('requirements-error')?.classList.contains('hidden')).toBe(true);
  });
});

describe('document upload', () => {
  function withDocumentRequirement(api: ReturnType<typeof makeApi>) {
    api.getNumberRequirements.mockResolvedValue(
      ok(
        view({
          requirements: [
            { id: 'r2', name: 'Proof of address', description: '', example: '', kind: 'document' },
          ],
        }),
      ),
    );
  }

  it('refuses an oversize file client-side, before any network request', async () => {
    const api = makeApi();
    withDocumentRequirement(api);
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    const input = document.querySelector<HTMLInputElement>('[data-field="file"]')!;
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'proof.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(input, 'files', { value: [big] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(api.uploadRequirementDocument).not.toHaveBeenCalled();
    const error = document.getElementById('requirements-error');
    expect(error?.textContent).toBe('phone.reason.document_too_large');
  });

  it('uploads a valid file and refreshes the view afterwards', async () => {
    const api = makeApi();
    withDocumentRequirement(api);
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    const input = document.querySelector<HTMLInputElement>('[data-field="file"]')!;
    const file = new File(['%PDF-'], 'proof.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(api.uploadRequirementDocument).toHaveBeenCalledWith('org-1', 'num-1', 'r2', file);
    expect(api.getNumberRequirements).toHaveBeenCalledTimes(2); // initial open + post-upload refresh
  });

  it('lets the customer pick a valid file after a refused one, without reopening', async () => {
    const api = makeApi();
    withDocumentRequirement(api);
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    const pick = (f: File) => {
      const input = document.querySelector<HTMLInputElement>('[data-field="file"]')!;
      Object.defineProperty(input, 'files', { value: [f], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    pick(new File(['GIF89a'], 'proof.gif', { type: 'image/gif' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('requirements-form')?.classList.contains('hidden')).toBe(false);

    const good = new File(['%PDF-'], 'proof.pdf', { type: 'application/pdf' });
    pick(good);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(api.uploadRequirementDocument).toHaveBeenCalledWith('org-1', 'num-1', 'r2', good);
    expect(api.getNumberRequirements).toHaveBeenCalledTimes(2);
  });

  it('does not start an upload while a save is pending, and disables the file input meanwhile', async () => {
    // R3-upload-bypasses-phase-guard: the REDUCER already refuses `uploadStart` from
    // any phase but `editing`, but the controller used to call the upload API anyway —
    // it never checked whether the dispatch actually landed in `uploading`.
    const api = makeApi();
    api.getNumberRequirements.mockResolvedValue(
      ok(
        view({
          requirements: [
            { id: 'r1', name: 'Business name', description: '', example: '', kind: 'textual' },
            { id: 'r2', name: 'Proof of address', description: '', example: '', kind: 'document' },
          ],
        }),
      ),
    );
    const gate = deferred<ReturnType<typeof ok<RequirementsView>>>();
    api.putNumberRequirements.mockReturnValue(gate.promise);
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    document
      .getElementById('requirements-save')!
      .dispatchEvent(new Event('click', { bubbles: true }));
    // `save()` runs synchronously up to its first `await` (the PUT), so the phase is
    // already `saving` by the time this line runs — no extra tick needed.

    const fileInput = document.querySelector<HTMLInputElement>(
      '[data-requirement-id="r2"] [data-field="file"]',
    )!;
    expect(fileInput.disabled).toBe(true);

    const file = new File(['%PDF-'], 'proof.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(api.uploadRequirementDocument).not.toHaveBeenCalled();

    gate.resolve(ok(view()));
    await Promise.resolve();
  });

  it('clears the file input after a server-side upload failure, so the same file can be re-picked', async () => {
    // R3-upload-failure-retry-and-misreport (part 1): the client-side validation
    // failure already cleared the input; a SERVER refusal did not, which — because
    // `uploadFailed` does not re-render the field list — left the same stale selection
    // sitting in the DOM with no way to re-trigger a `change` event for it.
    const api = makeApi();
    withDocumentRequirement(api);
    api.uploadRequirementDocument.mockResolvedValue(fail('provider_unavailable', 502));
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    const input = document.querySelector<HTMLInputElement>('[data-field="file"]')!;
    const file = new File(['%PDF-'], 'proof.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    const setValue = vi.fn();
    // jsdom's own file-input `.value` semantics do not let this test observe a "cleared
    // path" directly, so this spies on the assignment itself: the claim under test is
    // "the code assigns `input.value = ''`", not any particular resulting string.
    Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: setValue });

    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(setValue).toHaveBeenCalledWith('');
  });

  it('keeps the document marked uploaded (not refused) when only the follow-up refresh fails', async () => {
    // R3-upload-failure-retry-and-misreport (part 2): the document itself DID upload —
    // only the full-view refetch afterwards failed. Reporting this through the same
    // path as a refused upload is simply false, and used to happen because the code
    // fell through to `uploadFailed` using the (successful) upload response as if it
    // were an error body.
    const api = makeApi();
    const docRequirement = {
      id: 'r2',
      name: 'Proof of address',
      description: '',
      example: '',
      kind: 'document' as const,
    };
    api.getNumberRequirements
      .mockResolvedValueOnce(ok(view({ requirements: [docRequirement] })))
      .mockResolvedValueOnce(fail('provider_unavailable', 502));
    api.uploadRequirementDocument.mockResolvedValue(
      ok({ requirement_id: 'r2', document: { av_scan_status: 'pending' as const } }, 201),
    );
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    const input = document.querySelector<HTMLInputElement>('[data-field="file"]')!;
    const file = new File(['%PDF-'], 'proof.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const error = document.getElementById('requirements-error');
    expect(error?.classList.contains('hidden')).toBe(true);
    const statusEl = document.querySelector('[data-requirement-id="r2"] [data-field-status]');
    expect(statusEl?.textContent).toBe('phone.numbers.requirements.scan.pending');
    expect(document.getElementById('requirements-form')?.classList.contains('hidden')).toBe(false);
  });
});

describe('submit and review polling', () => {
  it('saves, submits, shows the review banner and starts polling', async () => {
    vi.useFakeTimers();
    const api = makeApi();
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    document
      .getElementById('requirements-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);

    expect(api.putNumberRequirements).toHaveBeenCalledTimes(1);
    expect(api.submitNumberRequirements).toHaveBeenCalledWith('org-1', 'num-1');
    expect(
      document.getElementById('requirements-review-banner')?.classList.contains('hidden'),
    ).toBe(false);

    // One poll tick: still under review, no resolution yet.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(api.refreshNumberRequirements).toHaveBeenCalledTimes(1);
  });

  it('resubmitting a rejected order hides the stale rejected banner and fires onStatusChange', async () => {
    // R3-stale-rejected-banner-during-review: resubmitting used to leave `view.status`
    // at `regulatory_rejected`, so the rejected alert kept showing alongside the review
    // banner, and nothing told the numbers list the status had moved on.
    const api = makeApi();
    api.getNumberRequirements.mockResolvedValue(
      ok(view({ status: 'regulatory_rejected', status_reason: 'Illegible ID scan' })),
    );
    const onStatusChange = vi.fn();
    const controller = createRequirementsController({ orgId: 'org-1', t, api, onStatusChange });
    await controller.open('num-1', '+390212345678');

    expect(document.getElementById('requirements-rejected')?.classList.contains('hidden')).toBe(
      false,
    );

    document
      .getElementById('requirements-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('requirements-rejected')?.classList.contains('hidden')).toBe(
      true,
    );
    expect(
      document.getElementById('requirements-review-banner')?.classList.contains('hidden'),
    ).toBe(false);
    expect(onStatusChange).toHaveBeenCalledWith('num-1', 'regulatory_review', null);
  });

  it('a submit refusal (e.g. requirements_incomplete) is shown and never enters review', async () => {
    const api = makeApi();
    api.submitNumberRequirements.mockResolvedValue(fail('requirements_incomplete', 409));
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    document
      .getElementById('requirements-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const error = document.getElementById('requirements-error');
    expect(error?.textContent).toBe('phone.reason.requirements_incomplete');
    expect(
      document.getElementById('requirements-review-banner')?.classList.contains('hidden'),
    ).toBe(true);
  });

  it('resolves to active on a poll and stops polling further', async () => {
    vi.useFakeTimers();
    const api = makeApi();
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');
    document
      .getElementById('requirements-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);

    api.refreshNumberRequirements.mockResolvedValue(ok({ status: 'active', status_reason: null }));
    api.getNumberRequirements.mockResolvedValue(ok(view({ status: 'active' })));

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(document.getElementById('requirements-approved')?.classList.contains('hidden')).toBe(
      false,
    );

    const callsAfterResolution = api.refreshNumberRequirements.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4 * POLL_INTERVAL_MS);
    expect(api.refreshNumberRequirements).toHaveBeenCalledTimes(callsAfterResolution);
  });

  it('stops polling after the 40-attempt cap even with no resolution', async () => {
    vi.useFakeTimers();
    const api = makeApi();
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    api.getNumberRequirements.mockResolvedValue(ok(view({ status: 'regulatory_review' })));
    await controller.open('num-1', '+390212345678');

    await vi.advanceTimersByTimeAsync(41 * POLL_INTERVAL_MS);
    // MAX_POLL_ATTEMPTS is 40: ticks 1..39 each poll once, and tick 40 itself finds the
    // cap already reached and refuses to poll — so the cap is reached at EXACTLY 39
    // calls, not merely "no more than 39" (a weaker assertion could pass even if polling
    // stopped early, e.g. after one tick).
    expect(api.refreshNumberRequirements).toHaveBeenCalledTimes(39);

    await vi.advanceTimersByTimeAsync(10 * POLL_INTERVAL_MS);
    expect(api.refreshNumberRequirements).toHaveBeenCalledTimes(39);
  });
});

describe('manual refresh', () => {
  it('is exposed as a button that reuses the same refresh path (subject to the server 30s throttle)', async () => {
    const api = makeApi();
    api.getNumberRequirements.mockResolvedValue(ok(view({ status: 'regulatory_review' })));
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    document
      .getElementById('requirements-refresh')!
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(api.refreshNumberRequirements).toHaveBeenCalledWith('org-1', 'num-1');
  });

  it('shows a manual refresh refusal without leaving review', async () => {
    // R3-manual-refresh-silent-failure: a customer who clicks Refresh and hits the
    // server's 1/30s throttle deserves to know why nothing changed, rather than the
    // click silently doing nothing.
    const api = makeApi();
    api.getNumberRequirements.mockResolvedValue(ok(view({ status: 'regulatory_review' })));
    api.refreshNumberRequirements.mockResolvedValue(fail('refresh_too_soon', 429));
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    document
      .getElementById('requirements-refresh')!
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    const error = document.getElementById('requirements-error');
    expect(error?.classList.contains('hidden')).toBe(false);
    expect(error?.textContent).toBe('phone.reason.refresh_too_soon');
    expect(
      document.getElementById('requirements-review-banner')?.classList.contains('hidden'),
    ).toBe(false);
  });

  it('keeps a background poll failure silent, unlike a manual refresh', async () => {
    vi.useFakeTimers();
    const api = makeApi();
    api.getNumberRequirements.mockResolvedValue(ok(view({ status: 'regulatory_review' })));
    api.refreshNumberRequirements.mockResolvedValue(fail('provider_unavailable', 502));
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // one automatic poll tick, which fails

    const error = document.getElementById('requirements-error');
    expect(error?.classList.contains('hidden')).toBe(true);
  });
});

describe('close', () => {
  it('hides the panel and stops any in-flight polling', async () => {
    vi.useFakeTimers();
    const api = makeApi();
    api.getNumberRequirements.mockResolvedValue(ok(view({ status: 'regulatory_review' })));
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    controller.close();
    expect(document.getElementById('requirements-panel')?.classList.contains('hidden')).toBe(true);

    await vi.advanceTimersByTimeAsync(4 * POLL_INTERVAL_MS);
    expect(api.refreshNumberRequirements).not.toHaveBeenCalled();
  });

  it('is wired to the close button in the markup', async () => {
    const api = makeApi();
    createRequirementsController({ orgId: 'org-1', t, api });
    // No `open()` call: the close button must still be safe to click on an idle panel.
    expect(() =>
      document
        .getElementById('requirements-close')!
        .dispatchEvent(new Event('click', { bubbles: true })),
    ).not.toThrow();
    expect(document.getElementById('requirements-panel')?.classList.contains('hidden')).toBe(true);
  });
});

describe('onStatusChange', () => {
  it('is told whenever the number status changes, so the list row can update itself', async () => {
    const api = makeApi();
    const onStatusChange = vi.fn();
    const controller = createRequirementsController({ orgId: 'org-1', t, api, onStatusChange });
    await controller.open('num-1', '+390212345678');

    expect(onStatusChange).toHaveBeenCalledWith('num-1', 'pending_regulatory', null);
  });
});

/** Resolves on demand, so a test can hold an in-flight request open across other actions. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('preserving unsaved input across a re-render', () => {
  it('a typed value survives a successful document upload and is what submit PUTs', async () => {
    const api = makeApi();
    const twoRequirements = view({
      requirements: [
        { id: 'r1', name: 'Business name', description: '', example: '', kind: 'textual' },
        { id: 'r2', name: 'Proof of address', description: '', example: '', kind: 'document' },
      ],
    });
    api.getNumberRequirements.mockResolvedValue(ok(twoRequirements));
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    const nameInput = document.querySelector<HTMLInputElement>(
      '[data-requirement-id="r1"] [data-field="value"]',
    )!;
    nameInput.value = 'Acme Inc';

    // The post-upload refetch echoes back a FRESH response object carrying the SAME
    // still-unsaved requirement value — a distinct object, exactly like a real network
    // round trip, not a cached reference (which would trivially dodge the bug this test
    // exists to catch: the server never learned about the typed name, since it was
    // never PUT, but the view object it returns is always brand new).
    api.getNumberRequirements.mockResolvedValue(
      ok({ ...twoRequirements, requirements: twoRequirements.requirements.map((r) => ({ ...r })) }),
    );
    const fileInput = document.querySelector<HTMLInputElement>(
      '[data-requirement-id="r2"] [data-field="file"]',
    )!;
    const file = new File(['%PDF-'], 'proof.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The upload's refetch rebuilds every field from the fresh response — the
    // typed-but-unsaved name must have survived that rebuild.
    const survivingInput = document.querySelector<HTMLInputElement>(
      '[data-requirement-id="r1"] [data-field="value"]',
    )!;
    expect(survivingInput.value).toBe('Acme Inc');

    document
      .getElementById('requirements-save')!
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(api.putNumberRequirements).toHaveBeenCalledWith(
      'org-1',
      'num-1',
      expect.arrayContaining([{ requirement_id: 'r1', value: 'Acme Inc' }]),
    );
  });

  it('a typed address survives a manual save-and-reload round trip that echoes it back', async () => {
    // Sanity check in the other direction: preserving unsaved input must never cause a
    // SUCCESSFUL save's own echoed-back value to go stale or duplicate — after a save,
    // the field simply keeps showing what was just saved.
    const api = makeApi();
    const withTextual = view({
      requirements: [
        { id: 'r1', name: 'Business name', description: '', example: '', kind: 'textual' },
      ],
    });
    api.getNumberRequirements.mockResolvedValue(ok(withTextual));
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    const input = document.querySelector<HTMLInputElement>(
      '[data-requirement-id="r1"] [data-field="value"]',
    )!;
    input.value = 'Acme Inc';
    api.putNumberRequirements.mockResolvedValue(
      ok(view({ requirements: [{ ...withTextual.requirements[0], value: 'Acme Inc' }] })),
    );

    document
      .getElementById('requirements-save')!
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    const after = document.querySelector<HTMLInputElement>(
      '[data-requirement-id="r1"] [data-field="value"]',
    )!;
    expect(after.value).toBe('Acme Inc');
  });
});

describe('stale async responses', () => {
  it('closing while the initial load is in flight keeps the panel hidden once it resolves', async () => {
    const api = makeApi();
    const gate = deferred<ReturnType<typeof ok<RequirementsView>>>();
    api.getNumberRequirements.mockReturnValue(gate.promise);
    const controller = createRequirementsController({ orgId: 'org-1', t, api });

    const opening = controller.open('num-1', '+390212345678');
    controller.close();
    gate.resolve(ok(view()));
    await opening;
    await Promise.resolve();

    expect(document.getElementById('requirements-panel')?.classList.contains('hidden')).toBe(true);
  });

  it('opening a second number while the first is still loading renders only the second', async () => {
    const api = makeApi();
    const gateA = deferred<ReturnType<typeof ok<RequirementsView>>>();
    const viewA = view({
      requirements: [
        { id: 'a1', name: 'Number A field', description: '', example: '', kind: 'textual' },
      ],
    });
    const viewB = view({
      requirements: [
        { id: 'b1', name: 'Number B field', description: '', example: '', kind: 'textual' },
      ],
    });
    api.getNumberRequirements.mockImplementation((_org: string, numberId: string) =>
      numberId === 'num-a' ? gateA.promise : Promise.resolve(ok(viewB)),
    );
    const controller = createRequirementsController({ orgId: 'org-1', t, api });

    const openingA = controller.open('num-a', '+3900000000');
    await controller.open('num-b', '+3911111111');
    gateA.resolve(ok(viewA));
    await openingA;
    await Promise.resolve();

    expect(document.querySelector('[data-requirement-id="b1"]')).not.toBeNull();
    expect(document.querySelector('[data-requirement-id="a1"]')).toBeNull();
    expect(document.getElementById('requirements-for')?.textContent).toBe('+3911111111');
  });

  it('a poll resolving after the panel is closed does nothing and never reopens it', async () => {
    vi.useFakeTimers();
    const api = makeApi();
    api.getNumberRequirements.mockResolvedValue(ok(view({ status: 'regulatory_review' })));
    const gate = deferred<ReturnType<typeof ok<{ status: string; status_reason: null }>>>();
    api.refreshNumberRequirements.mockReturnValue(gate.promise);
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    // Fires the first poll tick, which awaits `refresh` on `gate`.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    controller.close();
    gate.resolve(ok({ status: 'active', status_reason: null }));
    await vi.runAllTimersAsync();

    expect(document.getElementById('requirements-panel')?.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('requirements-approved')?.classList.contains('hidden')).toBe(
      true,
    );
  });
});

describe('clearing a field the customer had already saved', () => {
  it('keeps a textual field blank across a rebuild instead of resurrecting the saved value', async () => {
    const api = makeApi();
    const requirements = [
      { ...view().requirements[0], value: 'Acme Inc' },
      { id: 'r2', name: 'Proof', description: '', example: '', kind: 'document' as const },
    ];
    // A factory, not a single cached value: `dispatch` only rebuilds the field list
    // when `state.view`'s reference actually changes, so a fresh clone per call is
    // what makes this test exercise a real rebuild rather than passing vacuously.
    api.getNumberRequirements.mockImplementation(async () =>
      ok(view({ requirements: requirements.map((r) => ({ ...r })) })),
    );
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    const input = document.querySelector<HTMLInputElement>('[data-field="value"]')!;
    expect(input.value).toBe('Acme Inc');
    input.value = '';

    // Uploading a DIFFERENT requirement's document dispatches 'uploaded' with a fresh
    // server view, which rebuilds the whole field list — the exact rebuild the cleared
    // field must survive.
    const fileInput = document.querySelector<HTMLInputElement>('[data-field="file"]')!;
    const file = new File(['%PDF-'], 'proof.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const rebuiltInput = document.querySelector<HTMLInputElement>('[data-field="value"]')!;
    expect(rebuiltInput.value).toBe('');
  });
});

describe('a successful save echoes the server-normalised value', () => {
  it('shows the server-normalised value for a just-saved field, not the raw typed one', async () => {
    const api = makeApi();
    api.getNumberRequirements.mockImplementation(async () => ok(view()));
    api.putNumberRequirements.mockResolvedValue(
      ok(view({ requirements: [{ ...view().requirements[0], value: 'ACME INC' }] })),
    );
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    const input = document.querySelector<HTMLInputElement>('[data-field="value"]')!;
    input.value = 'acme inc';
    document
      .getElementById('requirements-save')!
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    const rebuiltInput = document.querySelector<HTMLInputElement>('[data-field="value"]')!;
    expect(rebuiltInput.value).toBe('ACME INC');
  });
});

describe('a manual refresh resets the background poll clock', () => {
  it('does not let the old schedule fire right after a manual refresh restarts the server throttle', async () => {
    // R3-poll-interval-equals-server-throttle: the server's `/refresh` throttle window
    // restarts on EVERY request, manual clicks included. If the background timer keeps
    // its old schedule, the very next automatic tick lands inside that fresh window and
    // is refused as `refresh_too_soon` — wasting one of the 40 poll attempts.
    vi.useFakeTimers();
    const api = makeApi();
    api.getNumberRequirements.mockResolvedValue(ok(view({ status: 'regulatory_review' })));
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    // Just before the original tick would fire, the customer clicks Refresh themselves.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1_000);
    document
      .getElementById('requirements-refresh')!
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(api.refreshNumberRequirements).toHaveBeenCalledTimes(1); // the manual click itself

    // The OLD schedule would have fired 1s from here — it must not.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(api.refreshNumberRequirements).toHaveBeenCalledTimes(1);

    // A full interval after the manual click, the background timer ticks again.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 2_000);
    expect(api.refreshNumberRequirements).toHaveBeenCalledTimes(2);
  });
});

describe('manual refresh whose follow-up fetch fails', () => {
  it('shows the localized error instead of leaving the panel stuck with no feedback', async () => {
    const api = makeApi();
    api.getNumberRequirements.mockResolvedValueOnce(ok(view({ status: 'regulatory_review' })));
    api.refreshNumberRequirements.mockResolvedValue(ok({ status: 'active', status_reason: null }));
    api.getNumberRequirements.mockResolvedValueOnce(fail('provider_unavailable', 502));
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    document
      .getElementById('requirements-refresh')!
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const error = document.getElementById('requirements-error');
    expect(error?.classList.contains('hidden')).toBe(false);
    expect(error?.textContent).toBe('phone.reason.provider_unavailable');
    // The order never actually resolved to active, so the panel must not claim it did.
    expect(document.getElementById('requirements-approved')?.classList.contains('hidden')).toBe(
      true,
    );
  });
});

describe('a stale background result after the panel already left review', () => {
  it('ignores a late poll result once a manual refresh has already moved the panel on', async () => {
    // R3-poll-result-applied-after-phase-left-review: an in-flight background tick's
    // result must not be applied once the panel has already left `review` for another
    // reason (here, a manual refresh resolving the order as rejected) — otherwise it
    // can drag the panel back into a phase mid-edit and rebuild the field list under
    // the customer.
    vi.useFakeTimers();
    const api = makeApi();
    // 1st: open(). 2nd: the MANUAL refresh's own full re-fetch, echoing rejected. 3rd: the
    // STALE background tick's full re-fetch, as if the order had gone active instead —
    // exactly what must be discarded.
    api.getNumberRequirements
      .mockResolvedValueOnce(ok(view({ status: 'regulatory_review' })))
      .mockResolvedValueOnce(
        ok(view({ status: 'regulatory_rejected', status_reason: 'Illegible ID scan' })),
      )
      .mockResolvedValueOnce(ok(view({ status: 'active' })));
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    const backgroundRefresh =
      deferred<ApiResult<{ status: string; status_reason: string | null }>>();
    api.refreshNumberRequirements.mockReturnValueOnce(backgroundRefresh.promise);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); // background tick starts, held open

    // A manual click races ahead and resolves the order as rejected.
    api.refreshNumberRequirements.mockResolvedValueOnce(
      ok({ status: 'regulatory_rejected', status_reason: 'Illegible ID scan' }),
    );
    document
      .getElementById('requirements-refresh')!
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('requirements-rejected')?.classList.contains('hidden')).toBe(
      false,
    );

    // The stale background tick now resolves as if the order had gone active instead.
    backgroundRefresh.resolve(ok({ status: 'active', status_reason: null }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('requirements-rejected')?.classList.contains('hidden')).toBe(
      false,
    );
    expect(document.getElementById('requirements-approved')?.classList.contains('hidden')).toBe(
      true,
    );
  });
});

describe('typed input is protected while a save is in flight', () => {
  it('disables textual and address inputs so nothing typed during a pending save can be silently wiped by its own echo', async () => {
    // R3-saved-rebuild-drops-edits-typed-during-save: `saved` treats every field that
    // was part of the PUT as authoritative and refills it from the server's echo,
    // discarding anything typed in the window between the request and its response.
    // Disabling those inputs while the save is in flight — exactly like the file input
    // already is — means there is no window in which a real customer could type
    // something that then gets wiped.
    const api = makeApi();
    api.getNumberRequirements.mockResolvedValue(
      ok(
        view({
          requirements: [
            { id: 'r1', name: 'Business name', description: '', example: '', kind: 'textual' },
            {
              id: 'r2',
              name: 'Registered address',
              description: '',
              example: '',
              kind: 'address',
            },
          ],
        }),
      ),
    );
    const gate = deferred<ReturnType<typeof ok<RequirementsView>>>();
    api.putNumberRequirements.mockReturnValue(gate.promise);
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    await controller.open('num-1', '+390212345678');

    document
      .getElementById('requirements-save')!
      .dispatchEvent(new Event('click', { bubbles: true }));

    const textInput = document.querySelector<HTMLInputElement>(
      '[data-requirement-id="r1"] [data-field="value"]',
    )!;
    const addressInput = document.querySelector<HTMLInputElement>(
      '[data-requirement-id="r2"] [data-field="locality"]',
    )!;
    expect(textInput.disabled).toBe(true);
    expect(addressInput.disabled).toBe(true);

    gate.resolve(ok(view()));
    await Promise.resolve();
    await Promise.resolve();

    // `renderList` replaces every field node on a `saved` rebuild — re-query rather
    // than trust the detached pre-rebuild reference.
    const rebuiltTextInput = document.querySelector<HTMLInputElement>(
      '[data-requirement-id="r1"] [data-field="value"]',
    )!;
    expect(rebuiltTextInput.disabled).toBe(false);
  });
});
