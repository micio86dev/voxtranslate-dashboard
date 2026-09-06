/**
 * Pure UI-logic helpers for the Help Assistant floating panel.
 *
 * These functions are extracted from BaseLayout.astro's inline script so they
 * can be unit-tested without a browser. They are intentionally side-effect-free:
 * they return descriptors/values that the caller applies to the DOM.
 *
 * Functions:
 *   buildMicState        — maps a VoiceAssistantState string to button class + label i18n key
 *   buildTranscriptBubble — produces the CSS class + text for a transcript entry
 *   togglePanelState      — pure boolean toggle for the panel open/closed flag
 *   resolveHaErrorKey     — maps an error code string to the helpAssistant i18n key
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MicStateDescriptor {
  /** The Tailwind class(es) to set as the button's primary class (replaces btn-ghost / btn-primary). */
  primaryClass: string;
  /** The i18n key to use as the button label text. */
  labelKey: string;
  /** Whether the button should be disabled (e.g. while connecting). */
  disabled: boolean;
  /** Whether the mic icon should show the animate-pulse class. */
  pulse: boolean;
}

export interface TranscriptBubble {
  /** The CSS class for the bubble paragraph element. */
  className: string;
  /** The text content for the bubble. */
  text: string;
  /** The role that produced this bubble. */
  role: 'user' | 'assistant';
}

// ---------------------------------------------------------------------------
// buildMicState
// ---------------------------------------------------------------------------

/**
 * Map a VoiceAssistantState string value to the descriptor that drives the
 * Help Assistant mic button appearance.
 *
 * Mirrors the setButtonState logic in insights.astro but adapted for the
 * helpAssistant i18n namespace and the floating-panel context.
 */
export function buildMicState(state: string): MicStateDescriptor {
  switch (state) {
    case 'connecting':
      return {
        primaryClass: 'btn-ghost',
        labelKey: 'helpAssistant.connecting',
        disabled: true,
        pulse: true,
      };

    case 'listening':
      return {
        primaryClass: 'btn-primary',
        labelKey: 'helpAssistant.stopLabel',
        disabled: false,
        pulse: false,
      };

    case 'speaking':
      return {
        primaryClass: 'btn-primary',
        labelKey: 'helpAssistant.speaking',
        disabled: false,
        pulse: true,
      };

    case 'error':
      return {
        primaryClass: 'text-red-500 btn-ghost',
        labelKey: 'helpAssistant.errorLabel',
        disabled: false,
        pulse: false,
      };

    // 'idle' and any unknown state fall back to idle appearance
    case 'idle':
    default:
      return {
        primaryClass: 'btn-ghost',
        labelKey: 'helpAssistant.startLabel',
        disabled: false,
        pulse: false,
      };
  }
}

// ---------------------------------------------------------------------------
// buildTranscriptBubble
// ---------------------------------------------------------------------------

/**
 * Produce the CSS class and text for a transcript bubble paragraph element.
 * Mirrors the appendTranscript helper used in insights.astro.
 */
export function buildTranscriptBubble(role: 'user' | 'assistant', delta: string): TranscriptBubble {
  return {
    role,
    text: delta,
    className: role === 'user' ? 'text-muted text-xs' : 'font-medium text-sm',
  };
}

// ---------------------------------------------------------------------------
// togglePanelState
// ---------------------------------------------------------------------------

/**
 * Pure toggle: given the current panel open/closed state, return the next state.
 */
export function togglePanelState(isOpen: boolean): boolean {
  return !isOpen;
}

// ---------------------------------------------------------------------------
// resolveHaErrorKey
// ---------------------------------------------------------------------------

const ERROR_KEY_MAP: Record<string, string> = {
  capacity_full: 'helpAssistant.capacityFull',
  credits_exhausted: 'helpAssistant.creditsExhausted',
  insufficient_credits: 'helpAssistant.insufficientCredits',
  mic_denied: 'helpAssistant.micDenied',
  subscription_required: 'helpAssistant.subscriptionRequired',
  ws_error: 'helpAssistant.wsError',
};

/** Where a refusal the user can fix should send them, and what the button says. */
export interface HaErrorCta {
  /** Route name, localized by the caller via `localizePath`. */
  path: 'credits';
  /** In-page anchor, or '' for the top of the page. */
  hash: string;
  labelKey: string;
}

/**
 * The way out of a refusal, when there is one.
 *
 * The server sends these codes with an `action` precisely so the panel can offer
 * a button instead of a dead end — an expired subscription is not something the
 * user fixes by clicking "retry". Failures they cannot act on (network, mic
 * permission, capacity) get `null`: retrying really is the only move, and a
 * button to the billing page would be a wrong turn.
 */
export function resolveHaErrorCta(code: string): HaErrorCta | null {
  switch (code) {
    case 'subscription_required':
      // #plans lands on the comparison, where checkout starts.
      return { path: 'credits', hash: '#plans', labelKey: 'helpAssistant.ctaSubscribe' };
    case 'insufficient_credits':
    case 'credits_exhausted':
      return { path: 'credits', hash: '', labelKey: 'helpAssistant.ctaBuyCredits' };
    default:
      return null;
  }
}

/**
 * Map a Help Assistant error code to an i18n key in the helpAssistant namespace.
 * Falls back to helpAssistant.wsError for any unknown code.
 */
export function resolveHaErrorKey(code: string): string {
  return ERROR_KEY_MAP[code] ?? 'helpAssistant.wsError';
}
