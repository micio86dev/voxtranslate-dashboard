/**
 * Pure logic for the number-order regulatory requirements panel (spec 0119, dashboard).
 *
 * Everything here is framework-free and side-effect-free: what CTA a number row shows
 * (`panelMode`), whether a file may be attached to a document requirement
 * (`validateFile`), the state machine the requirements panel walks through
 * (`reduceRequirements`), and the polling policy while a submission is under review
 * (`shouldContinuePolling`). No DOM, no `fetch` — the container
 * (`number-requirements-controller.ts`) wires this to the page and the API client.
 *
 * The reducer mirrors the real server-side status machine (`design`): a number lands on
 * this panel in `pending_regulatory` (fill in) or `regulatory_rejected` (fix and
 * resubmit) — both surfaced here as the `editing` phase, with `view.status` carrying
 * which one it actually is so the UI can show the rejection reason. Submitting moves it
 * to `regulatory_review`; refreshing (or polling) that view can resolve to `active`, back
 * to a fixable `regulatory_rejected` (still `editing`), or `failed`.
 */
import type { RequirementDocumentInfo, RequirementsView } from '../lib/api';

// --- Number row CTA ----------------------------------------------------------

/** Which action the numbers-page row offers for a number's regulatory status. */
export type PanelMode = 'none' | 'fill' | 'fix' | 'review';

/**
 * Derive the row's call-to-action straight from the number's own status — never
 * invented client-side, so a status this UI does not recognise yet hides the panel
 * rather than guessing at one.
 */
export function panelMode(status: string | null | undefined): PanelMode {
  switch (status) {
    case 'pending_regulatory':
      return 'fill';
    case 'regulatory_rejected':
      return 'fix';
    case 'regulatory_review':
      return 'review';
    default:
      return 'none';
  }
}

// --- Client-side file validation (defense in depth) --------------------------

/** Mirrors the server's own cap (`MAX_DOCUMENT_BYTES` in `regulatory.rs`) so an oversize
 *  file is refused before a single byte reaches the network. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const ALLOWED_DOCUMENT_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

/** Why a file was refused, named with the server's own refusal code so it maps straight
 *  through `phone.reason.*` without inventing new copy. */
export type FileRefusal = 'document_too_large' | 'document_type_unsupported';

/**
 * Client-side mirror of the server's document caps. This is UX only — the server
 * remains the authoritative enforcement point — but it saves the customer an upload
 * (and the org a rate-limit slot) for a file that could never be accepted.
 */
export function validateFile(file: { size: number; type: string }): FileRefusal | null {
  if (file.size > MAX_DOCUMENT_BYTES) return 'document_too_large';
  if (!ALLOWED_DOCUMENT_TYPES.has(file.type)) return 'document_type_unsupported';
  return null;
}

// --- Requirements panel state machine -----------------------------------------

export type ReqPhase =
  | 'idle'
  | 'loading'
  | 'editing'
  | 'saving'
  | 'uploading'
  | 'submitting'
  | 'review'
  | 'active'
  | 'failed'
  | 'error';

export interface ReqState {
  phase: ReqPhase;
  view: RequirementsView | null;
  /** The requirement whose document is mid-upload, or null when none is. */
  uploadingRequirementId: string | null;
  errorMessage: string | null;
  /** Where `dismissError` returns to once the error is acknowledged. */
  recoverTo: ReqPhase;
}

export const initialState: ReqState = {
  phase: 'idle',
  view: null,
  uploadingRequirementId: null,
  errorMessage: null,
  recoverTo: 'idle',
};

export type ReqAction =
  | { type: 'load' }
  | { type: 'loaded'; view: RequirementsView }
  | { type: 'loadFailed'; message: string }
  | { type: 'save' }
  | { type: 'saved'; view: RequirementsView }
  | { type: 'saveFailed'; message: string }
  | { type: 'uploadStart'; requirementId: string }
  | { type: 'uploaded'; view: RequirementsView }
  | { type: 'uploadFailed'; message: string }
  | { type: 'submit' }
  | { type: 'submitted' }
  | { type: 'submitFailed'; message: string }
  | { type: 'statusRefreshed'; view: RequirementsView }
  | { type: 'refreshFailed'; message: string }
  | { type: 'uploadedPartial'; requirementId: string; document: RequirementDocumentInfo }
  | { type: 'dismissError' };

/** The phase a just-(re)loaded view settles into, driven entirely by its own status. */
function phaseForView(view: RequirementsView): ReqPhase {
  switch (view.status) {
    case 'regulatory_review':
      return 'review';
    case 'active':
      return 'active';
    case 'failed':
      return 'failed';
    // `pending_regulatory` and `regulatory_rejected` are both editable — the rejection
    // reason lives on `view.status_reason`/`view.status` for the UI to show, not on the
    // reducer's own phase.
    default:
      return 'editing';
  }
}

function toError(state: ReqState, message: string, recoverTo: ReqPhase): ReqState {
  return { ...state, phase: 'error', errorMessage: message, recoverTo };
}

function withView(state: ReqState, view: RequirementsView): ReqState {
  return { ...state, view };
}

/**
 * Advance the panel's state machine one action at a time. Pure: same `(state, action)`
 * always yields the same next state, so the controller only ever needs to dispatch —
 * never to reason about what is "supposed" to happen next.
 */
export function reduceRequirements(state: ReqState, action: ReqAction): ReqState {
  switch (action.type) {
    case 'load':
      return { ...state, phase: 'loading' };

    case 'loaded':
      return { ...withView(state, action.view), phase: phaseForView(action.view) };

    case 'loadFailed':
      // No prior view to fall back into editing on — dismissing goes to idle, which
      // re-triggers a load rather than showing a stale (or absent) form.
      return toError(state, action.message, 'idle');

    case 'save':
      return state.phase === 'editing' ? { ...state, phase: 'saving' } : state;

    case 'saved':
      return { ...withView(state, action.view), phase: 'editing' };

    case 'saveFailed':
      return toError(state, action.message, 'editing');

    case 'uploadStart':
      return state.phase === 'editing'
        ? { ...state, phase: 'uploading', uploadingRequirementId: action.requirementId }
        : state;

    case 'uploaded':
      return {
        ...withView(state, action.view),
        phase: 'editing',
        uploadingRequirementId: null,
      };

    case 'uploadFailed':
      return { ...toError(state, action.message, 'editing'), uploadingRequirementId: null };

    case 'submit':
      return state.phase === 'editing' ? { ...state, phase: 'submitting' } : state;

    case 'submitted': {
      // The view's own status must move to `regulatory_review` immediately, not just
      // the phase — otherwise a stale `regulatory_rejected` (from resubmitting a
      // rejected order) lingers on the view, so the rejected banner and the review
      // banner render together, and nothing tells the numbers list the status changed
      // (that only happens when `view.status` itself changes).
      if (!state.view) return { ...state, phase: 'review' };
      return {
        ...state,
        phase: 'review',
        view: { ...state.view, status: 'regulatory_review', status_reason: null },
      };
    }

    case 'submitFailed':
      return toError(state, action.message, 'editing');

    case 'statusRefreshed':
      // A fresh status also retires any earlier manual-refresh refusal (`refreshFailed`)
      // still on screen — the very refresh this resolves.
      return {
        ...withView(state, action.view),
        phase: phaseForView(action.view),
        errorMessage: null,
      };

    case 'refreshFailed':
      // A manual refresh's own refusal (e.g. `refresh_too_soon`), surfaced WITHOUT
      // leaving the review phase — the submission is still under review, only this
      // particular check-in failed. A background poll's failure never reaches here (see
      // the controller's `pollOnce`), so this never fires silently.
      return { ...state, errorMessage: action.message };

    case 'uploadedPartial': {
      // The document itself uploaded successfully — only the follow-up full refetch
      // failed. Patch just this one requirement's document in place rather than
      // reporting a refusal for an upload that actually succeeded, and rather than
      // discarding the rest of the form (which a full `uploaded`-style replace would
      // require a fresh view for).
      if (!state.view) {
        return { ...state, phase: 'editing', uploadingRequirementId: null };
      }
      const requirements = state.view.requirements.map((r) =>
        r.id === action.requirementId ? { ...r, document: action.document } : r,
      );
      return {
        ...state,
        phase: 'editing',
        uploadingRequirementId: null,
        view: { ...state.view, requirements },
      };
    }

    case 'dismissError':
      return { ...state, phase: state.recoverTo, errorMessage: null, recoverTo: 'idle' };

    default:
      return state;
  }
}

// --- Poll policy while a submission is under review ---------------------------

/** How often the controller re-checks status while the panel is open and in review. */
// 5s above the server's own 1-per-30s `/refresh` throttle: exactly matching it means
// network jitter alone makes a background tick land just under 30s since the last
// request and get refused as `refresh_too_soon` — wasting one of the 40 poll attempts
// for nothing. A manual refresh also restarts the server's window (see the controller's
// `startPolling()` call after a manual success), so this margin has to hold for THAT
// case too, not just steady background ticking.
export const POLL_INTERVAL_MS = 35_000;

/** After this many polls with no terminal status, the controller stops rather than
 *  running forever — a review that never resolves is a support case, not a busy-loop. */
export const MAX_POLL_ATTEMPTS = 40;

export function shouldContinuePolling(phase: ReqPhase, attempt: number): boolean {
  return phase === 'review' && attempt < MAX_POLL_ATTEMPTS;
}
