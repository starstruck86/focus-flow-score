import { Calendar, Phone, Mail, Target, UserPlus } from 'lucide-react';
import type { TaskStatus, Priority, Workstream } from '@/types';

// ── Driver Tags ────────────────────────────────────────────
export type DriverTag = 'cadence' | 'calls' | 'manager-outreach' | 'meeting-set' | 'opp-creation';

export const DRIVER_TAG_META: Record<DriverTag, { label: string; icon: typeof UserPlus; color: string }> = {
  'cadence':          { label: 'Cadence', icon: UserPlus, color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  'calls':            { label: 'Calls', icon: Phone, color: 'bg-green-500/10 text-green-600 border-green-500/20' },
  'manager-outreach': { label: 'Mgr+', icon: Mail, color: 'bg-purple-500/10 text-purple-600 border-purple-500/20' },
  'meeting-set':      { label: 'Meeting', icon: Calendar, color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  'opp-creation':     { label: 'Opp', icon: Target, color: 'bg-rose-500/10 text-rose-600 border-rose-500/20' },
};

// ── Status ─────────────────────────────────────────────────
export const STATUS_ORDER: TaskStatus[] = ['next', 'in-progress', 'blocked', 'done', 'dropped'];

export const STATUS_META: Record<TaskStatus, { label: string; color: string; dot: string; shortLabel: string }> = {
  'next':        { label: 'Next',        shortLabel: 'Next',  color: 'bg-primary/10 text-primary border-primary/20',        dot: 'bg-primary' },
  'in-progress': { label: 'In Progress', shortLabel: 'Active', color: 'bg-status-blue/10 text-status-blue border-status-blue/20', dot: 'bg-status-blue' },
  'blocked':     { label: 'Blocked',     shortLabel: 'Block', color: 'bg-status-red/10 text-status-red border-status-red/20',     dot: 'bg-status-red' },
  'done':        { label: 'Done',        shortLabel: 'Done',  color: 'bg-status-green/10 text-status-green border-status-green/20', dot: 'bg-status-green' },
  'dropped':     { label: 'Dropped',     shortLabel: 'Drop',  color: 'bg-muted text-muted-foreground border-border',               dot: 'bg-muted-foreground' },
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  P0: 'bg-status-red text-white',
  P1: 'bg-status-red/70 text-white',
  P2: 'bg-status-yellow text-black',
  P3: 'bg-muted text-muted-foreground',
};

export const WORKSTREAM_LABELS: Record<Workstream, string> = {
  pg: 'PG',
  renewals: 'RN',
};

export const DEFAULT_DRIVER_TARGETS = {
  prospectsAdded: 20,
  conversations: 3,
  managerPlusMessages: 5,
  meetingsSet: 1,
  oppsCreated: 0,
};

// Status cycle for inline click-to-advance
export const STATUS_CYCLE: TaskStatus[] = ['next', 'in-progress', 'done'];
