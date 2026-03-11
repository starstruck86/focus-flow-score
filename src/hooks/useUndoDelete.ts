import { useRef, useCallback } from 'react';
import { toast } from 'sonner';

interface UndoDeleteOptions<T> {
  onDelete: (id: string) => void;
  onRestore: (item: T) => void;
  itemLabel?: string;
  undoWindowMs?: number;
}

export function useUndoDelete<T extends { id: string }>({
  onDelete,
  onRestore,
  itemLabel = 'Item',
  undoWindowMs = 5000,
}: UndoDeleteOptions<T>) {
  const pendingRef = useRef<Map<string, { item: T; timeout: NodeJS.Timeout }>>(new Map());

  const deleteWithUndo = useCallback((item: T) => {
    // Optimistically remove
    onDelete(item.id);

    // Clear any existing pending delete for this item
    const existing = pendingRef.current.get(item.id);
    if (existing) {
      clearTimeout(existing.timeout);
    }

    const timeout = setTimeout(() => {
      pendingRef.current.delete(item.id);
    }, undoWindowMs);

    pendingRef.current.set(item.id, { item, timeout });

    toast(`${itemLabel} deleted`, {
      action: {
        label: 'Undo',
        onClick: () => {
          const pending = pendingRef.current.get(item.id);
          if (pending) {
            clearTimeout(pending.timeout);
            pendingRef.current.delete(item.id);
            onRestore(pending.item);
            toast.success(`${itemLabel} restored`);
          }
        },
      },
      duration: undoWindowMs,
    });
  }, [onDelete, onRestore, itemLabel, undoWindowMs]);

  return { deleteWithUndo };
}
