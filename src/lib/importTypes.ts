// Comprehensive import types for combined file support

// Target objects for mapping
export type ImportTargetObject = 'account' | 'opportunity' | 'renewal' | 'contact' | 'ignore';

// Data transforms
export type DataTransform = 'text' | 'url' | 'date' | 'number' | 'picklist' | 'extract_domain' | 'extract_sfdc_id';

// Motion types
export type MotionType = 'new-logo' | 'renewal' | 'general' | 'both';

// Row classification
export type RowType = 'account-only' | 'opportunity' | 'renewal' | 'mixed';

// Field definitions for each object type
export const ACCOUNT_FIELDS = [
  { value: 'name', label: 'Account Name', required: true },
  { value: 'website', label: 'Website' },
  { value: 'salesforce_link', label: 'Salesforce Account Link' },
  { value: 'planhat_link', label: 'Planhat Link' },
  { value: 'current_agreement_link', label: 'Current Agreement Link' },
  { value: 'priority', label: 'Priority' },
  { value: 'tier', label: 'Tier' },
  { value: 'motion', label: 'Motion' },
  { value: 'industry', label: 'Industry' },
  { value: 'next_step', label: 'Next Step' },
  { value: 'notes', label: 'Account Notes' },
  { value: 'csm', label: 'CSM' },
] as const;

export const OPPORTUNITY_FIELDS = [
  { value: 'name', label: 'Opportunity Name' },
  { value: 'salesforce_link', label: 'Salesforce Opp Link' },
  { value: 'stage', label: 'Stage' },
  { value: 'status', label: 'Status' },
  { value: 'arr', label: 'ARR' },
  { value: 'close_date', label: 'Close Date' },
  { value: 'next_step', label: 'Next Step' },
  { value: 'deal_type', label: 'Deal Type' },
  { value: 'churn_risk', label: 'Churn Risk' },
  { value: 'notes', label: 'Opportunity Notes' },
] as const;

export const RENEWAL_FIELDS = [
  { value: 'renewal_due', label: 'Renewal Date' },
  { value: 'arr', label: 'Renewal ARR / Baseline' },
  { value: 'planhat_link', label: 'Planhat Link' },
  { value: 'current_agreement_link', label: 'Current Agreement Link' },
  { value: 'csm', label: 'CSM' },
  { value: 'product', label: 'Product' },
  { value: 'entitlements', label: 'Entitlements' },
  { value: 'usage', label: 'Usage' },
  { value: 'term', label: 'Term' },
  { value: 'health_status', label: 'Health Status' },
  { value: 'churn_risk', label: 'Churn Risk' },
  { value: 'auto_renew', label: 'Auto Renew' },
  { value: 'cs_notes', label: 'CS Notes' },
  { value: 'next_step', label: 'Next Step' },
  { value: 'owner', label: 'Owner' },
] as const;

export const CONTACT_FIELDS = [
  { value: 'name', label: 'Contact Name' },
  { value: 'title', label: 'Title' },
  { value: 'email', label: 'Email' },
  { value: 'salesforce_link', label: 'Salesforce Contact Link' },
  { value: 'linkedin_url', label: 'LinkedIn URL' },
  { value: 'notes', label: 'Contact Notes' },
] as const;

// Picklist value definitions
export const PICKLIST_VALUES = {
  stage: [
    '1 - Prospect', '2 - Discover', '3 - Demo', '4 - Proposal', 
    '5 - Negotiate', '6 - Closed Won', '7 - Closed Lost'
  ],
  status: ['active', 'stalled', 'closed-lost', 'closed-won'],
  motion: ['new-logo', 'renewal', 'general', 'both'],
  deal_type: ['new-logo', 'expansion', 'renewal', 'one-time'],
  priority: ['high', 'medium', 'low'],
  tier: ['A', 'B', 'C'],
  health_status: ['green', 'yellow', 'red'],
  churn_risk: ['certain', 'high', 'medium', 'low'],
  auto_renew: ['true', 'false', 'yes', 'no'],
} as const;

// Motion header aliases
export const MOTION_HEADER_ALIASES = ['motion', 'type', 'segment', 'book', 'team'];

// Motion value aliases
export const MOTION_VALUE_ALIASES: Record<string, MotionType> = {
  'new logo': 'new-logo',
  'new-logo': 'new-logo',
  'newlogo': 'new-logo',
  'new': 'new-logo',
  'acquisition': 'new-logo',
  'renewal': 'renewal',
  'renew': 'renewal',
  'existing': 'renewal',
  'general': 'general',
  'both': 'both',
};

// Renewal-specific field indicators (if present, row is likely renewal)
export const RENEWAL_INDICATOR_FIELDS = [
  'renewal_date', 'renewal_due', 'renewal_arr', 'baseline_arr',
  'planhat', 'planhat_link', 'planhat_url',
  'current_agreement', 'agreement_link', 'contract_link',
  'csm', 'customer_success', 'health_status', 'auto_renew'
];

// Enhanced header mappings with object context
export interface EnhancedHeaderMapping {
  csvHeader: string;
  colIndex: number;
  targetObject: ImportTargetObject;
  targetField: string | null;
  dataTransform: DataTransform;
  isMapped: boolean;
  isFromSavedMapping: boolean;
  confidence: 'high' | 'medium' | 'low' | 'manual';
}

// Value mapping for picklists
export interface PendingValueMapping {
  fieldName: string;
  csvValue: string;
  suggestedAppValue?: string;
  appValue?: string;
  saveForFuture: boolean;
}

// Unrecognized link
export interface UnrecognizedLink {
  rowIndex: number;
  colIndex: number;
  url: string;
  detectedType: string;
  selectedType?: string;
}

// Row needing review (can't match to account)
export interface NeedsReviewRow {
  rowIndex: number;
  accountName: string;
  accountDomain?: string;
  suggestedMatches: { id: string; name: string; website?: string; score: number }[];
  selectedAccountId?: string;
  createNew: boolean;
  ignored: boolean;
  saveAliasForFuture: boolean;
}

// Parsed row with full data
export interface ParsedImportRow {
  rowIndex: number;
  rowType: RowType;
  motion: MotionType;
  
  // Account data
  accountData: Record<string, any>;
  accountId?: string;
  accountMatched: boolean;
  accountAction: 'create' | 'update' | 'skip';
  
  // Opportunity data (if present)
  opportunityData?: Record<string, any>;
  opportunityId?: string;
  opportunityMatched: boolean;
  opportunityAction?: 'create' | 'update' | 'skip';
  
  // Renewal data (if present)
  renewalData?: Record<string, any>;
  renewalId?: string;
  renewalMatched: boolean;
  renewalAction?: 'create' | 'update' | 'skip';
  
  // Contact data (if present)
  contactData?: Record<string, any>;
  
  // Status
  needsReview: boolean;
  ignored: boolean;
  warnings: string[];
  errors: string[];
}

// Import preview summary
export interface ImportPreviewSummary {
  totalRows: number;
  
  // Accounts
  accountsToCreate: number;
  accountsToUpdate: number;
  
  // Opportunities
  opportunitiesToCreate: number;
  opportunitiesToUpdate: number;
  
  // Renewals
  renewalsToCreate: number;
  renewalsToUpdate: number;
  
  // Issues
  needsReviewCount: number;
  ignoredCount: number;
  warningCount: number;
  
  // By motion
  newLogoRowCount: number;
  renewalRowCount: number;
}

// Full import state
export interface ImportState {
  step: 'upload' | 'auto-map' | 'action-required' | 'preview' | 'importing' | 'complete';
  
  // Raw data
  csvHeaders: string[];
  csvRows: string[][];
  
  // Mappings
  headerMappings: EnhancedHeaderMapping[];
  unmappedColumns: EnhancedHeaderMapping[];
  
  // Value mappings
  pendingValueMappings: PendingValueMapping[];
  
  // Unrecognized links
  unrecognizedLinks: UnrecognizedLink[];
  
  // Needs review
  needsReviewRows: NeedsReviewRow[];
  
  // Parsed rows
  parsedRows: ParsedImportRow[];
  
  // Summary
  summary: ImportPreviewSummary;
  
  // Ignored items acknowledgement
  ignoredAcknowledged: boolean;
  
  // Import progress
  importProgress: number;
  importResults: {
    accountsCreated: number;
    accountsUpdated: number;
    opportunitiesCreated: number;
    opportunitiesUpdated: number;
    renewalsCreated: number;
    renewalsUpdated: number;
    errors: number;
  };
}
