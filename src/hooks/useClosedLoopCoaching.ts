/**
 * useClosedLoopCoaching — React hook for the teach → test → verify → decide loop.
 *
 * Surfaces call this to integrate Dave's closed-loop coaching into their flow.
 * The hook manages session state and exposes actions for each phase.
 */

import { useState, useCallback, useRef } from 'react';
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

export interface ClosedLoopState {
  session: ClosedLoopSession | null;
  verification: ClosedLoopVerification | null;
  coaching: MicroCoachingResponse | null;
  isActive: boolean;
}

export function useClosedLoopCoaching() {
  const [state, setState] = useState<ClosedLoopState>({
    session: null,
    verification: null,
    coaching: null,
    isActive: false,
  });
  const sessionRef = useRef<ClosedLoopSession | null>(null);

  /**
   * Step 1: Start teaching a concept. Creates a new closed-loop session.
   */
  const startTeaching = useCallback((
    skill: SkillFocus,
    concept: string,
    subSkill?: string,
    focusPattern?: string,
  ) => {
    const session = createClosedLoopSession(skill, concept, subSkill, focusPattern);
    sessionRef.current = session;
    setState({
      session,
      verification: null,
      coaching: null,
      isActive: true,
    });
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
    return updated;
  }, []);

  /**
   * Step 3: Record a rep attempt with scoring dimensions.
   */
  const submitAttempt = useCallback((
    attempt: Omit<ClosedLoopAttempt, 'timestamp'>,
  ) => {
    if (!sessionRef.current) return null;

    const updated = recordAttempt(sessionRef.current, attempt);
    const verification = verifyAttempt(updated);
    const coaching = generateMicroCoaching(verification, updated);
    const finalSession = applyVerification(updated, verification);

    sessionRef.current = finalSession;
    setState({
      session: finalSession,
      verification,
      coaching,
      isActive: finalSession.status !== 'completed' && finalSession.status !== 'needs_review',
    });

    return { session: finalSession, verification, coaching };
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
  const advanceToNext = useCallback(() => {
    if (!sessionRef.current) return null;

    const next = selectNextConcept(
      sessionRef.current.skill,
      sessionRef.current.subSkill,
    );
    if (!next) return null;

    const session = createClosedLoopSession(
      sessionRef.current.skill,
      next.concept,
      next.subSkill,
      next.focusPattern,
    );
    sessionRef.current = session;
    setState({
      session,
      verification: null,
      coaching: null,
      isActive: true,
    });
    return session;
  }, []);

  /**
   * End the loop.
   */
  const endLoop = useCallback(() => {
    sessionRef.current = null;
    setState({ session: null, verification: null, coaching: null, isActive: false });
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
