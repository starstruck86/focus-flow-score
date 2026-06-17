import { useState } from 'react';

export type AppMode = 'train' | 'work';
const STORAGE_KEY = 'qc_app_mode';

export function useAppMode() {
  const [mode, setMode] = useState<AppMode>(() => {
    try {
      return (localStorage.getItem(STORAGE_KEY) as AppMode) || 'train';
    } catch {
      return 'train';
    }
  });

  const toggleMode = () => {
    setMode(prev => {
      const next: AppMode = prev === 'train' ? 'work' : 'train';
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
      return next;
    });
  };

  return { mode, toggleMode, isTrain: mode === 'train', isWork: mode === 'work' };
}
