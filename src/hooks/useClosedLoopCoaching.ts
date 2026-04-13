/**
 * useClosedLoopCoaching — React hook for the teach → test → verify → decide loop.
 *
 * Surfaces call this to integrate Dave's closed-loop coaching into their flow.
 * The hook manages session state, persists to DB, and exposes actions for each phase.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { SkillFocus } from '@/lib/dojo/scenarios';
import {
  createClosedLoopSession,
  recordAttempt,
  verifyAttempt,
  applyVerification,
  selectNextConcept,
  buildRetryLaunchState,
  type ClosedLoopSession,
  type ClosedLoopVerification,
  type ClosedLoopAttempt,
} from '@/lib/daveClosedLoopEngine';
import { generateMicroCoaching, type MicroCoachingResponse } from '@/lib/daveMicroCoaching';
import {
  createClosedLoopRecord,
  saveAttemptAndVerification,
  markLoopCompleted,
  loadActiveLoop,
  isClosedLoopComplete,
  hasActiveLoopForConcept,
} from '@/lib/daveClosedLoopStore';
import { supabase } from '@/integrations/supabase/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useClosedLoopCoaching');

export interface ClosedLoopState {
  session: ClosedLoopSession | null;
  verification: ClosedLoopVerification | null;
  coaching: MicroCoachingResponse | null;
  isActive: boolean;
  /** Whether a persisted loop was restored */
  isResumed: boolean;
}

export function useClosedLoopCoaching() {
  const [state, setState] = useState<ClosedLoopState>({
    session: null,
    verification: null,
    coaching: null,
    isActive: false,
    isResumed: false,
  });
  const sessionRef = useRef<ClosedLoopSession | null>(null);
  const dbIdRef = useRef<string | null>(null);
  /** Guard against concurrent submitAttempt calls */
  const submittingRef = useRef(false);

  // ── Restore active loop on mount ────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const active = await loadActiveLoop(user.id);
      if (active && !cancelled) {
        logger.info('Restored active loop', { id: active.id, concept: active.taughtConcept, status: active.status });
        sessionRef.current = active;
        dbIdRef.current = active.id;
        setState({
          session: active,
          verification: null,
          coaching: null,
          isActive: active.status !== 'completed',
          isResumed: true,
        });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Step 1: Start teaching a concept. Creates a new closed-loop session.
   */
  const startTeaching = useCallback(async (
    skill: SkillFocus,
    concept: string,
    subSkill?: string,
    focusPattern?: string,
  ) => {
    // Check for duplicate
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const exists = await hasActiveLoopForConcept(user.id, skill, concept);
      if (exists) {
        logger.info('Duplicate loop prevented', { skill, concept });
        // Load existing loop instead of creating duplicate
        const active = await loadActiveLoop(user.id);
        if (active) {
          sessionRef.current = active;
          dbIdRef.current = active.id;
          setState({
            session: active,
            verification: null,
            coaching: null,
            isActive: true,
            isResumed: true,
          });
          return active;
        }
      }
    }

    const session = createClosedLoopSession(skill, concept, subSkill, focusPattern);
    sessionRef.current = session;
    setState({
      session,
      verification: null,
      coaching: null,
      isActive: true,
      isResumed: false,
    });

    // Persist to DB
    if (user) {
      const id = await createClosedLoopRecord(user.id, session);
      if (id) {
        dbIdRef.current = id;
        session.id = id;
        sessionRef.current = session;
        logger.info('Loop created', { id, skill, concept, subSkill });
      }
    }

    return session;
  }, []);

  /**
   * Step 2: Mark teaching as done, transition to testing.
   */
  const markReadyForTest = useCallback(() => {
    if (!sessionRef.current) return null;
    const updated = { ...sessionRef.current, status: 'testing' as const };
    sessionRef.current = updated;
    setState(s => ({ ...s, session: updated }));
    logger.info('Loop transitioned to testing', { id: updated.id, concept: updated.taughtConcept });

    // Persist status change — pass empty verification safely
    if (dbIdRef.current) {
      saveAttemptAndVerification(
        dbIdRef.current,
        updated.attempts,
        { outcome: 'missed', summary: '', improvedDimensions: [], weakDimensions: [], recommendedNextStep: 'retry_same_focus' },
        'testing',
        null,
      ).catch((err) => logger.error('Failed to persist testing transition', { error: err }));
    }

    return updated;
  }, []);

  /**
   * Step 3: Record a rep attempt with scoring dimensions.
   * Guarded against concurrent calls.
   */
  const submitAttempt = useCallback((
    attempt: Omit<ClosedLoopAttempt, 'timestamp'>,
  ) => {
    if (!sessionRef.current) return null;
    if (submittingRef.current) {
      logger.warn('submitAttempt called while already submitting — ignoring');
      return null;
    }
    submittingRef.current = true;

    try {
      const updated = recordAttempt(sessionRef.current, attempt);
      const verification = verifyAttempt(updated);
      const coaching = generateMicroCoaching(verification, updated);
      const finalSession = applyVerification(updated, verification);

      // Check for completion
      const complete = isClosedLoopComplete(finalSession);
      if (complete && finalSession.status !== 'completed') {
        finalSession.status = 'completed';
        finalSession.nextStep = 'move_to_next_concept';
        logger.info('Loop completed through mastery', { id: finalSession.id, concept: finalSession.taughtConcept, attempts: finalSession.attempts.length });
      } else {
        logger.info('Attempt recorded', {
          id: finalSession.id,
          outcome: verification.outcome,
          nextStep: verification.recommendedNextStep,
          status: finalSession.status,
          attemptCount: finalSession.attempts.length,
        });
      }

      sessionRef.current = finalSession;
      setState({
        session: finalSession,
        verification,
        coaching,
        isActive: finalSession.status !== 'completed',
        isResumed: false,
      });

      // Persist to DB
      if (dbIdRef.current) {
        if (complete) {
          markLoopCompleted(dbIdRef.current).catch((err) =>
            logger.error('Failed to persist completion', { error: err })
          );
        } else {
          saveAttemptAndVerification(
            dbIdRef.current,
            finalSession.attempts,
            verification,
            finalSession.status,
            finalSession.nextStep,
          ).catch((err) =>
            logger.error('Failed to persist attempt', { error: err })
          );
        }
      }

      return { session: finalSession, verification, coaching };
    } finally {
      submittingRef.current = false;
    }
  }, []);

  /**
   * Get launch state for a retry rep.
   */
  const getRetryLaunchState = useCallback(() => {
    if (!sessionRef.current) return null;
    return buildRetryLaunchState(sessionRef.current);
  }, []);

  /**
   * Advance to the next concept after completion.
   */
  const advanceToNext = useCallback(async () => {
    if (!sessionRef.current) return null;

    const next = selectNextConcept(
      sessionRef.current.skill,
      sessionRef.current.subSkill,
    );

    // Complete the current loop only after confirming there's a next step
    if (dbIdRef.current) {
      await markLoopCompleted(dbIdRef.current);
      logger.info('Loop marked completed before advance', { id: dbIdRef.current });
    }

    if (!next) {
      logger.info('No next concept available — loop ends');
      sessionRef.current = null;
      dbIdRef.current = null;
      setState({ session: null, verification: null, coaching: null, isActive: false, isResumed: false });
      return null;
    }

    const session = createClosedLoopSession(
      sessionRef.current.skill,
      next.concept,
      next.subSkill,
      next.focusPattern,
    );

    // Persist new loop
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const id = await createClosedLoopRecord(user.id, session);
      if (id) {
        dbIdRef.current = id;
        session.id = id;
        logger.info('Advanced to next concept', { id, concept: next.concept, subSkill: next.subSkill });
      }
    }

    sessionRef.current = session;
    setState({
      session,
      verification: null,
      coaching: null,
      isActive: true,
      isResumed: false,
    });
    return session;
  }, []);

  /**
   * End the loop.
   */
  const endLoop = useCallback(async () => {
    if (dbIdRef.current) {
      await markLoopCompleted(dbIdRef.current);
      logger.info('Loop ended by user', { id: dbIdRef.current });
    }
    sessionRef.current = null;
    dbIdRef.current = null;
    setState({ session: null, verification: null, coaching: null, isActive: false, isResumed: false });
  }, []);

  return {
    ...state,
    startTeaching,
    markReadyForTest,
    submitAttempt,
    getRetryLaunchState,
    advanceToNext,
    endLoop,
  };
}
