/**
 * Hook: useProspectingEngine
 * Step-driven execution system. Persists cycle state to localStorage.
 * Always surfaces ONE next action. Never a blank state.
 */
import { useState, useMemo, useCallback } from 'react';
import { useStore } from '@/store/useStore';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import {
  generateDailyPlan,
  buildWeeklyProgress,
  getTierStatus,
  resolveNextAction,
  completeStepInState,
  emptyState,
  PROSPECTING_STEPS,
  type ProspectingState,
  type ProspectingStepId,
} from '@/lib/prospectingEngine';

const STORAGE_KEY = 'prospecting-state';

function loadState(date: string): ProspectingState {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}-${date}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.date === date) return parsed;
    }
  } catch {}
  return emptyState(date);
}

function saveState(state: ProspectingState) {
  localStorage.setItem(`${STORAGE_KEY}-${state.date}`, JSON.stringify(state));
}

export function useProspectingEngine() {
  const { accounts, contacts, days } = useStore();
  const { data: calendarEvents } = useCalendarEvents();
  const today = new Date().toISOString().split('T')[0];

  const [state, setState] = useState<ProspectingState>(() => loadState(today));

  // Meeting hours
  const meetingHoursToday = useMemo(() => {
    if (!calendarEvents?.length) return 0;
    const todayStart = new Date(today + 'T00:00:00');
    const todayEnd = new Date(today + 'T23:59:59');
    let totalMinutes = 0;
    for (const ev of calendarEvents) {
      const start = new Date(ev.start_time);
      const end = ev.end_time ? new Date(ev.end_time) : new Date(start.getTime() + 30 * 60000);
      if (start >= todayStart && start <= todayEnd) {
        totalMinutes += (end.getTime() - start.getTime()) / 60000;
      }
    }
    return totalMinutes / 60;
  }, [calendarEvents, today]);

  // Weekly progress from store data
  const weeklyProgress = useMemo(() => {
    const accountRows = accounts.map(a => ({ createdAt: a.createdAt }));
    const contactRows = contacts.map(c => ({ created_at: c.createdAt }));
    const journalEntries = days.map(d => ({
      date: d.date,
      prospects_added: d.rawInputs.prospectsAddedToCadence,
      conversations: d.rawInputs.coldCallsWithConversations,
    }));
    return buildWeeklyProgress(accountRows, contactRows, journalEntries);
  }, [accounts, contacts, days]);

  // Daily plan (tier targets)
  const plan = useMemo(
    () => generateDailyPlan(weeklyProgress, meetingHoursToday),
    [weeklyProgress, meetingHoursToday],
  );

  // Tier status
  const tierStatus = useMemo(
    () => getTierStatus(state.actuals, plan),
    [state.actuals, plan],
  );

  // THE next action — always resolves to something
  const nextAction = useMemo(() => resolveNextAction(state), [state]);

  // Complete current step
  const completeStep = useCallback((stepId: ProspectingStepId, accountName?: string) => {
    setState(prev => {
      const next = completeStepInState(prev, stepId, accountName);
      saveState(next);
      return next;
    });
  }, []);

  // Current cycle info
  const currentCycle = state.cycles[state.cycles.length - 1] || null;
  const cyclesCompleted = state.cycles.filter(
    c => PROSPECTING_STEPS.every(s => c.completedSteps.includes(s.id))
  ).length;

  return {
    state,
    plan,
    tierStatus,
    nextAction,
    completeStep,
    currentCycle,
    cyclesCompleted,
    steps: PROSPECTING_STEPS,
  };
}
