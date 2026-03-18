// Modular widget layout persistence — per-page widget configs
// Phase 3: Decoupled widget system — modules are presentation only
import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface WidgetConfig {
  id: string;
  label: string;
  visible: boolean;
  order: number;
  size?: 'sm' | 'md' | 'lg' | 'full';
}

interface PageLayout {
  pageId: string;
  widgets: WidgetConfig[];
  updatedAt: number;
}

const LOCAL_KEY = 'qc-widget-layouts';

/** Load layouts from localStorage as fallback/cache */
function loadLocal(): Record<string, PageLayout> {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveLocal(layouts: Record<string, PageLayout>) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(layouts));
  } catch { /* quota exceeded — ignore */ }
}

export function useWidgetLayout(pageId: string, defaultWidgets: WidgetConfig[]) {
  const { user } = useAuth();
  const [widgets, setWidgets] = useState<WidgetConfig[]>(() => {
    const layouts = loadLocal();
    const saved = layouts[pageId];
    if (saved?.widgets) {
      // Merge with defaults to pick up new widgets
      return mergeWidgets(saved.widgets, defaultWidgets);
    }
    return defaultWidgets;
  });

  // Persist on change
  const persist = useCallback((next: WidgetConfig[]) => {
    const layouts = loadLocal();
    layouts[pageId] = { pageId, widgets: next, updatedAt: Date.now() };
    saveLocal(layouts);
  }, [pageId]);

  const toggleWidget = useCallback((id: string) => {
    setWidgets(prev => {
      const next = prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w);
      persist(next);
      return next;
    });
  }, [persist]);

  const moveWidget = useCallback((fromIndex: number, toIndex: number) => {
    setWidgets(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      // Re-assign order
      const ordered = next.map((w, i) => ({ ...w, order: i }));
      persist(ordered);
      return ordered;
    });
  }, [persist]);

  const resizeWidget = useCallback((id: string, size: WidgetConfig['size']) => {
    setWidgets(prev => {
      const next = prev.map(w => w.id === id ? { ...w, size } : w);
      persist(next);
      return next;
    });
  }, [persist]);

  const resetWidgets = useCallback(() => {
    setWidgets(defaultWidgets);
    persist(defaultWidgets);
  }, [defaultWidgets, persist]);

  const visibleWidgets = widgets.filter(w => w.visible);

  return {
    widgets,
    visibleWidgets,
    toggleWidget,
    moveWidget,
    resizeWidget,
    resetWidgets,
  };
}

/** Merge saved config with defaults so new widgets appear */
function mergeWidgets(saved: WidgetConfig[], defaults: WidgetConfig[]): WidgetConfig[] {
  const savedMap = new Map(saved.map(w => [w.id, w]));
  const result: WidgetConfig[] = [];
  const seen = new Set<string>();

  // Keep saved order/visibility
  for (const w of saved) {
    if (defaults.some(d => d.id === w.id)) {
      result.push(w);
      seen.add(w.id);
    }
  }
  // Append new defaults
  for (const d of defaults) {
    if (!seen.has(d.id)) {
      result.push(d);
    }
  }
  return result;
}
