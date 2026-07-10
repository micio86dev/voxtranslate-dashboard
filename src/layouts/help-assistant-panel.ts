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
export function buildTranscriptBubble(
  role: 'user' | 'assistant',
  delta: string,
): TranscriptBubble {
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
  mic_denied: 'helpAssistant.micDenied',
  ws_error: 'helpAssistant.wsError',
};

/**
 * Map a Help Assistant error code to an i18n key in the helpAssistant namespace.
 * Falls back to helpAssistant.wsError for any unknown code.
 */
export function resolveHaErrorKey(code: string): string {
  return ERROR_KEY_MAP[code] ?? 'helpAssistant.wsError';
}
