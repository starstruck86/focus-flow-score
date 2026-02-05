import { useState } from 'react';
import { 
  Plus, 
  CheckCircle2,
  Circle,
  Calendar,
  Building2,
  MoreHorizontal,
  GripVertical,
  Filter
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Task, Priority, Motion, TaskCategory, TaskStatus } from '@/types';

const PRIORITY_COLORS: Record<Priority, string> = {
  P0: 'bg-status-red text-white',
  P1: 'bg-status-red/70 text-white',
  P2: 'bg-status-yellow text-black',
  P3: 'bg-status-green/70 text-white',
};

const MOTION_LABELS: Record<Motion, string> = {
  'new-logo': 'New Logo',
  'expansion': 'Expansion',
  'renewal': 'Renewal',
};

const CATEGORY_OPTIONS: { value: TaskCategory; label: string }[] = [
  { value: 'call', label: 'Call' },
  { value: 'manual-email', label: 'Manual Email' },
  { value: 'automated-email', label: 'Automated Email' },
  { value: 'research', label: 'Research' },
  { value: 'deck', label: 'Deck' },
  { value: 'meeting-prep', label: 'Meeting Prep' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'admin', label: 'Admin' },
];

const VIEWS = [
  { value: 'today', label: 'Today' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'this-week', label: 'This Week' },
  { value: 'by-priority', label: 'By Priority' },
  { value: 'by-motion', label: 'By Motion' },
  { value: 'all', label: 'All Tasks' },
];

export default function Tasks() {
  const { tasks, accounts, addTask, updateTask, deleteTask, toggleTaskComplete } = useStore();
  const [currentView, setCurrentView] = useState('today');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newTask, setNewTask] = useState<Partial<Task>>({
    priority: 'P2',
    status: 'open',
    motion: 'new-logo',
    category: 'call',
    subtasks: [],
  });

  const today = new Date().toISOString().split('T')[0];

  const filteredTasks = tasks.filter(task => {
    switch (currentView) {
      case 'today':
        return task.dueDate === today && task.status !== 'done';
      case 'overdue':
        return task.dueDate < today && task.status !== 'done';
      case 'this-week': {
        const weekFromNow = new Date();
        weekFromNow.setDate(weekFromNow.getDate() + 7);
        return task.dueDate <= weekFromNow.toISOString().split('T')[0] && task.status !== 'done';
      }
      case 'by-priority':
      case 'by-motion':
      case 'all':
      default:
        return true;
    }
  }).sort((a, b) => {
    // Sort by status first (open before done)
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (a.status !== 'done' && b.status === 'done') return -1;
    
    // Then by priority
    const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    
    // Then by due date
    return a.dueDate.localeCompare(b.dueDate);
  });

  // Group tasks for certain views
  const groupedTasks = currentView === 'by-priority' 
    ? (['P0', 'P1', 'P2', 'P3'] as Priority[]).reduce((acc, p) => {
        acc[p] = filteredTasks.filter(t => t.priority === p);
        return acc;
      }, {} as Record<Priority, typeof filteredTasks>)
    : currentView === 'by-motion'
    ? (['new-logo', 'expansion', 'renewal'] as Motion[]).reduce((acc, m) => {
        acc[m] = filteredTasks.filter(t => t.motion === m);
        return acc;
      }, {} as Record<Motion, typeof filteredTasks>)
    : null;

  const handleAddTask = () => {
    if (!newTask.title || !newTask.linkedAccountId || !newTask.dueDate) {
      toast.error('Title, account, and due date are required');
      return;
    }
    addTask(newTask as Omit<Task, 'id' | 'createdAt' | 'updatedAt'>);
    setShowAddDialog(false);
    setNewTask({
      priority: 'P2',
      status: 'open',
      motion: 'new-logo',
      category: 'call',
      subtasks: [],
    });
    toast.success('Task added!');
  };

  const TaskItem = ({ task }: { task: Task }) => {
    const account = accounts.find(a => a.id === task.linkedAccountId);
    const isOverdue = task.dueDate < today && task.status !== 'done';
    
    return (
      <div className={cn(
        "flex items-start gap-3 p-3 rounded-lg border transition-all",
        task.status === 'done' 
          ? "bg-muted/30 border-border/30" 
          : "bg-card border-border/50 hover:border-border"
      )}>
        <div className="flex-shrink-0 pt-0.5">
          <Checkbox
            checked={task.status === 'done'}
            onCheckedChange={() => toggleTaskComplete(task.id)}
            className="h-5 w-5"
          />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(
              "font-medium",
              task.status === 'done' && "line-through text-muted-foreground"
            )}>
              {task.title}
            </span>
            <Badge className={cn('text-xs h-5', PRIORITY_COLORS[task.priority])}>
              {task.priority}
            </Badge>
            <Badge variant="outline" className="text-xs h-5">
              {MOTION_LABELS[task.motion]}
            </Badge>
          </div>
          
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            {account && (
              <span className="flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {account.name}
              </span>
            )}
            <span className={cn(
              "flex items-center gap-1",
              isOverdue && "text-status-red"
            )}>
              <Calendar className="h-3 w-3" />
              {task.dueDate}
              {isOverdue && " (Overdue)"}
            </span>
            <span className="capitalize">{task.category.replace('-', ' ')}</span>
          </div>
          
          {task.notes && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
              {task.notes}
            </p>
          )}
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Edit Task</DropdownMenuItem>
            <DropdownMenuItem onClick={() => updateTask(task.id, { status: 'in-progress' as TaskStatus })}>
              Mark In Progress
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => updateTask(task.id, { status: 'blocked' as TaskStatus })}>
              Mark Blocked
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              className="text-destructive"
              onClick={() => deleteTask(task.id)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold">Tasks</h1>
            <p className="text-sm text-muted-foreground">
              {tasks.filter(t => t.status !== 'done').length} open • {tasks.filter(t => t.status === 'done').length} completed
            </p>
          </div>
          
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Task
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add Task</DialogTitle>
                <DialogDescription>
                  Create a new task for your pipeline work.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Title *</Label>
                  <Input
                    value={newTask.title || ''}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    placeholder="Follow up with John..."
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Select
                      value={newTask.priority}
                      onValueChange={(v) => setNewTask({ ...newTask, priority: v as Priority })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="P0">P0 - Urgent</SelectItem>
                        <SelectItem value="P1">P1 - High</SelectItem>
                        <SelectItem value="P2">P2 - Medium</SelectItem>
                        <SelectItem value="P3">P3 - Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Due Date *</Label>
                    <Input
                      type="date"
                      value={newTask.dueDate || ''}
                      onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Motion</Label>
                    <Select
                      value={newTask.motion}
                      onValueChange={(v) => setNewTask({ ...newTask, motion: v as Motion })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new-logo">New Logo</SelectItem>
                        <SelectItem value="expansion">Expansion</SelectItem>
                        <SelectItem value="renewal">Renewal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={newTask.category}
                      onValueChange={(v) => setNewTask({ ...newTask, category: v as TaskCategory })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORY_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Linked Account *</Label>
                  <Select
                    value={newTask.linkedAccountId}
                    onValueChange={(v) => setNewTask({ ...newTask, linkedAccountId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select account..." />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.length === 0 ? (
                        <SelectItem value="none" disabled>No accounts - add one first</SelectItem>
                      ) : (
                        accounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={newTask.notes || ''}
                    onChange={(e) => setNewTask({ ...newTask, notes: e.target.value })}
                    placeholder="Additional context..."
                    rows={2}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                <Button onClick={handleAddTask}>Add Task</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* View Selector */}
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
          {VIEWS.map((view) => (
            <Button
              key={view.value}
              size="sm"
              variant={currentView === view.value ? 'default' : 'secondary'}
              onClick={() => setCurrentView(view.value)}
              className="whitespace-nowrap"
            >
              {view.label}
              {view.value === 'overdue' && tasks.filter(t => t.dueDate < today && t.status !== 'done').length > 0 && (
                <Badge className="ml-2 bg-status-red text-white text-xs h-4 px-1">
                  {tasks.filter(t => t.dueDate < today && t.status !== 'done').length}
                </Badge>
              )}
            </Button>
          ))}
        </div>

        {/* Tasks List */}
        {groupedTasks ? (
          // Grouped view
          Object.entries(groupedTasks).map(([group, groupTasks]) => {
            if (groupTasks.length === 0) return null;
            return (
              <div key={group} className="mb-6">
                <h3 className="font-display text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {currentView === 'by-priority' ? group : MOTION_LABELS[group as Motion]}
                  <span className="ml-2 text-xs font-normal">({groupTasks.length})</span>
                </h3>
                <div className="space-y-2">
                  {groupTasks.map((task) => (
                    <TaskItem key={task.id} task={task} />
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          // Flat list
          <div className="space-y-2">
            {filteredTasks.length === 0 ? (
              <div className="metric-card text-center py-12">
                <CheckCircle2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  {tasks.length === 0 
                    ? "No tasks yet. Add your first task!"
                    : currentView === 'today'
                    ? "No tasks due today. You're all caught up!"
                    : "No tasks match this view."}
                </p>
              </div>
            ) : (
              filteredTasks.map((task) => (
                <TaskItem key={task.id} task={task} />
              ))
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
