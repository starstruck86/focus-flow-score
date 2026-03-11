import { useState, useCallback } from 'react';

export function useBulkSelection<T extends { id: string }>() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback((items: T[]) => {
    setSelectedIds(prev => {
      if (prev.size === items.length) return new Set();
      return new Set(items.map(i => i.id));
    });
  }, []);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);
  const isAllSelected = useCallback((items: T[]) => items.length > 0 && selectedIds.size === items.length, [selectedIds]);

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    toggle,
    toggleAll,
    clear,
    isSelected,
    isAllSelected,
  };
}
