// Dashboard-specific type definitions
import type { LucideIcon } from 'lucide-react';

// ===== Daily Digest / Company Monitor =====
export interface DigestItem {
  id: string;
  user_id: string;
  account_id: string | null;
  account_name: string;
  category: string;
  digest_date: string;
  headline: string;
  summary: string | null;
  source_url: string | null;
  suggested_action: string | null;
  is_read: boolean | null;
  is_actionable: boolean | null;
  relevance_score: number | null;
  raw_data: unknown;
  created_at: string;
  updated_at: string;
}

export interface OutreachModalState {
  open: boolean;
  item: DigestItem | null;
  draft: string;
  loading: boolean;
}

// ===== Pipeline Hygiene =====
export interface PipelineHygieneIssue {
  record_type: 'opportunity' | 'renewal' | 'account';
  record_id: string;
  record_name: string;
  severity: 'critical' | 'warning' | 'info';
  issue_type: string;
  description: string;
}

export interface PipelineHygieneSummary {
  totalDeals?: number;
  avgDaysInStage?: number;
  staleCount?: number;
  noNextStep?: number;
  [key: string]: string | number | undefined;
}

// ===== Weekly Battle Plan =====
export interface BattlePlanMove {
  action: string;
  account_name?: string;
  deal_name?: string;
  arr?: number;
  reason: string;
  type?: string;
  urgency?: string;
}

// ===== ICP Sourced Account =====
export interface IcpSuggestedContact {
  name: string;
  title?: string;
  linkedin_url?: string;
}

export interface IcpSourcedAccount {
  id: string;
  user_id: string;
  company_name: string;
  website: string | null;
  industry: string | null;
  employee_count: string | null;
  icp_fit_reason: string;
  fit_score: number | null;
  trigger_signal: string | null;
  news_snippet: string | null;
  suggested_contacts: IcpSuggestedContact[] | null;
  linkedin_url: string | null;
  hq_location: string | null;
  signal_date: string | null;
  status: string | null;
  feedback: string | null;
  batch_id: string | null;
  promoted_account_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// ===== Enrichment Timeline =====
export interface TriggerEvent {
  type: string;
  date: string;
  source?: string;
  confidence?: string;
  notes?: string;
  headline?: string;
}

export interface TimelineEntry {
  date: string;
  type: string;
  title: string;
  detail: string;
  icon: LucideIcon;
  color: string;
}

// ===== Daily Time Blocks =====
export interface CalendarScreenshotEvent {
  title: string;
  start_time: string;
  end_time: string;
  category: 'work_meeting' | 'personal' | 'all_day';
  is_personal_block: boolean;
  family_member?: string;
  notes?: string;
  confirmed: boolean;
}

// ===== Sales Age =====
export interface SalesAgeSnapshot {
  date: string;
  sales_age: number;
  qpi: number;
  deal_count: number;
  [key: string]: string | number;
}

// ===== Research Checklist =====
export interface ResearchChecklistItem {
  id: string;
  label: string;
  check: (account: ResearchChecklistAccount, contacts: ResearchChecklistContact[], opps: ResearchChecklistOpp[]) => boolean;
  tip: string;
}

export interface ResearchChecklistAccount {
  website?: string;
  techStack?: string[];
  notes?: string;
  nextStep?: string;
  accountContacts?: { id: string }[];
  enrichmentSourceSummary?: string;
  salesforceLink?: string;
  planhatLink?: string;
}

export interface ResearchChecklistContact {
  accountId: string;
}

export interface ResearchChecklistOpp {
  accountId?: string;
}

// ===== Scenario Simulator =====
export interface ScenarioDeal {
  id: string;
  name: string;
  arr: number;
  probability: number;
  closeDate: string;
  isNewLogo: boolean;
}

// ===== Extracted Task from transcript =====
export interface ExtractedTask {
  title: string;
  priority?: string;
  due_date?: string;
  notes?: string;
  category?: string;
}
