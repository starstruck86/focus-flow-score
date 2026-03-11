// Dashboard widget order and visibility persistence
import { useState, useCallback } from 'react';

export interface DashboardWidget {
  id: string;
  label: string;
  visible: boolean;
}

const STORAGE_KEY = 'quota-compass-dashboard-widgets';

const DEFAULT_WIDGETS: DashboardWidget[] = [
  { id: 'commission-pacing', label: 'Commission Pacing', visible: true },
  { id: 'progress-tabs', label: 'Today / Week-to-Date', visible: true },
  { id: 'today-agenda', label: "Today's Agenda", visible: true },
  { id: 'meeting-prep', label: 'Meeting Prep', visible: true },
  { id: 'pipeline', label: 'Unified Pipeline', visible: true },
  { id: 'pace-to-quota', label: 'Pace to Quota', visible: true },
  { id: 'what-to-do-next', label: 'What To Do Next', visible: true },
  { id: 'risk-window', label: 'Next 45 Days Risk', visible: true },
  { id: 'snapshots', label: 'Performance & Commission', visible: true },
];

function loadWidgets(): DashboardWidget[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as DashboardWidget[];
      // Merge with defaults to handle new widgets
      const savedMap = new Map(parsed.map(w => [w.id, w]));
      return DEFAULT_WIDGETS.map(def => savedMap.get(def.id) || def);
    }
  } catch {}
  return DEFAULT_WIDGETS;
}

export function useDashboardWidgets() {
  const [widgets, setWidgets] = useState<DashboardWidget[]>(loadWidgets);

  const toggleWidget = useCallback((id: string) => {
    setWidgets(prev => {
      const next = prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const moveWidget = useCallback((fromIndex: number, toIndex: number) => {
    setWidgets(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetWidgets = useCallback(() => {
    setWidgets(DEFAULT_WIDGETS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_WIDGETS));
  }, []);

  return { widgets, toggleWidget, moveWidget, resetWidgets };
}
