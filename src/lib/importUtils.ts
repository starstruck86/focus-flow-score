// Import utilities: header mapping, link detection, normalization

// Header aliases for auto-mapping (case-insensitive, spaces/underscores ignored)
export const HEADER_MAPPINGS = {
  // Account fields
  account_name: ['account name', 'account', 'company', 'company name', 'accountname'],
  website: ['website', 'domain', 'url', 'web', 'site'],
  priority: ['priority', 'prio'],
  motion: ['motion', 'type', 'account type'],
  tier: ['tier', 'level', 'grade'],
  industry: ['industry', 'vertical', 'sector'],
  
  // Account links
  salesforce_account_link: [
    'salesforce account link', 'sfdc account', 'account sfdc', 'account url', 
    'salesforce link', 'sfdc link', 'sf account', 'account salesforce'
  ],
  planhat_link: ['planhat link', 'planhat url', 'planhat', 'ph link'],
  current_agreement_link: [
    'current agreement link', 'agreement link', 'agreement url', 'contract link',
    'salesforce contract link', 'current agreement', 'agreement', 'contract'
  ],
  
  // Opportunity fields
  opportunity_name: ['opportunity name', 'opp name', 'opportunity', 'opp', 'deal name', 'deal'],
  salesforce_opp_link: [
    'salesforce opportunity link', 'opp sfdc', 'opportunity url', 'sfdc opp',
    'opp salesforce', 'opportunity salesforce', 'opp link'
  ],
  arr: ['arr', 'annual recurring revenue', 'revenue', 'value', 'amount', 'deal value'],
  close_date: ['close date', 'closedate', 'expected close', 'close', 'closing date'],
  stage: ['stage', 'opp stage', 'opportunity stage', 'deal stage', 'sales stage'],
  opp_status: ['status', 'opp status', 'opportunity status', 'deal status'],
  deal_type: ['deal type', 'dealtype', 'type', 'opp type', 'opportunity type'],
  
  // Contact fields
  contact_name: ['contact name', 'contact', 'name', 'full name', 'person'],
  title: ['title', 'job title', 'role', 'position'],
  email: ['email', 'email address', 'e-mail', 'contact email'],
  salesforce_contact_link: [
    'salesforce contact link', 'contact sfdc', 'contact url', 
    'sfdc contact', 'contact salesforce'
  ],
  linkedin_url: ['linkedin', 'linkedin url', 'linkedin link', 'li url', 'li link'],
  
  // Renewal fields
  renewal_date: ['renewal date', 'renewaldate', 'renewal due', 'renewaldue', 'due date', 'duedate'],
  csm: ['csm', 'customer success', 'cs manager', 'customer success manager'],
  health_status: ['health', 'health status', 'healthstatus'],
  auto_renew: ['auto renew', 'autorenew', 'auto-renew', 'auto'],
  product: ['product', 'plan', 'subscription'],
  entitlements: ['entitlements', 'entitlement'],
  usage: ['usage', 'consumption'],
  term: ['term', 'contract term', 'length'],
  cs_notes: ['cs notes', 'csnotes', 'customer notes', 'notes'],
  next_step: ['next step', 'nextstep', 'next_step', 'next action'],
  owner: ['owner', 'rep', 'sales rep', 'account owner'],
};

// Normalize header for matching
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[_\s-]+/g, ' ').trim();
}

// Map header to field name
export function mapHeaderToField(header: string): string | null {
  const normalized = normalizeHeader(header);
  
  for (const [field, aliases] of Object.entries(HEADER_MAPPINGS)) {
    if (aliases.some(alias => normalizeHeader(alias) === normalized)) {
      return field;
    }
  }
  
  return null;
}

// Parse CSV with quoted fields
export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
}

// Parse full CSV
export function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 1) {
    return { headers: [], rows: [] };
  }
  
  const headers = parseCSVLine(lines[0]);
  const rows: string[][] = [];
  
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim()) {
      rows.push(parseCSVLine(lines[i]));
    }
  }
  
  return { headers, rows };
}

// Link type classification
export type LinkType = 
  | 'salesforce_account' 
  | 'salesforce_opportunity' 
  | 'salesforce_contact' 
  | 'salesforce_contract'
  | 'planhat' 
  | 'agreement' 
  | 'linkedin'
  | 'unknown';

// Detect link type from URL
export function detectLinkType(url: string): LinkType {
  if (!url) return 'unknown';
  
  const lower = url.toLowerCase();
  
  // Salesforce detection
  if (lower.includes('salesforce.com') || lower.includes('.force.com') || lower.includes('lightning.force.com')) {
    if (lower.includes('/account/') || lower.includes('/001')) {
      return 'salesforce_account';
    }
    if (lower.includes('/opportunity/') || lower.includes('/006')) {
      return 'salesforce_opportunity';
    }
    if (lower.includes('/contact/') || lower.includes('/003')) {
      return 'salesforce_contact';
    }
    if (lower.includes('/contract/') || lower.includes('/800')) {
      return 'salesforce_contract';
    }
    // Default to account for generic SF links
    return 'salesforce_account';
  }
  
  // Planhat
  if (lower.includes('planhat.com') || lower.includes('planhat.io')) {
    return 'planhat';
  }
  
  // LinkedIn
  if (lower.includes('linkedin.com')) {
    return 'linkedin';
  }
  
  // Agreement/Contract documents
  if (
    lower.includes('docusign.') ||
    lower.includes('adobesign.') ||
    lower.includes('echosign.') ||
    lower.includes('docs.google.com') ||
    lower.includes('drive.google.com') ||
    lower.includes('sharepoint.com') ||
    lower.includes('box.com') ||
    lower.includes('dropbox.com') ||
    lower.includes('.pdf')
  ) {
    return 'agreement';
  }
  
  return 'unknown';
}

// Extract Salesforce ID from URL
export function extractSalesforceId(url: string): string | null {
  if (!url) return null;
  
  // Match 15 or 18 character Salesforce IDs
  // Account: 001..., Opportunity: 006..., Contact: 003..., Contract: 800...
  const match = url.match(/\/(001|003|006|800)[a-zA-Z0-9]{12,15}/);
  if (match) {
    return match[0].substring(1); // Remove leading slash
  }
  
  // Try alternate patterns
  const altMatch = url.match(/[?&]id=([a-zA-Z0-9]{15,18})/i);
  if (altMatch) {
    return altMatch[1];
  }
  
  return null;
}

// Normalize URL
export function normalizeUrl(url: string): string {
  if (!url) return '';
  
  let normalized = url.trim();
  
  // Add https:// if missing
  if (!normalized.match(/^https?:\/\//i)) {
    normalized = `https://${normalized}`;
  }
  
  // Remove tracking params
  try {
    const parsed = new URL(normalized);
    const paramsToRemove = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'gclid', 'fbclid', 'msclkid', 'ref', 'source'
    ];
    paramsToRemove.forEach(param => parsed.searchParams.delete(param));
    normalized = parsed.toString();
  } catch {
    // Invalid URL, return as-is
  }
  
  return normalized;
}

// Parse currency value
export function parseCurrency(value: string): number | null {
  if (!value) return null;
  
  // Remove currency symbols, commas, spaces, and "USD" prefix
  const cleaned = value.replace(/[$,\s]|USD|EUR|GBP/gi, '').trim();
  
  // Handle K/M suffixes
  const suffixMatch = cleaned.match(/^([\d.]+)([KkMm])?$/);
  if (suffixMatch) {
    let num = parseFloat(suffixMatch[1]);
    if (suffixMatch[2]?.toLowerCase() === 'k') num *= 1000;
    if (suffixMatch[2]?.toLowerCase() === 'm') num *= 1000000;
    return isNaN(num) ? null : num;
  }
  
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// Parse date in various formats
export function parseDate(value: string): string | null {
  if (!value) return null;
  
  // M/D/YY or M/D/YYYY format
  const mdyMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdyMatch) {
    const month = mdyMatch[1].padStart(2, '0');
    const day = mdyMatch[2].padStart(2, '0');
    let year = mdyMatch[3];
    if (year.length === 2) {
      year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
    }
    return `${year}-${month}-${day}`;
  }
  
  // YYYY-MM-DD format (already correct)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  
  // Try standard Date parsing
  const dateVal = new Date(value);
  if (!isNaN(dateVal.getTime())) {
    return dateVal.toISOString().split('T')[0];
  }
  
  return null;
}

// Auto-detect if a column contains URLs
export function isUrlColumn(values: string[]): boolean {
  const urlCount = values.filter(v => 
    v && (v.startsWith('http') || v.includes('.com') || v.includes('.io') || v.includes('.org'))
  ).length;
  return urlCount >= values.length * 0.5; // At least 50% are URLs
}

// Import result types
export interface ImportRow {
  rowIndex: number;
  accountName?: string;
  accountMatched: boolean;
  accountId?: string;
  fieldsToUpdate: string[];
  warnings: string[];
  data: Record<string, any>;
}

export interface ImportPreview {
  totalRows: number;
  matchedAccounts: number;
  newAccounts: number;
  headerMappings: Record<string, string>;
  unmappedHeaders: string[];
  rows: ImportRow[];
  warnings: {
    missingSalesforceAccount: number;
    missingPlanhat: number;
    missingAgreement: number;
  };
}
