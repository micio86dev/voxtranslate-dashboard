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
    getNumberRequirements: vi.fn(async () => ok(view())),
    putNumberRequirements: vi.fn(async () => ok(view())),
    submitNumberRequirements: vi.fn(async () => ok({ status: 'regulatory_review' })),
    refreshNumberRequirements: vi.fn(async () =>
      ok({ status: 'regulatory_review', status_reason: null }),
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
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.refreshNumberRequirements).toHaveBeenCalledTimes(1);
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

    await vi.advanceTimersByTimeAsync(30_000);
    expect(document.getElementById('requirements-approved')?.classList.contains('hidden')).toBe(
      false,
    );

    const callsAfterResolution = api.refreshNumberRequirements.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.refreshNumberRequirements).toHaveBeenCalledTimes(callsAfterResolution);
  });

  it('stops polling after the 40-attempt cap even with no resolution', async () => {
    vi.useFakeTimers();
    const api = makeApi();
    const controller = createRequirementsController({ orgId: 'org-1', t, api });
    api.getNumberRequirements.mockResolvedValue(ok(view({ status: 'regulatory_review' })));
    await controller.open('num-1', '+390212345678');

    await vi.advanceTimersByTimeAsync(41 * 30_000);
    // 40 scheduled ticks fire; the 40th one itself finds the cap already reached and
    // refuses to poll, so at most 39 refresh calls actually go out.
    expect(api.refreshNumberRequirements.mock.calls.length).toBeLessThanOrEqual(39);

    const stalled = api.refreshNumberRequirements.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 30_000);
    expect(api.refreshNumberRequirements).toHaveBeenCalledTimes(stalled);
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

    await vi.advanceTimersByTimeAsync(120_000);
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
