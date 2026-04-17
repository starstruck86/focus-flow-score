export interface TaskInputs {
  company_name: string;
  rep_name?: string;
  participants: { name: string; title?: string; role?: string; side?: 'internal' | 'prospect' }[];
  opportunity?: string;
  stage?: string;
  prior_notes?: string;
  scale?: string;
  desired_next_step?: string;
  website?: string;
  thread_id?: string;
  account_id?: string;
  opportunity_id?: string;
}

export interface Redline {
  id: string;
  section_id: string;
  section_name: string;
  current_text: string;
  proposed_text: string;
  rationale: string;
  grounded_by_id?: string | null;
  status?: 'pending' | 'accepted' | 'rejected';
}

export interface DiscoverySection {
  id: string;
  name: string;
  grounded_by?: string[];
  content: any;
}

export interface SourceEntry {
  id: string;
  label: string;
  url?: string | null;
  accessed?: string | null;
}

export interface LibraryCoverageEntry {
  id: string;
  title: string;
  type: 'KI' | 'Playbook';
  sections?: string[];
}

export interface RubricCheck {
  citation_density?: 'pass' | 'warn' | 'fail';
  cockpit_completeness?: 'pass' | 'warn' | 'fail';
  discovery_question_specificity?: 'pass' | 'warn' | 'fail';
  library_grounding?: 'pass' | 'warn' | 'fail';
  appendix_richness?: 'pass' | 'warn' | 'fail';
  notes?: string[];
}

export interface TaskRunResult {
  run_id: string;
  draft: { sections: DiscoverySection[]; sources?: SourceEntry[] };
  review: {
    strengths: string[];
    redlines: Redline[];
    library_coverage?: { used: LibraryCoverageEntry[]; gaps: string[]; score?: number };
    rubric_check?: RubricCheck;
  };
}