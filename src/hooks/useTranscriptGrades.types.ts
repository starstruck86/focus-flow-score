export interface CotmSignals {
  before_identified: boolean;
  before_evidence?: string;
  negative_consequences: boolean;
  negative_consequences_evidence?: string;
  after_defined: boolean;
  after_evidence?: string;
  pbo_articulated: boolean;
  pbo_evidence?: string;
  required_capabilities: boolean;
  capabilities_evidence?: string;
  metrics_captured: boolean;
  metrics_evidence?: string;
}

export interface MeddiccSignals {
  metrics: boolean;
  metrics_detail?: string;
  economic_buyer: boolean;
  economic_buyer_detail?: string;
  decision_criteria: boolean;
  decision_criteria_detail?: string;
  decision_process: boolean;
  decision_process_detail?: string;
  identify_pain: boolean;
  identify_pain_detail?: string;
  champion: boolean;
  champion_detail?: string;
  competition: boolean;
  competition_detail?: string;
}

export interface DiscoveryStats {
  total_questions: number;
  open_ended_pct: number;
  impact_questions: number;
  follow_up_depth: number;
}

export interface PresenceStats {
  talk_ratio_estimate: number;
  rambling_detected: boolean;
  interruptions_detected: boolean;
  flow_control: number;
}

export interface CallSegment {
  segment: string;
  quality: number;
  notes: string;
}

export interface EvidenceItem {
  category: string;
  score_given: number;
  quote: string;
  assessment: string;
}

export interface MissedOpportunity {
  opportunity: string;
  moment: string;
  example: string;
}

export interface SuggestedQuestion {
  question: string;
  framework: string;
  why: string;
}
