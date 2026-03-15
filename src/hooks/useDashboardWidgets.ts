// Dashboard widget order and visibility persistence
import { useState, useCallback } from 'react';

export interface DashboardWidget {
  id: string;
  label: string;
  visible: boolean;
}

const STORAGE_KEY = 'quota-compass-dashboard-widgets';

// FIX: Sensible defaults — only high-value widgets visible on first load
// Users can enable more via the customizer
const DEFAULT_WIDGETS: DashboardWidget[] = [
  { id: 'coaching-feed', label: 'AI Coach', visible: true },
  { id: 'pclub-math', label: 'P-Club Math', visible: true },
  { id: 'daily-time-blocks', label: 'Daily Game Plan', visible: true },
  { id: 'commission-pacing', label: 'Commission Pacing', visible: true },
  { id: 'progress-tabs', label: 'Today / Week-to-Date', visible: true },
  { id: 'weekly-battle-plan', label: 'Weekly Battle Plan', visible: true },
  { id: 'pipeline-hygiene', label: 'Pipeline Health', visible: true },
  { id: 'smart-work-queue', label: 'Smart Work Queue', visible: true },
  { id: 'today-agenda', label: "Today's Agenda", visible: true },
  { id: 'scenario-simulator', label: 'Scenario Simulator', visible: false },
  { id: 'meeting-prep', label: 'Meeting Prep', visible: false },
  { id: 'ai-prioritizer', label: 'AI Focus Recommender', visible: false },
  { id: 'calendar-intelligence', label: 'Calendar Intelligence', visible: false },
  { id: 'pipeline', label: 'Unified Pipeline', visible: false },
  { id: 'pace-to-quota', label: 'Pace to Quota', visible: false },
  { id: 'what-to-do-next', label: 'What To Do Next', visible: false },
  { id: 'risk-window', label: 'Next 45 Days Risk', visible: false },
  { id: 'snapshots', label: 'Performance & Commission', visible: false },
  { id: 'daily-digest', label: 'Daily Digest', visible: false },
  { id: 'icp-sourcing', label: 'ICP Account Sourcing', visible: true },
  { id: 'company-monitor', label: 'Company Intel Monitor', visible: true },
  { id: 'account-health-pulse', label: 'Account Health Pulse', visible: true },
];

function loadWidgets(): DashboardWidget[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as DashboardWidget[];
      // Merge with defaults to handle new widgets added over time
      const savedMap = new Map(parsed.map(w => [w.id, w]));
      const mergedIds = new Set<string>();
      const result: DashboardWidget[] = [];
      
      // First add saved widgets in their saved order
      for (const w of parsed) {
        if (DEFAULT_WIDGETS.some(d => d.id === w.id)) {
          result.push(w);
          mergedIds.add(w.id);
        }
      }
      // Then add any new widgets that weren't in saved state
      for (const def of DEFAULT_WIDGETS) {
        if (!mergedIds.has(def.id)) {
          result.push(def);
        }
      }
      return result;
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
