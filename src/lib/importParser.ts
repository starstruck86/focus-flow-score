// CSV parsing and data processing for combined import
import type { 
  EnhancedHeaderMapping, 
  ParsedImportRow, 
  ImportTargetObject,
  DataTransform,
  MotionType,
  RowType,
  PendingValueMapping,
  UnrecognizedLink,
  NeedsReviewRow,
  ImportPreviewSummary,
} from './importTypes';
import { 
  MOTION_HEADER_ALIASES, 
  MOTION_VALUE_ALIASES, 
  RENEWAL_INDICATOR_FIELDS,
  PICKLIST_VALUES,
} from './importTypes';
import type { HeaderMapping, ValueMapping, AccountAlias } from '@/hooks/useImportMappings';
import type { DbAccount, DbOpportunity, DbRenewal } from '@/hooks/useAccountsData';

// Extended header aliases for all objects
export const HEADER_ALIASES: Record<string, { object: ImportTargetObject; field: string; transform?: DataTransform }> = {
  // Account fields
  'account name': { object: 'account', field: 'name' },
  'account': { object: 'account', field: 'name' },
  'company': { object: 'account', field: 'name' },
  'company name': { object: 'account', field: 'name' },
  'website': { object: 'account', field: 'website', transform: 'url' },
  'domain': { object: 'account', field: 'website', transform: 'extract_domain' },
  'url': { object: 'account', field: 'website', transform: 'url' },
  'priority': { object: 'account', field: 'priority', transform: 'picklist' },
  'tier': { object: 'account', field: 'tier', transform: 'picklist' },
  'industry': { object: 'account', field: 'industry' },
  
  // Account links
  'salesforce account link': { object: 'account', field: 'salesforce_link', transform: 'url' },
  'sfdc account': { object: 'account', field: 'salesforce_link', transform: 'url' },
  'account sfdc': { object: 'account', field: 'salesforce_link', transform: 'url' },
  'account url': { object: 'account', field: 'salesforce_link', transform: 'url' },
  'salesforce link': { object: 'account', field: 'salesforce_link', transform: 'url' },
  'sfdc link': { object: 'account', field: 'salesforce_link', transform: 'url' },
  'sf account': { object: 'account', field: 'salesforce_link', transform: 'url' },
  'account salesforce': { object: 'account', field: 'salesforce_link', transform: 'url' },
  
  // Planhat (can be account or renewal level)
  'planhat link': { object: 'account', field: 'planhat_link', transform: 'url' },
  'planhat url': { object: 'account', field: 'planhat_link', transform: 'url' },
  'planhat': { object: 'account', field: 'planhat_link', transform: 'url' },
  'ph link': { object: 'account', field: 'planhat_link', transform: 'url' },
  
  // Agreement (can be account or renewal level)
  'current agreement link': { object: 'account', field: 'current_agreement_link', transform: 'url' },
  'agreement link': { object: 'account', field: 'current_agreement_link', transform: 'url' },
  'agreement url': { object: 'account', field: 'current_agreement_link', transform: 'url' },
  'contract link': { object: 'account', field: 'current_agreement_link', transform: 'url' },
  'salesforce contract link': { object: 'account', field: 'current_agreement_link', transform: 'url' },
  'current agreement': { object: 'account', field: 'current_agreement_link', transform: 'url' },
  'agreement': { object: 'account', field: 'current_agreement_link', transform: 'url' },
  'contract': { object: 'account', field: 'current_agreement_link', transform: 'url' },
  'sfdc contract': { object: 'account', field: 'current_agreement_link', transform: 'url' },
  
  // Motion
  'motion': { object: 'account', field: 'motion', transform: 'picklist' },
  'type': { object: 'account', field: 'motion', transform: 'picklist' },
  'segment': { object: 'account', field: 'motion', transform: 'picklist' },
  'book': { object: 'account', field: 'motion', transform: 'picklist' },
  'team': { object: 'account', field: 'motion', transform: 'picklist' },
  
  // CSM
  'csm': { object: 'renewal', field: 'csm' },
  'customer success': { object: 'renewal', field: 'csm' },
  'cs manager': { object: 'renewal', field: 'csm' },
  'customer success manager': { object: 'renewal', field: 'csm' },
  
  // Opportunity fields
  'opportunity name': { object: 'opportunity', field: 'name' },
  'opp name': { object: 'opportunity', field: 'name' },
  'opportunity': { object: 'opportunity', field: 'name' },
  'opp': { object: 'opportunity', field: 'name' },
  'deal name': { object: 'opportunity', field: 'name' },
  'deal': { object: 'opportunity', field: 'name' },
  
  'salesforce opportunity link': { object: 'opportunity', field: 'salesforce_link', transform: 'url' },
  'opp sfdc': { object: 'opportunity', field: 'salesforce_link', transform: 'url' },
  'opportunity url': { object: 'opportunity', field: 'salesforce_link', transform: 'url' },
  'sfdc opp': { object: 'opportunity', field: 'salesforce_link', transform: 'url' },
  'opp salesforce': { object: 'opportunity', field: 'salesforce_link', transform: 'url' },
  'opportunity salesforce': { object: 'opportunity', field: 'salesforce_link', transform: 'url' },
  'opp link': { object: 'opportunity', field: 'salesforce_link', transform: 'url' },
  
  'arr': { object: 'opportunity', field: 'arr', transform: 'number' },
  'annual recurring revenue': { object: 'opportunity', field: 'arr', transform: 'number' },
  'revenue': { object: 'opportunity', field: 'arr', transform: 'number' },
  'value': { object: 'opportunity', field: 'arr', transform: 'number' },
  'amount': { object: 'opportunity', field: 'arr', transform: 'number' },
  'deal value': { object: 'opportunity', field: 'arr', transform: 'number' },
  
  'close date': { object: 'opportunity', field: 'close_date', transform: 'date' },
  'closedate': { object: 'opportunity', field: 'close_date', transform: 'date' },
  'expected close': { object: 'opportunity', field: 'close_date', transform: 'date' },
  'close': { object: 'opportunity', field: 'close_date', transform: 'date' },
  'closing date': { object: 'opportunity', field: 'close_date', transform: 'date' },
  
  'stage': { object: 'opportunity', field: 'stage', transform: 'picklist' },
  'opp stage': { object: 'opportunity', field: 'stage', transform: 'picklist' },
  'opportunity stage': { object: 'opportunity', field: 'stage', transform: 'picklist' },
  'deal stage': { object: 'opportunity', field: 'stage', transform: 'picklist' },
  'sales stage': { object: 'opportunity', field: 'stage', transform: 'picklist' },
  
  'status': { object: 'opportunity', field: 'status', transform: 'picklist' },
  'opp status': { object: 'opportunity', field: 'status', transform: 'picklist' },
  'opportunity status': { object: 'opportunity', field: 'status', transform: 'picklist' },
  'deal status': { object: 'opportunity', field: 'status', transform: 'picklist' },
  
  'deal type': { object: 'opportunity', field: 'deal_type', transform: 'picklist' },
  'dealtype': { object: 'opportunity', field: 'deal_type', transform: 'picklist' },
  'opp type': { object: 'opportunity', field: 'deal_type', transform: 'picklist' },
  'opportunity type': { object: 'opportunity', field: 'deal_type', transform: 'picklist' },
  
  'churn risk': { object: 'opportunity', field: 'churn_risk', transform: 'picklist' },
  'risk': { object: 'opportunity', field: 'churn_risk', transform: 'picklist' },
  
  'next step': { object: 'opportunity', field: 'next_step' },
  'nextstep': { object: 'opportunity', field: 'next_step' },
  'next_step': { object: 'opportunity', field: 'next_step' },
  'next action': { object: 'opportunity', field: 'next_step' },
  
  // Renewal fields
  'renewal date': { object: 'renewal', field: 'renewal_due', transform: 'date' },
  'renewaldate': { object: 'renewal', field: 'renewal_due', transform: 'date' },
  'renewal due': { object: 'renewal', field: 'renewal_due', transform: 'date' },
  'renewaldue': { object: 'renewal', field: 'renewal_due', transform: 'date' },
  'due date': { object: 'renewal', field: 'renewal_due', transform: 'date' },
  'duedate': { object: 'renewal', field: 'renewal_due', transform: 'date' },
  'contract end': { object: 'renewal', field: 'renewal_due', transform: 'date' },
  'term end': { object: 'renewal', field: 'renewal_due', transform: 'date' },
  
  'renewal arr': { object: 'renewal', field: 'arr', transform: 'number' },
  'baseline arr': { object: 'renewal', field: 'arr', transform: 'number' },
  'current arr': { object: 'renewal', field: 'arr', transform: 'number' },
  'renewing arr': { object: 'renewal', field: 'arr', transform: 'number' },
  
  'health': { object: 'renewal', field: 'health_status', transform: 'picklist' },
  'health status': { object: 'renewal', field: 'health_status', transform: 'picklist' },
  'healthstatus': { object: 'renewal', field: 'health_status', transform: 'picklist' },
  
  'auto renew': { object: 'renewal', field: 'auto_renew', transform: 'picklist' },
  'autorenew': { object: 'renewal', field: 'auto_renew', transform: 'picklist' },
  'auto-renew': { object: 'renewal', field: 'auto_renew', transform: 'picklist' },
  'auto': { object: 'renewal', field: 'auto_renew', transform: 'picklist' },
  
  'product': { object: 'renewal', field: 'product' },
  'plan': { object: 'renewal', field: 'product' },
  'subscription': { object: 'renewal', field: 'product' },
  
  'entitlements': { object: 'renewal', field: 'entitlements' },
  'entitlement': { object: 'renewal', field: 'entitlements' },
  
  'usage': { object: 'renewal', field: 'usage' },
  'consumption': { object: 'renewal', field: 'usage' },
  
  'term': { object: 'renewal', field: 'term' },
  'contract term': { object: 'renewal', field: 'term' },
  'length': { object: 'renewal', field: 'term' },
  
  'cs notes': { object: 'renewal', field: 'cs_notes' },
  'csnotes': { object: 'renewal', field: 'cs_notes' },
  'customer notes': { object: 'renewal', field: 'cs_notes' },
  
  'owner': { object: 'renewal', field: 'owner' },
  'rep': { object: 'renewal', field: 'owner' },
  'sales rep': { object: 'renewal', field: 'owner' },
  'account owner': { object: 'renewal', field: 'owner' },
  
  // Contact fields
  'contact name': { object: 'contact', field: 'name' },
  'contact': { object: 'contact', field: 'name' },
  'full name': { object: 'contact', field: 'name' },
  'person': { object: 'contact', field: 'name' },
  
  'title': { object: 'contact', field: 'title' },
  'job title': { object: 'contact', field: 'title' },
  'role': { object: 'contact', field: 'title' },
  'position': { object: 'contact', field: 'title' },
  
  'email': { object: 'contact', field: 'email' },
  'email address': { object: 'contact', field: 'email' },
  'e-mail': { object: 'contact', field: 'email' },
  'contact email': { object: 'contact', field: 'email' },
  
  'salesforce contact link': { object: 'contact', field: 'salesforce_link', transform: 'url' },
  'contact sfdc': { object: 'contact', field: 'salesforce_link', transform: 'url' },
  'contact url': { object: 'contact', field: 'salesforce_link', transform: 'url' },
  'sfdc contact': { object: 'contact', field: 'salesforce_link', transform: 'url' },
  'contact salesforce': { object: 'contact', field: 'salesforce_link', transform: 'url' },
  
  'linkedin': { object: 'contact', field: 'linkedin_url', transform: 'url' },
  'linkedin url': { object: 'contact', field: 'linkedin_url', transform: 'url' },
  'linkedin link': { object: 'contact', field: 'linkedin_url', transform: 'url' },
  'li url': { object: 'contact', field: 'linkedin_url', transform: 'url' },
  'li link': { object: 'contact', field: 'linkedin_url', transform: 'url' },
};

// Normalize header for matching
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[_\s-]+/g, ' ').trim();
}

// Parse CSV line with proper quote handling
export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Parse full CSV
export function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 1) return { headers: [], rows: [] };
  
  const headers = parseCSVLine(lines[0]);
  const rows: string[][] = [];
  
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim()) {
      rows.push(parseCSVLine(lines[i]));
    }
  }
  
  return { headers, rows };
}

// Auto-map headers using aliases and saved mappings
export function autoMapHeaders(
  csvHeaders: string[],
  savedMappings: HeaderMapping[],
  columnValues: string[][]
): EnhancedHeaderMapping[] {
  const mappings: EnhancedHeaderMapping[] = [];
  
  csvHeaders.forEach((header, colIndex) => {
    const normalized = normalizeHeader(header);
    
    // First check saved mappings
    const savedMapping = savedMappings.find(m => 
      normalizeHeader(m.csv_header) === normalized
    );
    
    if (savedMapping) {
      mappings.push({
        csvHeader: header,
        colIndex,
        targetObject: savedMapping.target_object as ImportTargetObject,
        targetField: savedMapping.target_field,
        dataTransform: (savedMapping.data_transform || 'text') as DataTransform,
        isMapped: true,
        isFromSavedMapping: true,
        confidence: 'high',
      });
      return;
    }
    
    // Then check built-in aliases
    const aliasMatch = HEADER_ALIASES[normalized];
    if (aliasMatch) {
      mappings.push({
        csvHeader: header,
        colIndex,
        targetObject: aliasMatch.object,
        targetField: aliasMatch.field,
        dataTransform: aliasMatch.transform || 'text',
        isMapped: true,
        isFromSavedMapping: false,
        confidence: 'high',
      });
      return;
    }
    
    // Try to detect URL columns
    const colVals = columnValues.map(row => row[colIndex] || '');
    const urlCount = colVals.filter(v => v && (v.startsWith('http') || v.includes('.com') || v.includes('.io'))).length;
    const isUrlColumn = urlCount >= colVals.length * 0.3;
    
    if (isUrlColumn) {
      // Detect URL type from first valid URL
      const firstUrl = colVals.find(v => v && v.length > 5);
      if (firstUrl) {
        const linkType = detectLinkType(firstUrl);
        if (linkType !== 'unknown') {
          const linkMapping = getLinkTypeMapping(linkType);
          if (linkMapping) {
            mappings.push({
              csvHeader: header,
              colIndex,
              targetObject: linkMapping.object,
              targetField: linkMapping.field,
              dataTransform: 'url',
              isMapped: true,
              isFromSavedMapping: false,
              confidence: 'medium',
            });
            return;
          }
        }
      }
    }
    
    // Unmapped column
    mappings.push({
      csvHeader: header,
      colIndex,
      targetObject: 'ignore',
      targetField: null,
      dataTransform: 'text',
      isMapped: false,
      isFromSavedMapping: false,
      confidence: 'low',
    });
  });
  
  return mappings;
}

// Detect link type from URL
export function detectLinkType(url: string): string {
  if (!url) return 'unknown';
  const lower = url.toLowerCase();
  
  if (lower.includes('salesforce.com') || lower.includes('.force.com') || lower.includes('lightning.force.com')) {
    if (lower.includes('/account/') || lower.includes('/001')) return 'salesforce_account';
    if (lower.includes('/opportunity/') || lower.includes('/006')) return 'salesforce_opportunity';
    if (lower.includes('/contact/') || lower.includes('/003')) return 'salesforce_contact';
    if (lower.includes('/contract/') || lower.includes('/800')) return 'salesforce_contract';
    return 'salesforce_account';
  }
  
  if (lower.includes('planhat.com') || lower.includes('planhat.io')) return 'planhat';
  if (lower.includes('linkedin.com')) return 'linkedin';
  
  if (lower.includes('docusign.') || lower.includes('adobesign.') || 
      lower.includes('docs.google.com') || lower.includes('drive.google.com') ||
      lower.includes('sharepoint.com') || lower.includes('box.com') || 
      lower.includes('dropbox.com') || lower.includes('.pdf')) {
    return 'agreement';
  }
  
  return 'unknown';
}

// Get mapping for link type
function getLinkTypeMapping(linkType: string): { object: ImportTargetObject; field: string } | null {
  switch (linkType) {
    case 'salesforce_account': return { object: 'account', field: 'salesforce_link' };
    case 'salesforce_opportunity': return { object: 'opportunity', field: 'salesforce_link' };
    case 'salesforce_contact': return { object: 'contact', field: 'salesforce_link' };
    case 'salesforce_contract':
    case 'agreement': return { object: 'account', field: 'current_agreement_link' };
    case 'planhat': return { object: 'account', field: 'planhat_link' };
    case 'linkedin': return { object: 'contact', field: 'linkedin_url' };
    default: return null;
  }
}

// Extract Salesforce ID from URL
export function extractSalesforceId(url: string): string | null {
  if (!url) return null;
  const match = url.match(/\/(001|003|006|800)[a-zA-Z0-9]{12,15}/);
  if (match) return match[0].substring(1);
  const altMatch = url.match(/[?&]id=([a-zA-Z0-9]{15,18})/i);
  if (altMatch) return altMatch[1];
  return null;
}

// Normalize URL
export function normalizeUrl(url: string): string {
  if (!url) return '';
  let normalized = url.trim();
  if (!normalized.match(/^https?:\/\//i)) {
    normalized = `https://${normalized}`;
  }
  try {
    const parsed = new URL(normalized);
    ['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid'].forEach(p => 
      parsed.searchParams.delete(p)
    );
    normalized = parsed.toString();
  } catch {}
  return normalized;
}

// Parse currency
export function parseCurrency(value: string): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]|USD|EUR|GBP/gi, '').trim();
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

// Parse date
export function parseDate(value: string): string | null {
  if (!value) return null;
  const mdyMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdyMatch) {
    const month = mdyMatch[1].padStart(2, '0');
    const day = mdyMatch[2].padStart(2, '0');
    let year = mdyMatch[3];
    if (year.length === 2) year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
    return `${year}-${month}-${day}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dateVal = new Date(value);
  if (!isNaN(dateVal.getTime())) return dateVal.toISOString().split('T')[0];
  return null;
}

// Extract domain from URL
export function extractDomain(url: string): string | null {
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    return new URL(normalized).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Detect motion from row
export function detectMotion(
  row: string[],
  mappings: EnhancedHeaderMapping[],
  valueMappings: ValueMapping[]
): MotionType {
  // First check if there's an explicit motion column
  const motionMapping = mappings.find(m => 
    m.targetObject === 'account' && m.targetField === 'motion'
  );
  
  if (motionMapping) {
    const rawValue = row[motionMapping.colIndex]?.toLowerCase().trim() || '';
    
    // Check saved value mappings
    const savedValueMap = valueMappings.find(vm => 
      vm.field_name === 'motion' && vm.csv_value.toLowerCase() === rawValue
    );
    if (savedValueMap) return savedValueMap.app_value as MotionType;
    
    // Check built-in aliases
    const aliasedValue = MOTION_VALUE_ALIASES[rawValue];
    if (aliasedValue) return aliasedValue;
    
    // Direct match
    if (['new-logo', 'renewal', 'general', 'both'].includes(rawValue)) {
      return rawValue as MotionType;
    }
  }
  
  // Fallback: check for renewal indicators
  const hasRenewalFields = mappings.some(m => m.targetObject === 'renewal' && m.isMapped);
  if (hasRenewalFields) {
    // Check if this row has renewal data
    const renewalMappings = mappings.filter(m => m.targetObject === 'renewal');
    const hasRenewalData = renewalMappings.some(m => row[m.colIndex]?.trim());
    if (hasRenewalData) return 'renewal';
  }
  
  return 'new-logo';
}

// Apply transform to value
export function applyTransform(value: string, transform: DataTransform): any {
  if (!value) return null;
  
  switch (transform) {
    case 'url': return normalizeUrl(value);
    case 'date': return parseDate(value);
    case 'number': return parseCurrency(value);
    case 'extract_domain': return extractDomain(value);
    case 'extract_sfdc_id': return extractSalesforceId(value);
    case 'picklist': return value.toLowerCase().replace(/\s+/g, '-');
    default: return value.trim();
  }
}

// Build account lookup for matching
export function buildAccountLookup(
  accounts: DbAccount[],
  aliases: AccountAlias[]
): Map<string, DbAccount> {
  const lookup = new Map<string, DbAccount>();
  
  accounts.forEach(acc => {
    // By name
    lookup.set(`name:${acc.name.toLowerCase().trim()}`, acc);
    
    // By Salesforce ID
    if (acc.salesforce_id) {
      lookup.set(`sfid:${acc.salesforce_id}`, acc);
    }
    
    // By domain
    if (acc.website) {
      const domain = extractDomain(acc.website);
      if (domain) lookup.set(`domain:${domain}`, acc);
    }
  });
  
  // Add aliases
  aliases.forEach(alias => {
    const account = accounts.find(a => a.id === alias.account_id);
    if (account) {
      lookup.set(`${alias.alias_type}:${alias.alias_value.toLowerCase()}`, account);
    }
  });
  
  return lookup;
}

// Find matching account
export function findMatchingAccount(
  name: string,
  website: string | undefined,
  sfId: string | undefined,
  lookup: Map<string, DbAccount>
): DbAccount | undefined {
  // Priority 1: Salesforce ID
  if (sfId) {
    const match = lookup.get(`sfid:${sfId}`);
    if (match) return match;
  }
  
  // Priority 2: Domain
  if (website) {
    const domain = extractDomain(website);
    if (domain) {
      const match = lookup.get(`domain:${domain}`);
      if (match) return match;
    }
  }
  
  // Priority 3: Exact name
  const nameMatch = lookup.get(`name:${name.toLowerCase().trim()}`);
  if (nameMatch) return nameMatch;
  
  return undefined;
}

// Calculate fuzzy matches for needs review
export function findFuzzyMatches(
  name: string,
  accounts: DbAccount[]
): { id: string; name: string; website?: string; score: number }[] {
  const normalized = name.toLowerCase().trim();
  
  return accounts
    .map(acc => {
      const accName = acc.name.toLowerCase().trim();
      let score = 0;
      
      // Exact match
      if (accName === normalized) score = 100;
      // Contains
      else if (accName.includes(normalized) || normalized.includes(accName)) {
        score = 70;
      }
      // Word overlap
      else {
        const words1 = normalized.split(/\s+/);
        const words2 = accName.split(/\s+/);
        const overlap = words1.filter(w => words2.some(w2 => w2.includes(w) || w.includes(w2))).length;
        score = (overlap / Math.max(words1.length, words2.length)) * 50;
      }
      
      return { id: acc.id, name: acc.name, website: acc.website, score };
    })
    .filter(m => m.score > 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

// Calculate import summary
export function calculateSummary(rows: ParsedImportRow[]): ImportPreviewSummary {
  return {
    totalRows: rows.length,
    accountsToCreate: rows.filter(r => r.accountAction === 'create' && !r.ignored).length,
    accountsToUpdate: rows.filter(r => r.accountAction === 'update' && !r.ignored).length,
    opportunitiesToCreate: rows.filter(r => r.opportunityAction === 'create' && !r.ignored).length,
    opportunitiesToUpdate: rows.filter(r => r.opportunityAction === 'update' && !r.ignored).length,
    renewalsToCreate: rows.filter(r => r.renewalAction === 'create' && !r.ignored).length,
    renewalsToUpdate: rows.filter(r => r.renewalAction === 'update' && !r.ignored).length,
    needsReviewCount: rows.filter(r => r.needsReview && !r.ignored).length,
    ignoredCount: rows.filter(r => r.ignored).length,
    warningCount: rows.reduce((sum, r) => sum + r.warnings.length, 0),
    newLogoRowCount: rows.filter(r => r.motion === 'new-logo' && !r.ignored).length,
    renewalRowCount: rows.filter(r => r.motion === 'renewal' && !r.ignored).length,
  };
}

// Build opportunity lookup for matching
export function buildOpportunityLookup(
  opportunities: DbOpportunity[]
): Map<string, DbOpportunity> {
  const lookup = new Map<string, DbOpportunity>();
  
  opportunities.forEach(opp => {
    // By Salesforce ID (highest priority)
    if (opp.salesforce_id) {
      lookup.set(`sfid:${opp.salesforce_id}`, opp);
    }
    
    // By name + account
    if (opp.account_id) {
      lookup.set(`name+account:${opp.name.toLowerCase().trim()}:${opp.account_id}`, opp);
    }
    
    // By name only (lower priority, for fuzzy matching)
    lookup.set(`name:${opp.name.toLowerCase().trim()}`, opp);
  });
  
  return lookup;
}

// Find matching opportunity
export function findMatchingOpportunity(
  name: string,
  accountId: string | undefined,
  sfId: string | undefined,
  closeDate: string | undefined,
  arr: number | undefined,
  lookup: Map<string, DbOpportunity>,
  allOpportunities: DbOpportunity[]
): { match: DbOpportunity | undefined; confidence: 'high' | 'medium' | 'low' | 'suggestion' } {
  // Priority 1: Salesforce ID (high confidence)
  if (sfId) {
    const match = lookup.get(`sfid:${sfId}`);
    if (match) return { match, confidence: 'high' };
  }
  
  // Priority 2: Name + Account (high confidence)
  if (accountId && name) {
    const match = lookup.get(`name+account:${name.toLowerCase().trim()}:${accountId}`);
    if (match) return { match, confidence: 'high' };
  }
  
  // Priority 3: Name + Close Date + ARR (weak suggestion only)
  if (name && (closeDate || arr)) {
    const candidates = allOpportunities.filter(opp => {
      const nameMatch = opp.name.toLowerCase().includes(name.toLowerCase()) || 
                       name.toLowerCase().includes(opp.name.toLowerCase());
      const dateMatch = closeDate && opp.close_date === closeDate;
      const arrMatch = arr && opp.arr === arr;
      return nameMatch && (dateMatch || arrMatch);
    });
    
    if (candidates.length === 1) {
      return { match: candidates[0], confidence: 'suggestion' };
    }
  }
  
  return { match: undefined, confidence: 'low' };
}

// Find fuzzy opportunity matches for manual selection
export function findFuzzyOpportunityMatches(
  name: string,
  opportunities: DbOpportunity[]
): { id: string; name: string; accountName?: string; score: number }[] {
  const normalized = name.toLowerCase().trim();
  
  return opportunities
    .map(opp => {
      const oppName = opp.name.toLowerCase().trim();
      let score = 0;
      
      if (oppName === normalized) score = 100;
      else if (oppName.includes(normalized) || normalized.includes(oppName)) {
        score = 70;
      } else {
        const words1 = normalized.split(/\s+/);
        const words2 = oppName.split(/\s+/);
        const overlap = words1.filter(w => words2.some(w2 => w2.includes(w) || w.includes(w2))).length;
        score = (overlap / Math.max(words1.length, words2.length)) * 50;
      }
      
      return { id: opp.id, name: opp.name, score };
    })
    .filter(m => m.score > 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

// Detect opportunity conflicts (same opp mapped to multiple accounts)
export function detectOpportunityConflicts(
  rows: { rowIndex: number; oppName?: string; oppSfId?: string; accountName?: string; accountId?: string }[]
): Map<string, number[]> {
  const conflicts = new Map<string, number[]>();
  const oppToRows = new Map<string, { rowIndex: number; accountId?: string; accountName?: string }[]>();
  
  rows.forEach(row => {
    if (!row.oppName && !row.oppSfId) return;
    
    const key = row.oppSfId || row.oppName?.toLowerCase().trim() || '';
    if (!key) return;
    
    const existing = oppToRows.get(key) || [];
    existing.push({ rowIndex: row.rowIndex, accountId: row.accountId, accountName: row.accountName });
    oppToRows.set(key, existing);
  });
  
  // Find opps with multiple different accounts
  oppToRows.forEach((rowsForOpp, key) => {
    const uniqueAccounts = new Set(rowsForOpp.map(r => r.accountId || r.accountName));
    if (uniqueAccounts.size > 1) {
      conflicts.set(key, rowsForOpp.map(r => r.rowIndex));
    }
  });
  
  return conflicts;
}
