import { describe, it, expect } from 'vitest';
import { detectAccountFromTranscript } from '@/components/coach/autoDetectAccount';
import type { Account } from '@/types';

const makeAccount = (id: string, name: string, website = ''): Account => ({
  id, name, website,
  industry: '', priority: 'medium', tier: 'B', accountStatus: 'active',
  motion: 'new-logo', salesforceLink: '', salesforceId: '', planhatLink: '',
  currentAgreementLink: '', techStack: [], techStackNotes: '',
  techFitFlag: 'good', outreachStatus: 'not-started', cadenceName: '',
  lastTouchDate: '', touchesThisWeek: 0, nextStep: '', notes: '', tags: [],
  marTech: '', ecommerce: '', directEcommerce: false, emailSmsCapture: false,
  loyaltyMembership: false, categoryComplexity: false, mobileApp: false,
  crmLifecycleTeamSize: 0, contactStatus: 'not-started', triggerEvents: [],
  createdAt: '', updatedAt: '',
} as Account);

describe('detectAccountFromTranscript', () => {
  it('returns null for empty inputs', () => {
    expect(detectAccountFromTranscript('', '', [])).toBeNull();
    expect(detectAccountFromTranscript('hello', '', [])).toBeNull();
  });

  it('detects exact account name in transcript', () => {
    const accounts = [makeAccount('a1', 'Acme Corp')];
    const result = detectAccountFromTranscript(
      'Hello, this is a call with Acme Corp about their renewal.',
      '', accounts,
    );
    expect(result).not.toBeNull();
    expect(result!.accountId).toBe('a1');
    expect(result!.accountName).toBe('Acme Corp');
  });

  it('detects account from participants field', () => {
    const accounts = [makeAccount('a2', 'TechVision Inc')];
    const result = detectAccountFromTranscript(
      'Generic conversation text.', 'John from TechVision Inc', accounts,
    );
    expect(result).not.toBeNull();
    expect(result!.accountId).toBe('a2');
  });

  it('skips very short account names without participant signal', () => {
    const accounts = [makeAccount('a3', 'AI')];
    const result = detectAccountFromTranscript(
      'We discussed AI strategy with the team.', '', accounts,
    );
    expect(result).toBeNull();
  });

  it('detects short account names when in participants', () => {
    const accounts = [makeAccount('a3b', 'SAP')];
    const result = detectAccountFromTranscript(
      'We discussed their platform migration.', 'John from SAP, Jane', accounts,
    );
    expect(result).not.toBeNull();
    expect(result!.accountId).toBe('a3b');
  });

  it('returns highest confidence match', () => {
    const accounts = [
      makeAccount('a4', 'Global Solutions'),
      makeAccount('a5', 'Global Solutions International', 'https://gsi.com'),
    ];
    const result = detectAccountFromTranscript(
      'Meeting with Global Solutions International about gsi.com migration.',
      'Team from Global Solutions International', accounts,
    );
    expect(result).not.toBeNull();
    expect(result!.accountId).toBe('a5');
  });

  it('detects via website domain', () => {
    const accounts = [makeAccount('a6', 'Zenith Corp', 'https://www.zenithcorp.com')];
    const result = detectAccountFromTranscript(
      'Please check the portal at zenithcorp for the latest docs.', '', accounts,
    );
    expect(result).not.toBeNull();
  });

  it('does not false-positive on common stop words', () => {
    const accounts = [makeAccount('a7', 'The Meeting Company')];
    const result = detectAccountFromTranscript(
      'Let us schedule a meeting to discuss the project timeline.', '', accounts,
    );
    expect(result).toBeNull();
  });

  it('handles case-insensitive matching', () => {
    const accounts = [makeAccount('a8', 'DataStream Analytics')];
    const result = detectAccountFromTranscript(
      'We spoke with DATASTREAM ANALYTICS about their pipeline.', '', accounts,
    );
    expect(result).not.toBeNull();
    expect(result!.accountId).toBe('a8');
  });
});
