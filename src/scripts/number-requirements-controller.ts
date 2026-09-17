/**
 * Container for the number-order regulatory requirements panel (spec 0119).
 *
 * Wires `number-requirements.ts`'s pure reducer to the DOM markup rendered by
 * `RequirementsPanel.astro` and to the typed API client: fetching, saving, uploading,
 * submitting, and polling while a submission is under review. The presentational
 * template owns layout; this module owns state, requests, timers and DOM updates — the
 * same container/presentational split the rest of the dashboard follows.
 */
import {
  initialState,
  reduceRequirements,
  shouldContinuePolling,
  validateFile,
  POLL_INTERVAL_MS,
  type ReqAction,
  type ReqPhase,
  type ReqState,
} from './number-requirements';
import { refusalKey } from './phone-dialer';
import {
  getNumberRequirements,
  putNumberRequirements,
  refreshNumberRequirements,
  submitNumberRequirements,
  uploadRequirementDocument,
  type AddressValue,
  type RequirementsView,
} from '../lib/api';

type ApiDeps = {
  getNumberRequirements: typeof getNumberRequirements;
  putNumberRequirements: typeof putNumberRequirements;
  refreshNumberRequirements: typeof refreshNumberRequirements;
  submitNumberRequirements: typeof submitNumberRequirements;
  uploadRequirementDocument: typeof uploadRequirementDocument;
};

const DEFAULT_API: ApiDeps = {
  getNumberRequirements,
  putNumberRequirements,
  refreshNumberRequirements,
  submitNumberRequirements,
  uploadRequirementDocument,
};

export interface RequirementsControllerOptions {
  orgId: string;
  t: (key: string) => string;
  api?: Partial<ApiDeps>;
  /** Told the number's fresh status whenever it changes, so the numbers list can update
   *  its own row without the customer having to reload the page. */
  onStatusChange?: (numberId: string, status: string, statusReason: string | null) => void;
}

export interface RequirementsController {
  open(numberId: string, e164: string): Promise<void>;
  close(): void;
}

const ADDRESS_FIELDS = [
  'first_name',
  'last_name',
  'business_name',
  'street_address',
  'extended_address',
  'locality',
  'administrative_area',
  'postal_code',
  'country_code',
] as const;

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function show(id: string, visible: boolean): void {
  el(id)?.classList.toggle('hidden', !visible);
}

function errorOf(data: unknown): string {
  return (data as { error?: string } | null)?.error ?? 'generic';
}

/** What an assistive technology should say when the panel's phase changes. */
function statusAnnouncement(t: (key: string) => string, phase: ReqPhase): string {
  const key: Partial<Record<ReqPhase, string>> = {
    loading: 'phone.numbers.requirements.status.loading',
    saving: 'phone.numbers.requirements.status.saving',
    uploading: 'phone.numbers.requirements.status.uploading',
    submitting: 'phone.numbers.requirements.status.submitting',
    review: 'phone.numbers.requirements.status.review',
    active: 'phone.numbers.requirements.status.active',
    failed: 'phone.numbers.requirements.status.failed',
  };
  const translationKey = key[phase];
  return translationKey ? t(translationKey) : '';
}

export function createRequirementsController(
  opts: RequirementsControllerOptions,
): RequirementsController {
  const api: ApiDeps = { ...DEFAULT_API, ...opts.api };
  let state: ReqState = initialState;
  let numberId: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollAttempt = 0;

  // Bumped by every `open()` and `close()`. Every async operation (open/save/upload/
  // submit/poll) captures the generation it started with and checks it again after
  // each `await`: a mismatch means the panel was closed, or reopened for a DIFFERENT
  // number, while the request was in flight, and the now-stale result must be dropped
  // rather than applied — otherwise a slow response for number A can land on number B's
  // (or nobody's) open panel.
  let generation = 0;
  const isStale = (gen: number): boolean => gen !== generation;

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling(): void {
    stopPolling();
    pollAttempt = 0;
    pollTimer = setInterval(() => {
      pollAttempt += 1;
      if (!shouldContinuePolling(state.phase, pollAttempt)) {
        stopPolling();
        return;
      }
      void pollOnce();
    }, POLL_INTERVAL_MS);
  }

  function dispatch(action: ReqAction): void {
    const previousStatus = state.view?.status ?? null;
    const previousView = state.view;
    state = reduceRequirements(state, action);
    // Only actions that carry a fresh `view` (loaded/saved/uploaded/statusRefreshed)
    // actually replace `state.view`'s reference — every other action (save, uploadStart,
    // submit, dismissError…) leaves it untouched. Rebuilding the field list on those
    // would wipe whatever the customer is mid-typing in a requirement the action did not
    // touch, so the list is only ever re-rendered when the view itself changed.
    //
    // A `saved` rebuild is the one exception to "prefer what's on screen": the fields
    // that were JUST PUT are now authoritatively echoed by the server (which may have
    // normalised them — trimmed, upper-cased a country code), so those specific ids must
    // NOT be pulled back from the DOM snapshot. Every other field (typed but not part of
    // this save) still is.
    const authoritativeIds = action.type === 'saved' ? justSavedIds : EMPTY_IDS;
    if (action.type === 'saved') justSavedIds = EMPTY_IDS;
    render(state.view !== previousView, authoritativeIds);
    const nextStatus = state.view?.status ?? null;
    if (numberId && nextStatus && nextStatus !== previousStatus) {
      opts.onStatusChange?.(numberId, nextStatus, state.view?.status_reason ?? null);
    }
    if (state.phase !== 'review') stopPolling();
  }

  /**
   * One review check-in: the throttled `/refresh` first, and only a full re-fetch when
   * the status actually resolved — `/refresh` alone never carries the requirements
   * list.
   *
   * `manual` distinguishes a customer's own Refresh click from the background timer.
   * Silence is correct for the timer — it retries on its own next tick regardless — but
   * a customer who clicked a button and hit the server's 1/30s throttle (or any other
   * refusal) deserves to know why nothing happened, without being knocked out of the
   * review phase over it.
   */
  async function pollOnce(manual = false): Promise<void> {
    if (!numberId || !state.view) return;
    const gen = generation;
    const targetNumberId = numberId;
    const res = await api.refreshNumberRequirements(opts.orgId, targetNumberId);
    // The panel may have been closed (or reopened for another number) while this was in
    // flight — `state.view` can be null again by now, so this is checked before anything
    // below ever touches it, never merely assumed absent because the request failed.
    //
    // A phase that has already left `review` is just as stale as a closed panel, even
    // with the SAME generation: a manual refresh can resolve the order (moving phase to
    // `editing`/`active`/`failed`) while an earlier background tick is still in flight,
    // and that tick's own late result must not drag the panel back once something else
    // has already moved it on.
    if (isStale(gen) || !state.view || state.phase !== 'review') return;
    if (!res.ok || !res.data) {
      if (manual) dispatch({ type: 'refreshFailed', message: errorOf(res.data) });
      return; // background: a transient failure — the next poll tries again silently
    }
    if (res.data.status === 'regulatory_review') {
      dispatch({
        type: 'statusRefreshed',
        view: { ...state.view, status: res.data.status, status_reason: res.data.status_reason },
      });
      restartPollingAfterManualSuccess(manual);
      return;
    }
    const full = await api.getNumberRequirements(opts.orgId, targetNumberId);
    if (isStale(gen) || !state.view || state.phase !== 'review') return;
    if (full.ok && full.data) {
      dispatch({ type: 'statusRefreshed', view: full.data });
      restartPollingAfterManualSuccess(manual);
    } else if (manual) {
      // The order DID resolve (the /refresh above succeeded) but the follow-up fetch for
      // the full view failed — this is not "nothing happened", and a manual click
      // deserves to know, exactly like a refused /refresh itself does above.
      dispatch({ type: 'refreshFailed', message: errorOf(full.data) });
    }
  }

  /** A manual click that lands the panel back in `review` restarts the server's own
   *  30s throttle window — so the background timer must restart its OWN clock from
   *  here too, or the very next automatic tick lands inside that fresh window and is
   *  refused for nothing (see `POLL_INTERVAL_MS`'s own margin, which only covers
   *  ordinary jitter, not a manual click resetting the window early). A background
   *  tick's own success needs no such reset — it is already exactly on schedule. */
  function restartPollingAfterManualSuccess(manual: boolean): void {
    if (manual && state.phase === 'review') startPolling();
  }

  /** A textual or address requirement's currently typed value, snapshotted from the
   *  live DOM. Shared by `snapshotTypedValues` (what to keep across a rebuild) and
   *  `gatherValues` (what to PUT) so the two can never read a field differently. */
  function readTextual(node: Element): string | null {
    const input = node.querySelector<HTMLInputElement>('[data-field="value"]');
    return input ? input.value : null;
  }

  function readAddress(node: Element): Record<string, string> {
    const value: Record<string, string> = {};
    for (const field of ADDRESS_FIELDS) {
      value[field] = node.querySelector<HTMLInputElement>(`[data-field="${field}"]`)?.value ?? '';
    }
    return value;
  }

  type FieldSnapshot = Map<string, string | Record<string, string>>;

  /**
   * What the customer has currently typed into textual/address fields, taken right
   * before the field list is about to be rebuilt from a fresh server response.
   *
   * A rebuild (after `loaded`/`saved`/`uploaded`/`statusRefreshed`) replaces every
   * `<template>`-cloned field node with a brand new one filled from the server's own
   * view — which knows nothing about a value the customer typed but never saved (e.g.
   * while uploading a DIFFERENT requirement's document). Without this, that rebuild
   * silently erases it, and a subsequent save/submit sends the field as empty.
   */
  function snapshotTypedValues(exclude: ReadonlySet<string> = EMPTY_IDS): FieldSnapshot {
    const snapshot: FieldSnapshot = new Map();
    for (const node of document.querySelectorAll<HTMLElement>('[data-requirement-id]')) {
      const id = node.dataset.requirementId;
      if (!id || exclude.has(id)) continue;
      if (node.dataset.kind === 'textual') {
        const value = readTextual(node);
        // Captured unconditionally, including a blank value: a field the customer
        // cleared on purpose must stay blank across a rebuild, never resurrect its
        // last-saved server value (which `renderList` would otherwise fall back to).
        if (value !== null) snapshot.set(id, value);
      } else if (node.dataset.kind === 'address') {
        snapshot.set(id, readAddress(node));
      }
    }
    return snapshot;
  }

  function renderList(view: RequirementsView, preserved: FieldSnapshot): void {
    const list = el('requirements-list');
    if (!list) return;
    list.replaceChildren();
    for (const req of view.requirements) {
      const tmpl = el<HTMLTemplateElement>(`tmpl-requirement-${req.kind}`);
      const template = tmpl?.content.firstElementChild;
      if (!template) continue;
      const node = template.cloneNode(true) as HTMLElement;
      node.dataset.requirementId = req.id;
      node.dataset.kind = req.kind;

      const label = node.querySelector('[data-field-label]');
      if (label) label.textContent = req.name;
      const hint = node.querySelector('[data-field-hint]');
      if (hint) hint.textContent = req.description || req.example || '';

      if (req.kind === 'textual') {
        const input = node.querySelector<HTMLInputElement>('[data-field="value"]');
        const kept = preserved.get(req.id);
        if (input) {
          input.value =
            typeof kept === 'string' ? kept : typeof req.value === 'string' ? req.value : '';
        }
      } else if (req.kind === 'address') {
        const kept = preserved.get(req.id) as Record<string, string> | undefined;
        const serverValue = typeof req.value === 'object' ? (req.value as AddressValue) : undefined;
        for (const field of ADDRESS_FIELDS) {
          const input = node.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
          if (input) {
            input.value = kept?.[field] ?? (serverValue?.[field] as string | undefined) ?? '';
          }
        }
      } else {
        const input = node.querySelector<HTMLInputElement>('[data-field="file"]');
        const statusEl = node.querySelector('[data-field-status]');
        if (statusEl) {
          statusEl.textContent = req.document
            ? opts.t(`phone.numbers.requirements.scan.${req.document.av_scan_status}`)
            : '';
        }
        input?.addEventListener('change', () => void onFileChange(req.id, input));
      }
      list.appendChild(node);
    }
  }

  let justSavedIds: ReadonlySet<string> = new Set();
  const EMPTY_IDS: ReadonlySet<string> = new Set();

  function render(
    shouldRenderList: boolean,
    authoritativeIds: ReadonlySet<string> = EMPTY_IDS,
  ): void {
    const view = state.view;
    show('requirements-panel', state.phase !== 'idle');
    show('requirements-reused', !!view?.group.reused);
    show('requirements-rejected', view?.status === 'regulatory_rejected');
    if (view?.status === 'regulatory_rejected') {
      const reason = el('requirements-reject-reason');
      if (reason) reason.textContent = view.status_reason ?? '';
    }
    show('requirements-review-banner', state.phase === 'review');
    show('requirements-approved', state.phase === 'active');
    show('requirements-failed-banner', state.phase === 'failed');

    // A refused save/upload/submit is an error the customer fixes IN the form: keep it on
    // screen and actionable, and let the next action clear the error (see `recover`).
    const canAct = state.phase === 'editing' || isRecoverableError();
    const isEditable =
      canAct ||
      state.phase === 'saving' ||
      state.phase === 'uploading' ||
      state.phase === 'submitting';
    show('requirements-form', isEditable);
    const submitBtn = el<HTMLButtonElement>('requirements-submit');
    if (submitBtn) submitBtn.disabled = !canAct;
    const saveBtn = el<HTMLButtonElement>('requirements-save');
    if (saveBtn) saveBtn.disabled = !canAct;

    if (view && shouldRenderList) renderList(view, snapshotTypedValues(authoritativeIds));

    // A file input has no `disabled` handling of its own, and a `change` event fired
    // while a save/upload/submit is already in flight would otherwise reach
    // `onFileChange` — which the reducer's own `uploadStart` guard refuses, but only
    // AFTER the fact. Disabling the control up front is the honest UI: it is not
    // interactive right now, not merely ignored if used.
    for (const input of document.querySelectorAll<HTMLInputElement>(
      '[data-requirement-id] [data-field="file"]',
    )) {
      input.disabled = !canAct;
    }

    const statusRegion = el('requirements-status');
    if (statusRegion) statusRegion.textContent = statusAnnouncement(opts.t, state.phase);

    const errorBox = el('requirements-error');
    if (errorBox) {
      errorBox.classList.toggle('hidden', !state.errorMessage);
      if (state.errorMessage) errorBox.textContent = opts.t(refusalKey(state.errorMessage));
    }
  }

  function gatherValues(): { requirement_id: string; value: string | AddressValue }[] {
    const values: { requirement_id: string; value: string | AddressValue }[] = [];
    for (const node of document.querySelectorAll<HTMLElement>('[data-requirement-id]')) {
      const id = node.dataset.requirementId;
      if (!id) continue;
      if (node.dataset.kind === 'textual') {
        const value = readTextual(node);
        if (value !== null) values.push({ requirement_id: id, value });
      } else if (node.dataset.kind === 'address') {
        values.push({ requirement_id: id, value: readAddress(node) as unknown as AddressValue });
      }
    }
    return values;
  }

  /** Saves whatever is currently typed. Returns whether it landed cleanly, so `submit`
   *  can refuse to move on while a save failed. */
  function isRecoverableError(): boolean {
    return state.phase === 'error' && state.recoverTo === 'editing';
  }

  /** Leave a recoverable error before the customer's next attempt; the reducer only
   *  accepts save/upload/submit from `editing`. */
  function recover(): void {
    if (isRecoverableError()) dispatch({ type: 'dismissError' });
  }

  /** Saves whatever is currently typed. Returns whether it landed cleanly, so `submit`
   *  can refuse to move on while a save failed — and returns `false` (without touching
   *  state) when the panel was closed or reassigned to another number meanwhile. */
  async function save(): Promise<boolean> {
    if (!numberId) return false;
    const gen = generation;
    const targetNumberId = numberId;
    recover();
    const values = gatherValues();
    justSavedIds = new Set(values.map((v) => v.requirement_id));
    dispatch({ type: 'save' });
    const res = await api.putNumberRequirements(opts.orgId, targetNumberId, values);
    if (isStale(gen)) return false;
    if (res.ok && res.data) {
      dispatch({ type: 'saved', view: res.data });
      return true;
    }
    dispatch({ type: 'saveFailed', message: errorOf(res.data) });
    return false;
  }

  async function onFileChange(requirementId: string, input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file || !numberId) return;
    const gen = generation;
    const targetNumberId = numberId;
    recover();
    const problem = validateFile(file);
    if (problem) {
      dispatch({ type: 'uploadFailed', message: problem });
      input.value = '';
      return;
    }
    dispatch({ type: 'uploadStart', requirementId });
    // The reducer's own `uploadStart` guard refuses to leave `editing` for any OTHER
    // in-flight action (a save/submit already running) — if that happened, `state.phase`
    // is still whatever it was, never `uploading`, and no request must go out for it.
    if (state.phase !== 'uploading') return;
    const res = await api.uploadRequirementDocument(
      opts.orgId,
      targetNumberId,
      requirementId,
      file,
    );
    if (isStale(gen)) return;
    if (res.ok && res.data) {
      // The upload response only carries THIS requirement's document — refetch the full
      // view so the rest of the form (and the group's reuse flag) stays authoritative.
      const full = await api.getNumberRequirements(opts.orgId, targetNumberId);
      if (isStale(gen)) return;
      if (full.ok && full.data) {
        dispatch({ type: 'uploaded', view: full.data });
        return;
      }
      // The document itself uploaded successfully — only this follow-up refresh
      // failed. Reporting that as a refused upload would be false: the file IS
      // attached and scanning. Patch just this requirement's document status locally
      // instead, and say nothing about the refusal that never actually happened to the
      // upload itself.
      dispatch({ type: 'uploadedPartial', requirementId, document: res.data.document });
      return;
    }
    dispatch({ type: 'uploadFailed', message: errorOf(res.data) });
    // `uploadFailed` never replaces `state.view`, so the field list is not rebuilt —
    // meaning this exact input node survives and must be cleared by hand, or a customer
    // re-picking the SAME file never fires another `change` event to retry with.
    input.value = '';
  }

  async function submit(): Promise<void> {
    if (!numberId) return;
    const gen = generation;
    const targetNumberId = numberId;
    if (!(await save())) return;
    if (isStale(gen)) return;
    dispatch({ type: 'submit' });
    const res = await api.submitNumberRequirements(opts.orgId, targetNumberId);
    if (isStale(gen)) return;
    if (res.ok) {
      dispatch({ type: 'submitted' });
      startPolling();
      return;
    }
    dispatch({ type: 'submitFailed', message: errorOf(res.data) });
  }

  el('requirements-save')?.addEventListener('click', () => void save());
  el('requirements-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });
  el('requirements-refresh')?.addEventListener('click', () => void pollOnce(true));
  el('requirements-close')?.addEventListener('click', () => close());

  async function open(id: string, e164: string): Promise<void> {
    const gen = ++generation;
    numberId = id;
    state = initialState;
    const label = el('requirements-for');
    if (label) label.textContent = e164;
    // Clear any previously rendered fields immediately, synchronously — before the
    // fresh fetch even starts. Without this, a requirement id that happens to repeat
    // across two different numbers (the provider's own requirement ids are generic,
    // e.g. "business_name") could let `snapshotTypedValues()` carry a value typed for
    // the PREVIOUS number's field into this one's once it renders.
    el('requirements-list')?.replaceChildren();
    dispatch({ type: 'load' });
    const res = await api.getNumberRequirements(opts.orgId, id);
    if (isStale(gen)) return;
    if (res.ok && res.data) {
      dispatch({ type: 'loaded', view: res.data });
      if (state.phase === 'review') startPolling();
    } else {
      dispatch({ type: 'loadFailed', message: errorOf(res.data) });
    }
  }

  function close(): void {
    generation++;
    stopPolling();
    numberId = null;
    state = initialState;
    render(true);
    const list = el('requirements-list');
    list?.replaceChildren();
  }

  return { open, close };
}
