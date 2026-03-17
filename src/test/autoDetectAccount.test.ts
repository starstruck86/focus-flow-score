import { describe, it, expect } from 'vitest';
import { detectAccountFromTranscript } from '@/components/coach/autoDetectAccount';
import type { Account } from '@/types';

const makeAccount = (overrides: Partial<Account> = {}): Account => ({
  id: '1',
  name: 'Acme Corp',
  website: '',
  industry: '',
  priority: 'medium',
  tier: 'B',
  accountStatus: 'active',
  motion: 'new-logo',
  salesforceLink: '',
  salesforceId: '',
  planhatLink: '',
  currentAgreementLink: '',
  techStack: [],
  techStackNotes: '',
  techFitFlag: 'good',
  outreachStatus: 'not-started',
  cadenceName: '',
  lastTouchDate: '',
  lastTouchType: '',
  touchesThisWeek: 0,
  nextTouchDue: '',
  nextStep: '',
  notes: '',
  tags: [],
  marTech: '',
  ecommerce: '',
  directEcommerce: false,
  emailSmsCapture: false,
  loyaltyMembership: false,
  categoryComplexity: false,
  mobileApp: false,
  crmLifecycleTeamSize: 0,
  contactStatus: 'not-started',
  triggerEvents: [],
  icpFitScore: null,
  timingScore: null,
  priorityScore: null,
  highProbabilityBuyer: false,
  triggeredAccount: false,
  confidenceScore: null,
  lastEnrichedAt: null,
  marketingPlatformDetected: null,
  lifecycleTier: null,
  enrichmentSourceSummary: null,
  lifecycleOverride: false,
  lifecycleOverrideReason: null,
  icpScoreOverride: null,
  enrichmentEvidence: null,
  tierOverride: null,
  ...overrides,
});

describe('detectAccountFromTranscript', () => {
  it('returns null for empty inputs', () => {
    expect(detectAccountFromTranscript('', '', [])).toBeNull();
    expect(detectAccountFromTranscript('hello', '', [])).toBeNull();
  });

  it('detects exact account name in transcript', () => {
    const accounts = [makeAccount({ id: 'a1', name: 'Acme Corp' })];
    const result = detectAccountFromTranscript(
      'Hello, this is a call with Acme Corp about their renewal.',
      '',
      accounts,
    );
    expect(result).not.toBeNull();
    expect(result!.accountId).toBe('a1');
    expect(result!.accountName).toBe('Acme Corp');
  });

  it('detects account from participants field', () => {
    const accounts = [makeAccount({ id: 'a2', name: 'TechVision Inc' })];
    const result = detectAccountFromTranscript(
      'Generic conversation text without company names.',
      'John from TechVision Inc, Sarah from us',
      accounts,
    );
    expect(result).not.toBeNull();
    expect(result!.accountId).toBe('a2');
  });

  it('skips very short account names', () => {
    const accounts = [makeAccount({ id: 'a3', name: 'AI' })];
    const result = detectAccountFromTranscript(
      'We discussed AI strategy with the team.',
      '',
      accounts,
    );
    expect(result).toBeNull();
  });

  it('returns highest confidence match', () => {
    const accounts = [
      makeAccount({ id: 'a4', name: 'Global Solutions' }),
      makeAccount({ id: 'a5', name: 'Global Solutions International', website: 'https://gsi.com' }),
    ];
    const result = detectAccountFromTranscript(
      'Meeting with Global Solutions International about gsi.com migration.',
      'Team from Global Solutions International',
      accounts,
    );
    expect(result).not.toBeNull();
    expect(result!.accountId).toBe('a5');
  });

  it('detects via website domain', () => {
    const accounts = [makeAccount({ id: 'a6', name: 'Zenith Corp', website: 'https://www.zenithcorp.com' })];
    const result = detectAccountFromTranscript(
      'Please check the portal at zenithcorp for the latest docs.',
      '',
      accounts,
    );
    // Domain match alone scores 3, but name 'Zenith Corp' also partially matches via tokens
    expect(result).not.toBeNull();
  });

  it('does not false-positive on common words', () => {
    const accounts = [makeAccount({ id: 'a7', name: 'The Meeting Company' })];
    const result = detectAccountFromTranscript(
      'Let us schedule a meeting to discuss the project timeline.',
      '',
      accounts,
    );
    // 'meeting' and 'the' are stop words, 'company' alone scores low
    // With threshold of 5, this should be null or very low
    // "company" token matches (score 2) but that's below threshold 5
    expect(result).toBeNull();
  });
});
