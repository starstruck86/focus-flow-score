// Recurrence generation logic
import type { RecurringTaskTemplate } from '@/types/recurring';

/**
 * Check if today is a due date for the given recurring template.
 * Returns the due date string (YYYY-MM-DD) if due, null otherwise.
 */
export function isDueToday(template: RecurringTaskTemplate, todayStr: string): string | null {
  if (template.paused) return null;

  // Check end conditions
  if (template.end.type === 'on-date' && template.end.endDate && todayStr > template.end.endDate) return null;
  if (template.end.type === 'after-count' && template.end.maxOccurrences != null && (template.end.completedOccurrences ?? 0) >= template.end.maxOccurrences) return null;

  // Already generated for today or later
  if (template.lastGeneratedDate && template.lastGeneratedDate >= todayStr) return null;

  const today = parseDate(todayStr);
  const dow = today.getDay(); // 0=Sun

  const { rule } = template;

  switch (rule.frequency) {
    case 'daily': {
      if (!rule.includeWeekends && (dow === 0 || dow === 6)) return null;
      return todayStr;
    }
    case 'weekly': {
      const days = rule.daysOfWeek ?? [1]; // default Monday
      if (days.includes(dow)) return todayStr;
      return null;
    }
    case 'monthly': {
      if (rule.monthlyMode === 'first-business-day') {
        const fbd = getFirstBusinessDay(today.getFullYear(), today.getMonth());
        if (fbd === today.getDate()) return todayStr;
        return null;
      }
      if (rule.monthlyMode === 'last-business-day') {
        const lbd = getLastBusinessDay(today.getFullYear(), today.getMonth());
        if (lbd === today.getDate()) return todayStr;
        return null;
      }
      // day-of-month
      const targetDay = rule.dayOfMonth ?? 1;
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      const effectiveDay = Math.min(targetDay, lastDay);
      if (today.getDate() === effectiveDay) return todayStr;
      return null;
    }
    default:
      return null;
  }
}

function parseDate(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getFirstBusinessDay(year: number, month: number): number {
  const d = new Date(year, month, 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d.getDate();
}

function getLastBusinessDay(year: number, month: number): number {
  const d = new Date(year, month + 1, 0); // last day of month
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return d.getDate();
}
