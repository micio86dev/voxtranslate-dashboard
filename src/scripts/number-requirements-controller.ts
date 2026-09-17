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
    render(state.view !== previousView);
    const nextStatus = state.view?.status ?? null;
    if (numberId && nextStatus && nextStatus !== previousStatus) {
      opts.onStatusChange?.(numberId, nextStatus, state.view?.status_reason ?? null);
    }
    if (state.phase !== 'review') stopPolling();
  }

  /** One review poll: the throttled `/refresh` first, and only a full re-fetch when the
   *  status actually resolved — `/refresh` alone never carries the requirements list. */
  async function pollOnce(): Promise<void> {
    if (!numberId || !state.view) return;
    const res = await api.refreshNumberRequirements(opts.orgId, numberId);
    if (!res.ok || !res.data) return; // transient failure — the next poll tries again
    if (res.data.status === 'regulatory_review') {
      dispatch({
        type: 'statusRefreshed',
        view: { ...state.view, status: res.data.status, status_reason: res.data.status_reason },
      });
      return;
    }
    const full = await api.getNumberRequirements(opts.orgId, numberId);
    if (full.ok && full.data) dispatch({ type: 'statusRefreshed', view: full.data });
  }

  function renderList(view: RequirementsView): void {
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
        if (input) input.value = typeof req.value === 'string' ? req.value : '';
      } else if (req.kind === 'address') {
        const value = typeof req.value === 'object' ? (req.value as AddressValue) : undefined;
        for (const field of ADDRESS_FIELDS) {
          const input = node.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
          if (input) input.value = (value?.[field] as string | undefined) ?? '';
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

  function render(shouldRenderList: boolean): void {
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

    if (view && shouldRenderList) renderList(view);

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
        const input = node.querySelector<HTMLInputElement>('[data-field="value"]');
        if (input) values.push({ requirement_id: id, value: input.value });
      } else if (node.dataset.kind === 'address') {
        const value: Record<string, string> = {};
        for (const field of ADDRESS_FIELDS) {
          value[field] =
            node.querySelector<HTMLInputElement>(`[data-field="${field}"]`)?.value ?? '';
        }
        values.push({ requirement_id: id, value: value as unknown as AddressValue });
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

  async function save(): Promise<boolean> {
    if (!numberId) return false;
    recover();
    dispatch({ type: 'save' });
    const res = await api.putNumberRequirements(opts.orgId, numberId, gatherValues());
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
    recover();
    const problem = validateFile(file);
    if (problem) {
      dispatch({ type: 'uploadFailed', message: problem });
      input.value = '';
      return;
    }
    dispatch({ type: 'uploadStart', requirementId });
    const res = await api.uploadRequirementDocument(opts.orgId, numberId, requirementId, file);
    if (res.ok && res.data) {
      // The upload response only carries THIS requirement's document — refetch the full
      // view so the rest of the form (and the group's reuse flag) stays authoritative.
      const full = await api.getNumberRequirements(opts.orgId, numberId);
      if (full.ok && full.data) {
        dispatch({ type: 'uploaded', view: full.data });
        return;
      }
    }
    dispatch({ type: 'uploadFailed', message: errorOf(res.data) });
  }

  async function submit(): Promise<void> {
    if (!numberId) return;
    if (!(await save())) return;
    dispatch({ type: 'submit' });
    const res = await api.submitNumberRequirements(opts.orgId, numberId);
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
  el('requirements-refresh')?.addEventListener('click', () => void pollOnce());
  el('requirements-close')?.addEventListener('click', () => close());

  async function open(id: string, e164: string): Promise<void> {
    numberId = id;
    state = initialState;
    const label = el('requirements-for');
    if (label) label.textContent = e164;
    dispatch({ type: 'load' });
    const res = await api.getNumberRequirements(opts.orgId, id);
    if (res.ok && res.data) {
      dispatch({ type: 'loaded', view: res.data });
      if (state.phase === 'review') startPolling();
    } else {
      dispatch({ type: 'loadFailed', message: errorOf(res.data) });
    }
  }

  function close(): void {
    stopPolling();
    numberId = null;
    state = initialState;
    render(true);
    const list = el('requirements-list');
    list?.replaceChildren();
  }

  return { open, close };
}
