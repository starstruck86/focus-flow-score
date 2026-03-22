import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import type { TaskStatus, Priority } from '@/types';

interface TaskBulkBarProps {
  selectedIds: Set<string>;
  onClear: () => void;
}

export function TaskBulkBar({ selectedIds, onClear }: TaskBulkBarProps) {
  const { updateTask, deleteTask } = useStore();
  const count = selectedIds.size;
  if (count === 0) return null;

  const bulkUpdate = (updates: Record<string, any>) => {
    selectedIds.forEach(id => updateTask(id, updates));
    toast.success(`Updated ${count} tasks`);
    onClear();
  };

  const bulkDelete = () => {
    selectedIds.forEach(id => deleteTask(id));
    toast.success(`Deleted ${count} tasks`);
    onClear();
  };

  return (
    <div className="sticky bottom-4 z-20 mx-auto max-w-lg">
      <div className="flex items-center gap-2 bg-card border border-border shadow-lg rounded-full px-4 py-2">
        <span className="text-xs font-semibold text-primary">{count} selected</span>
        <div className="flex items-center gap-1 ml-auto">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={false} onClick={() => bulkUpdate({ status: 'done' as TaskStatus, completedAt: new Date().toISOString() })} data-testid="bulk-done-btn">
            ✓ Done
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => bulkUpdate({ priority: 'P0' as Priority })}>
            P0
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => bulkUpdate({ priority: 'P1' as Priority })}>
            P1
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => bulkUpdate({ workstream: 'pg' })}>
            PG
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => bulkUpdate({ workstream: 'renewals' })}>
            RN
          </Button>
          <Button size="sm" variant="destructive" className="h-7 text-[11px]" onClick={bulkDelete}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={onClear}>
            ✕
          </Button>
        </div>
      </div>
    </div>
  );
}
