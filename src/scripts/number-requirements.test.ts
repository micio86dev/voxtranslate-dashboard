/**
 * Pure logic for the number-order regulatory requirements panel (spec 0119, dashboard).
 *
 * Everything here is framework-free: the CTA a number row shows, whether a file may be
 * attached to a document requirement, and the state machine the requirements panel walks
 * through. No DOM, no fetch — the controller (`number-requirements-controller.ts`, PR2)
 * wires this to the page and the API client.
 */
import { describe, it, expect } from 'vitest';
import {
  panelMode,
  validateFile,
  reduceRequirements,
  initialState,
  shouldContinuePolling,
  MAX_DOCUMENT_BYTES,
  MAX_POLL_ATTEMPTS,
  type ReqState,
} from './number-requirements';
import type { RequirementsView } from '../lib/api';

function view(over: Partial<RequirementsView> = {}): RequirementsView {
  return {
    status: 'pending_regulatory',
    status_reason: null,
    group: { status: 'pending', reused: false },
    requirements: [],
    ...over,
  };
}

describe('panelMode', () => {
  it('offers to fill requirements for a number stuck on pending_regulatory', () => {
    expect(panelMode('pending_regulatory')).toBe('fill');
  });

  it('offers to fix a rejected order', () => {
    expect(panelMode('regulatory_rejected')).toBe('fix');
  });

  it('shows the live review state while the provider decides', () => {
    expect(panelMode('regulatory_review')).toBe('review');
  });

  it('hides the panel for a number that needs nothing (active, undefined, null)', () => {
    expect(panelMode('active')).toBe('none');
    expect(panelMode(undefined)).toBe('none');
    expect(panelMode(null)).toBe('none');
  });
});

describe('validateFile', () => {
  it('accepts a small PDF', () => {
    expect(validateFile({ size: 1024, type: 'application/pdf' })).toBeNull();
  });

  it('accepts exactly the 10 MiB cap', () => {
    expect(validateFile({ size: MAX_DOCUMENT_BYTES, type: 'image/png' })).toBeNull();
  });

  it('refuses a file over the 10 MiB cap, mirroring the server (413)', () => {
    expect(validateFile({ size: MAX_DOCUMENT_BYTES + 1, type: 'application/pdf' })).toBe(
      'document_too_large',
    );
  });

  it('refuses an unsupported type before any byte reaches the network (415)', () => {
    expect(validateFile({ size: 100, type: 'application/zip' })).toBe('document_type_unsupported');
  });

  it('accepts every allowed type (pdf, png, jpeg)', () => {
    expect(validateFile({ size: 100, type: 'application/pdf' })).toBeNull();
    expect(validateFile({ size: 100, type: 'image/png' })).toBeNull();
    expect(validateFile({ size: 100, type: 'image/jpeg' })).toBeNull();
  });
});

describe('reduceRequirements', () => {
  it('starts idle', () => {
    expect(initialState.phase).toBe('idle');
  });

  it('moves to loading on load', () => {
    const s = reduceRequirements(initialState, { type: 'load' });
    expect(s.phase).toBe('loading');
  });

  it('lands on editing when the fetched view is pending_regulatory', () => {
    const s = reduceRequirements(
      { ...initialState, phase: 'loading' },
      { type: 'loaded', view: view({ status: 'pending_regulatory' }) },
    );
    expect(s.phase).toBe('editing');
    expect(s.view?.status).toBe('pending_regulatory');
  });

  it('lands on review when the fetched view is already in regulatory_review', () => {
    const s = reduceRequirements(
      { ...initialState, phase: 'loading' },
      { type: 'loaded', view: view({ status: 'regulatory_review' }) },
    );
    expect(s.phase).toBe('review');
  });

  it('lands on active when the fetched view already passed', () => {
    const s = reduceRequirements(
      { ...initialState, phase: 'loading' },
      { type: 'loaded', view: view({ status: 'active' }) },
    );
    expect(s.phase).toBe('active');
  });

  it('lands on failed when the fetched view is already failed', () => {
    const s = reduceRequirements(
      { ...initialState, phase: 'loading' },
      { type: 'loaded', view: view({ status: 'failed' }) },
    );
    expect(s.phase).toBe('failed');
  });

  it('carries a load failure into error with no recovery phase to go back to', () => {
    const s = reduceRequirements(
      { ...initialState, phase: 'loading' },
      { type: 'loadFailed', message: 'voip_misconfigured' },
    );
    expect(s.phase).toBe('error');
    expect(s.errorMessage).toBe('voip_misconfigured');
    expect(s.recoverTo).toBe('idle');
  });

  it('save only starts from editing — ignored from any other phase', () => {
    const fromLoading = reduceRequirements({ ...initialState, phase: 'loading' }, { type: 'save' });
    expect(fromLoading.phase).toBe('loading');

    const fromEditing = reduceRequirements(
      { ...initialState, phase: 'editing', view: view() },
      { type: 'save' },
    );
    expect(fromEditing.phase).toBe('saving');
  });

  it('returns to editing with the fresh view once saved', () => {
    const saving: ReqState = { ...initialState, phase: 'saving', view: view() };
    const s = reduceRequirements(saving, {
      type: 'saved',
      view: view({
        requirements: [
          { id: 'r1', name: 'n', description: 'd', example: 'e', kind: 'textual', value: 'x' },
        ],
      }),
    });
    expect(s.phase).toBe('editing');
    expect(s.view?.requirements).toHaveLength(1);
  });

  it('carries a refusal code into error and remembers editing as the way back', () => {
    const saving: ReqState = { ...initialState, phase: 'saving', view: view() };
    const s = reduceRequirements(saving, { type: 'saveFailed', message: 'value_too_long' });
    expect(s.phase).toBe('error');
    expect(s.errorMessage).toBe('value_too_long');
    expect(s.recoverTo).toBe('editing');
  });

  it('dismissError returns to the remembered phase and clears the message', () => {
    const errored: ReqState = {
      ...initialState,
      phase: 'error',
      errorMessage: 'requirements_incomplete',
      recoverTo: 'editing',
      view: view(),
    };
    const s = reduceRequirements(errored, { type: 'dismissError' });
    expect(s.phase).toBe('editing');
    expect(s.errorMessage).toBeNull();
  });

  it('tracks which requirement is mid-upload, then clears it on success', () => {
    const editing: ReqState = { ...initialState, phase: 'editing', view: view() };
    const uploading = reduceRequirements(editing, { type: 'uploadStart', requirementId: 'doc-1' });
    expect(uploading.phase).toBe('uploading');
    expect(uploading.uploadingRequirementId).toBe('doc-1');

    const uploaded = reduceRequirements(uploading, { type: 'uploaded', view: view() });
    expect(uploaded.phase).toBe('editing');
    expect(uploaded.uploadingRequirementId).toBeNull();
  });

  it('an upload failure clears the in-progress marker and remembers editing as the way back', () => {
    const uploading: ReqState = {
      ...initialState,
      phase: 'uploading',
      view: view(),
      uploadingRequirementId: 'doc-1',
    };
    const s = reduceRequirements(uploading, {
      type: 'uploadFailed',
      message: 'document_type_unsupported',
    });
    expect(s.phase).toBe('error');
    expect(s.errorMessage).toBe('document_type_unsupported');
    expect(s.recoverTo).toBe('editing');
    expect(s.uploadingRequirementId).toBeNull();
  });

  it('upload only starts from editing — ignored while already saving', () => {
    const saving: ReqState = { ...initialState, phase: 'saving', view: view() };
    const s = reduceRequirements(saving, { type: 'uploadStart', requirementId: 'doc-1' });
    expect(s.phase).toBe('saving');
  });

  it('submit moves editing to submitting, then submitted moves to review', () => {
    const editing: ReqState = { ...initialState, phase: 'editing', view: view() };
    const submitting = reduceRequirements(editing, { type: 'submit' });
    expect(submitting.phase).toBe('submitting');
    const reviewed = reduceRequirements(submitting, { type: 'submitted' });
    expect(reviewed.phase).toBe('review');
  });

  it('a failed submit returns to editing carrying the refusal', () => {
    const submitting: ReqState = { ...initialState, phase: 'submitting', view: view() };
    const s = reduceRequirements(submitting, {
      type: 'submitFailed',
      message: 'requirements_incomplete',
    });
    expect(s.phase).toBe('error');
    expect(s.recoverTo).toBe('editing');
  });

  it('a refreshed view during review can resolve to active', () => {
    const reviewing: ReqState = {
      ...initialState,
      phase: 'review',
      view: view({ status: 'regulatory_review' }),
    };
    const s = reduceRequirements(reviewing, {
      type: 'statusRefreshed',
      view: view({ status: 'active' }),
    });
    expect(s.phase).toBe('active');
  });

  it('a refreshed view during review can resolve to a rejection the customer can fix', () => {
    const reviewing: ReqState = {
      ...initialState,
      phase: 'review',
      view: view({ status: 'regulatory_review' }),
    };
    const s = reduceRequirements(reviewing, {
      type: 'statusRefreshed',
      view: view({ status: 'regulatory_rejected', status_reason: 'invalid document' }),
    });
    expect(s.phase).toBe('editing');
    expect(s.view?.status_reason).toBe('invalid document');
  });

  it('a refreshed view during review that is still pending stays in review', () => {
    const reviewing: ReqState = {
      ...initialState,
      phase: 'review',
      view: view({ status: 'regulatory_review' }),
    };
    const s = reduceRequirements(reviewing, {
      type: 'statusRefreshed',
      view: view({ status: 'regulatory_review' }),
    });
    expect(s.phase).toBe('review');
  });

  it('an unrecognised action leaves the state untouched', () => {
    const editing: ReqState = { ...initialState, phase: 'editing', view: view() };
    // @ts-expect-error — deliberately an action type this reducer does not define
    const s = reduceRequirements(editing, { type: 'nonsense' });
    expect(s).toEqual(editing);
  });
});

describe('shouldContinuePolling', () => {
  it('keeps polling in review under the attempt cap', () => {
    expect(shouldContinuePolling('review', 1)).toBe(true);
    expect(shouldContinuePolling('review', MAX_POLL_ATTEMPTS - 1)).toBe(true);
  });

  it('stops after 40 attempts even with no terminal status yet', () => {
    expect(shouldContinuePolling('review', MAX_POLL_ATTEMPTS)).toBe(false);
  });

  it('never polls outside the review phase', () => {
    expect(shouldContinuePolling('editing', 0)).toBe(false);
    expect(shouldContinuePolling('active', 0)).toBe(false);
  });
});
