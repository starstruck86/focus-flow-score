import { AlertCircle } from 'lucide-react';
import type { Task } from '@/types';
import { TaskRow } from './TaskRow';

interface OverdueSectionProps {
  tasks: Task[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}

export function OverdueSection({ tasks, selectedIds, onToggleSelect }: OverdueSectionProps) {
  if (tasks.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-2">
      <div className="flex items-center gap-1.5 mb-1.5 px-1">
        <AlertCircle className="h-3.5 w-3.5 text-destructive" />
        <span className="text-xs font-semibold text-destructive">
          Overdue ({tasks.length})
        </span>
      </div>
      <div className="space-y-0.5">
        {tasks.map(t => (
          <TaskRow key={t.id} task={t} selected={selectedIds.has(t.id)} onToggleSelect={onToggleSelect} />
        ))}
      </div>
    </div>
  );
}
