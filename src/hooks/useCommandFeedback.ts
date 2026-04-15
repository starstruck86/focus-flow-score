/**
 * useCommandFeedback — captures lightweight interaction signals for adaptive learning.
 * Writes to command_feedback table. Fire-and-forget; never blocks UI.
 *
 * Signals captured with full attribution metadata so future adaptation
 * can rank templates, shortcuts, KI themes, and output styles.
 */
import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

export type FeedbackSignal =
  | 'regenerated'
  | 'edited'
  | 'copied_section'
  | 'copied_all'
  | 'saved_template'
  | 'trimmed'
  | 'reused_shortcut'
  | 'edited_before_copy';

interface FeedbackContext {
  templateId?: string;
  templateName?: string;
  accountId?: string;
  sectionHeading?: string;
  /** Arbitrary metadata — output length, KI count, shortcut id, etc. */
  metadata?: Record<string, unknown>;
}

export function useCommandFeedback() {
  const { user } = useAuth();

  const capture = useCallback((signal: FeedbackSignal, ctx: FeedbackContext = {}) => {
    if (!user) return;

    // Fire and forget
    supabase
      .from('command_feedback' as any)
      .insert({
        user_id: user.id,
        signal_type: signal,
        template_id: ctx.templateId || null,
        template_name: ctx.templateName || null,
        account_id: ctx.accountId || null,
        section_heading: ctx.sectionHeading || null,
        metadata: ctx.metadata || null,
      } as any)
      .then(() => {});
  }, [user]);

  return { capture };
}
