/**
 * Acceptance Harness
 *
 * Tracks real-world voice workflow completion, latency, and abandonment.
 * Feature-flagged via ENABLE_VOICE_OS.
 */

const HARNESS_KEY = 'dave-acceptance-harness';
const MAX_ENTRIES = 200;

export type WorkflowType =
  | 'daily_walkthrough'
  | 'call_prep'
  | 'roleplay'
  | 'draft_followup'
  | 'explain_recommendation'
  | 'log_outcome'
  | 'chained_command'
  | 'interruption_resume'
  | 'context_followup'
  | 'generic';

export interface WorkflowRecord {
  workflowType: WorkflowType;
  success: boolean;
  latencyMs: number;
  userAccepted: boolean;
  userAbandoned: boolean;
  failureReason?: string;
  stepCount?: number;
  timestamp: number;
}

export interface AcceptanceMetrics {
  successRate: number;
  avgLatencyMs: number;
  abandonmentRate: number;
  failureTypes: Record<string, number>;
  totalWorkflows: number;
  byType: Record<string, { count: number; successRate: number }>;
}

// ── Route → workflow type mapping ──────────────────────────

const ROUTE_TO_WORKFLOW: [WorkflowType, RegExp][] = [
  ['daily_walkthrough', /\b(walk\s+me\s+through\s+my\s+day|daily|game\s+plan)\b/i],
  ['call_prep', /\b(prep\s+(me|for)|meeting\s+prep|before\s+my\s+call)\b/i],
  ['roleplay', /\b(roleplay|practice|simulate|mock\s+call)\b/i],
  ['draft_followup', /\b(draft|write|compose)\s+(follow|email|message)\b/i],
  ['explain_recommendation', /\b(explain|why\s+(did|is|should)|reasoning)\b/i],
  ['log_outcome', /\b(log\s+(that|outcome|call)|debrief)\b/i],
];

export function classifyWorkflow(input: string): WorkflowType {
  for (const [type, pattern] of ROUTE_TO_WORKFLOW) {
    if (pattern.test(input)) return type;
  }
  return 'generic';
}

// ── Recording ──────────────────────────────────────────────

export function recordWorkflow(record: WorkflowRecord): void {
  try {
    const existing: WorkflowRecord[] = JSON.parse(localStorage.getItem(HARNESS_KEY) || '[]');
    existing.push(record);
    if (existing.length > MAX_ENTRIES) existing.splice(0, existing.length - MAX_ENTRIES);
    localStorage.setItem(HARNESS_KEY, JSON.stringify(existing));
  } catch {}
}

export function beginWorkflowTimer(): () => number {
  const start = performance.now();
  return () => Math.round(performance.now() - start);
}

// ── Metrics ────────────────────────────────────────────────

export function getAcceptanceMetrics(windowMs: number = 7 * 24 * 3600 * 1000): AcceptanceMetrics {
  const cutoff = Date.now() - windowMs;
  let records: WorkflowRecord[];
  try {
    records = (JSON.parse(localStorage.getItem(HARNESS_KEY) || '[]') as WorkflowRecord[])
      .filter(r => r.timestamp > cutoff);
  } catch { records = []; }

  if (records.length === 0) {
    return { successRate: 0, avgLatencyMs: 0, abandonmentRate: 0, failureTypes: {}, totalWorkflows: 0, byType: {} };
  }

  const successes = records.filter(r => r.success).length;
  const abandoned = records.filter(r => r.userAbandoned).length;
  const avgLatency = records.reduce((s, r) => s + r.latencyMs, 0) / records.length;

  const failureTypes: Record<string, number> = {};
  for (const r of records) {
    if (!r.success && r.failureReason) {
      failureTypes[r.failureReason] = (failureTypes[r.failureReason] ?? 0) + 1;
    }
  }

  const byType: Record<string, { count: number; successRate: number }> = {};
  for (const r of records) {
    if (!byType[r.workflowType]) byType[r.workflowType] = { count: 0, successRate: 0 };
    byType[r.workflowType].count++;
  }
  for (const type of Object.keys(byType)) {
    const typeRecords = records.filter(r => r.workflowType === type);
    byType[type].successRate = typeRecords.filter(r => r.success).length / typeRecords.length;
  }

  return {
    successRate: successes / records.length,
    avgLatencyMs: Math.round(avgLatency),
    abandonmentRate: abandoned / records.length,
    failureTypes,
    totalWorkflows: records.length,
    byType,
  };
}
