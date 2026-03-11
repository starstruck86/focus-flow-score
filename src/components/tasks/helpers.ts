import type { Task, Workstream } from '@/types';
import type { DriverTag } from './constants';

export function getWorkstream(task: Task): Workstream {
  if (task.workstream) return task.workstream;
  if (task.motion === 'renewal') return 'renewals';
  return 'pg';
}

export function sortTasks(tasks: Task[]): Task[] {
  const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return [...tasks].sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 3;
    const pb = priorityOrder[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function inferDriverTag(task: Task): DriverTag | null {
  const t = (task.title + ' ' + (task.notes || '')).toLowerCase();
  if (t.includes('cadence') || t.includes('prospect') || t.includes('sequence')) return 'cadence';
  if (t.includes('call') || t.includes('dial') || t.includes('conversation') || t.includes('connect')) return 'calls';
  if (t.includes('manager') || t.includes('vp') || t.includes('director') || t.includes('exec')) return 'manager-outreach';
  if (t.includes('meeting') || t.includes('demo') || t.includes('schedule')) return 'meeting-set';
  if (t.includes('opp') || t.includes('opportunity') || t.includes('create opp')) return 'opp-creation';
  return null;
}

export function getAccountName(task: Task, accounts: { id: string; name: string }[], opportunities: { id: string; accountId?: string; accountName?: string }[]): string | undefined {
  if (task.linkedAccountId) return accounts.find(a => a.id === task.linkedAccountId)?.name;
  if (task.linkedRecordType === 'opportunity' && task.linkedRecordId) {
    const opp = opportunities.find(o => o.id === task.linkedRecordId);
    if (opp?.accountId) return accounts.find(a => a.id === opp.accountId)?.name || opp?.accountName;
    return opp?.accountName;
  }
  if (task.linkedRecordType === 'account' && task.linkedRecordId) {
    return accounts.find(a => a.id === task.linkedRecordId)?.name;
  }
  return undefined;
}

export function getOpportunityName(task: Task, opportunities: { id: string; name: string }[]): string | undefined {
  const oppId = task.linkedOpportunityId || (task.linkedRecordType === 'opportunity' ? task.linkedRecordId : undefined);
  if (!oppId) return undefined;
  return opportunities.find(o => o.id === oppId)?.name;
}
