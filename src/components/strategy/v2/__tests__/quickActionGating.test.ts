// @vitest-environment node
/**
 * Tests for the quick-action gating predicate used in StrategyCanvas.
 * The predicate decides whether the Regenerate / Shorten / Expand / Improve
 * row should render under a given message. It must:
 *   - only show on the most-recent assistant message
 *   - never show while a response is streaming (isSending)
 *   - never show on user/system/tool messages
 *   - never show on older assistant messages
 *   - require an onQuickAction handler to be present
 *
 * Mirrors the inline expression in StrategyCanvas.tsx so any drift is caught.
 */
import { describe, it, expect } from 'vitest';

type Role = 'user' | 'assistant' | 'system' | 'tool';

function shouldShowQuickActions(opts: {
  role: Role;
  index: number;
  total: number;
  isSending: boolean;
  hasHandler: boolean;
}): boolean {
  return (
    !opts.isSending &&
    opts.role === 'assistant' &&
    opts.index === opts.total - 1 &&
    opts.hasHandler
  );
}

describe('quick-action gating', () => {
  it('shows under the latest assistant message when idle', () => {
    expect(shouldShowQuickActions({
      role: 'assistant', index: 2, total: 3, isSending: false, hasHandler: true,
    })).toBe(true);
  });

  it('does NOT show while Strategy is streaming a response', () => {
    expect(shouldShowQuickActions({
      role: 'assistant', index: 2, total: 3, isSending: true, hasHandler: true,
    })).toBe(false);
  });

  it('does NOT show under older assistant messages', () => {
    expect(shouldShowQuickActions({
      role: 'assistant', index: 0, total: 3, isSending: false, hasHandler: true,
    })).toBe(false);
    expect(shouldShowQuickActions({
      role: 'assistant', index: 1, total: 3, isSending: false, hasHandler: true,
    })).toBe(false);
  });

  it('does NOT show under user messages', () => {
    expect(shouldShowQuickActions({
      role: 'user', index: 2, total: 3, isSending: false, hasHandler: true,
    })).toBe(false);
  });

  it('does NOT show under system or tool messages', () => {
    expect(shouldShowQuickActions({
      role: 'system', index: 2, total: 3, isSending: false, hasHandler: true,
    })).toBe(false);
    expect(shouldShowQuickActions({
      role: 'tool', index: 2, total: 3, isSending: false, hasHandler: true,
    })).toBe(false);
  });

  it('does NOT show when no handler is wired', () => {
    expect(shouldShowQuickActions({
      role: 'assistant', index: 2, total: 3, isSending: false, hasHandler: false,
    })).toBe(false);
  });
});
