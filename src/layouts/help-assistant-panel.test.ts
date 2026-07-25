/**
 * Unit tests for the Help Assistant floating panel UI helpers.
 *
 * These tests cover pure/extractable functions that drive DOM state transitions
 * in BaseLayout.astro's inline script. By extracting the logic into pure
 * functions we can test it without a browser.
 *
 * Coverage:
 *   - buildMicState: returns the correct button classes and labels for each VoiceAssistantState
 *   - buildTranscriptBubble: returns the correct bubble element description
 *   - togglePanel: toggles the isPanelOpen flag (pure state logic)
 *   - resolveErrorMessage: maps error codes to i18n keys
 */
import { describe, it, expect } from 'vitest';
import {
  buildMicState,
  buildTranscriptBubble,
  togglePanelState,
  resolveHaErrorKey,
  type MicStateDescriptor,
  type TranscriptBubble,
} from './help-assistant-panel';

// ---------------------------------------------------------------------------
// buildMicState
// ---------------------------------------------------------------------------

describe('buildMicState', () => {
  it('returns btn-ghost class and startLabel key for Idle state', () => {
    const result: MicStateDescriptor = buildMicState('idle');
    expect(result.primaryClass).toBe('btn-ghost');
    expect(result.labelKey).toBe('helpAssistant.startLabel');
    expect(result.disabled).toBe(false);
    expect(result.pulse).toBe(false);
  });

  it('returns btn-ghost + disabled + pulse for Connecting state', () => {
    const result: MicStateDescriptor = buildMicState('connecting');
    expect(result.primaryClass).toBe('btn-ghost');
    expect(result.labelKey).toBe('helpAssistant.connecting');
    expect(result.disabled).toBe(true);
    expect(result.pulse).toBe(true);
  });

  it('returns btn-primary class and stopLabel key for Listening state', () => {
    const result: MicStateDescriptor = buildMicState('listening');
    expect(result.primaryClass).toBe('btn-primary');
    expect(result.labelKey).toBe('helpAssistant.stopLabel');
    expect(result.disabled).toBe(false);
    expect(result.pulse).toBe(false);
  });

  it('returns btn-primary class and speaking key for Speaking state', () => {
    const result: MicStateDescriptor = buildMicState('speaking');
    expect(result.primaryClass).toBe('btn-primary');
    expect(result.labelKey).toBe('helpAssistant.speaking');
    expect(result.disabled).toBe(false);
    expect(result.pulse).toBe(true);
  });

  it('returns text-red-500 btn-ghost and errorLabel key for Error state', () => {
    const result: MicStateDescriptor = buildMicState('error');
    expect(result.primaryClass).toContain('text-red-500');
    expect(result.primaryClass).toContain('btn-ghost');
    expect(result.labelKey).toBe('helpAssistant.errorLabel');
    expect(result.disabled).toBe(false);
    expect(result.pulse).toBe(false);
  });

  it('falls back to Idle descriptor for an unknown state string', () => {
    const result: MicStateDescriptor = buildMicState('unknown_state_xyz');
    expect(result.primaryClass).toBe('btn-ghost');
    expect(result.labelKey).toBe('helpAssistant.startLabel');
  });
});

// ---------------------------------------------------------------------------
// buildTranscriptBubble
// ---------------------------------------------------------------------------

describe('buildTranscriptBubble', () => {
  it('returns user class for role user', () => {
    const result: TranscriptBubble = buildTranscriptBubble('user', 'Hello');
    expect(result.className).toBe('text-muted text-xs');
    expect(result.text).toBe('Hello');
    expect(result.role).toBe('user');
  });

  it('returns assistant class for role assistant', () => {
    const result: TranscriptBubble = buildTranscriptBubble('assistant', 'Hi there!');
    expect(result.className).toBe('font-medium text-sm');
    expect(result.text).toBe('Hi there!');
    expect(result.role).toBe('assistant');
  });

  it('preserves the delta text unchanged', () => {
    const delta = 'A chunk of streamed text with special chars: <>&"';
    const result: TranscriptBubble = buildTranscriptBubble('assistant', delta);
    expect(result.text).toBe(delta);
  });
});

// ---------------------------------------------------------------------------
// togglePanelState
// ---------------------------------------------------------------------------

describe('togglePanelState', () => {
  it('returns true when panel was closed (false → true)', () => {
    expect(togglePanelState(false)).toBe(true);
  });

  it('returns false when panel was open (true → false)', () => {
    expect(togglePanelState(true)).toBe(false);
  });

  it('toggles back to original state after two toggles', () => {
    const initial = false;
    const afterOne = togglePanelState(initial);
    const afterTwo = togglePanelState(afterOne);
    expect(afterTwo).toBe(initial);
  });
});

// ---------------------------------------------------------------------------
// resolveHaErrorKey
// ---------------------------------------------------------------------------

describe('resolveHaErrorKey', () => {
  it('maps capacity_full to helpAssistant.capacityFull', () => {
    expect(resolveHaErrorKey('capacity_full')).toBe('helpAssistant.capacityFull');
  });

  it('maps credits_exhausted to helpAssistant.creditsExhausted', () => {
    expect(resolveHaErrorKey('credits_exhausted')).toBe('helpAssistant.creditsExhausted');
  });

  it('maps mic_denied to helpAssistant.micDenied', () => {
    expect(resolveHaErrorKey('mic_denied')).toBe('helpAssistant.micDenied');
  });

  it('maps ws_error to helpAssistant.wsError', () => {
    expect(resolveHaErrorKey('ws_error')).toBe('helpAssistant.wsError');
  });

  it('maps any unknown code to helpAssistant.wsError as a safe fallback', () => {
    expect(resolveHaErrorKey('some_unknown_code')).toBe('helpAssistant.wsError');
  });
});
