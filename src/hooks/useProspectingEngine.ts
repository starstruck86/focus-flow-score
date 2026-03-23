/**
 * Hook: useProspectingEngine
 * Connects the prospecting plan generator to live store + calendar data.
 */
import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import {
  generateDailyPlan,
  buildWeeklyProgress,
  getTierStatus,
  PROSPECTING_STEPS,
  type DailyActuals,
  type DailyProspectingPlan,
  type ProspectingStepId,
} from '@/lib/prospectingEngine';

const STORAGE_KEY = 'prospecting-actuals';

function loadActuals(date: string): DailyActuals {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}-${date}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { accountsWorked: 0, contactsAdded: 0, cadencesLaunched: 0, callsMade: 0, stepsCompleted: [] };
}

function saveActuals(date: string, actuals: DailyActuals) {
  localStorage.setItem(`${STORAGE_KEY}-${date}`, JSON.stringify(actuals));
}

export function useProspectingEngine() {
  const { accounts, contacts, days } = useStore();
  const { data: calendarEvents } = useCalendarEvents();
  const today = new Date().toISOString().split('T')[0];

  const actuals = useMemo(() => loadActuals(today), [today]);

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

  const contactRows = useMemo(() =>
    contacts.map(c => ({ created_at: c.createdAt })),
    [contacts]
  );

  const journalEntries = useMemo(() =>
    days.map(d => ({
      date: d.date,
      prospects_added: d.rawInputs.prospectsAddedToCadence,
      conversations: d.rawInputs.coldCallsWithConversations,
    })),
    [days]
  );

  const accountRows = useMemo(() =>
    accounts.map(a => ({ createdAt: a.createdAt })),
    [accounts]
  );

  const weeklyProgress = useMemo(
    () => buildWeeklyProgress(accountRows, contactRows, journalEntries),
    [accountRows, contactRows, journalEntries]
  );

  const plan = useMemo(
    () => generateDailyPlan(weeklyProgress, meetingHoursToday, actuals),
    [weeklyProgress, meetingHoursToday, actuals]
  );

  const tierStatus = useMemo(
    () => getTierStatus(actuals, plan),
    [actuals, plan]
  );

  const completeStep = (stepId: ProspectingStepId) => {
    const updated = { ...actuals };
    if (!updated.stepsCompleted.includes(stepId)) {
      updated.stepsCompleted = [...updated.stepsCompleted, stepId];
    }
    // Auto-increment relevant counters
    if (stepId === 'select_account') updated.accountsWorked++;
    if (stepId === 'find_contacts') updated.contactsAdded += 2;
    if (stepId === 'launch_cadence') updated.cadencesLaunched++;
    saveActuals(today, updated);
  };

  const incrementMetric = (metric: keyof Omit<DailyActuals, 'stepsCompleted'>, amount = 1) => {
    const updated = { ...actuals, [metric]: (actuals[metric] as number) + amount };
    saveActuals(today, updated);
  };

  return {
    plan,
    actuals,
    tierStatus,
    completeStep,
    incrementMetric,
    steps: PROSPECTING_STEPS,
  };
}
