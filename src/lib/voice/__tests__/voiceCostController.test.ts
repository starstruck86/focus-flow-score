import { describe, it, expect, beforeEach } from 'vitest';
import {
  setVoiceMode,
  getVoiceMode,
  markTurnStart,
  markTurnEnd,
  checkAutoDowngrade,
  classifyUtterance,
  selectModel,
  batchUtterances,
  filterByVerbosity,
  estimateSessionCost,
} from '@/lib/voice/voiceCostController';
import { startUsageSession, endUsageSession } from '@/lib/voice/voiceUsageTracker';

describe('Voice Cost Controller', () => {
  beforeEach(() => {
    setVoiceMode('balanced');
    endUsageSession();
  });

  describe('utterance classification', () => {
    it('classifies short static phrases', () => {
      expect(classifyUtterance("Alright, let's do this!")).toBe('static');
    });

    it('classifies long text as dynamic', () => {
      const long = 'A'.repeat(201);
      expect(classifyUtterance(long)).toBe('dynamic');
    });

    it('classifies medium text as semi_dynamic', () => {
      expect(classifyUtterance('Your response was good but needs work on the close.')).toBe('semi_dynamic');
    });
  });

  describe('model selection', () => {
    it('defaults to fast model in balanced mode', () => {
      const model = selectModel('semi_dynamic');
      expect(model.modelId).toBe('eleven_turbo_v2_5');
    });

    it('uses premium for dynamic in full mode', () => {
      setVoiceMode('full');
      const model = selectModel('dynamic');
      expect(model.modelId).toBe('eleven_multilingual_v2');
    });
  });

  describe('UX-safe auto-downgrade', () => {
    it('defers downgrade during active turn', () => {
      // Create a session with high usage to trigger downgrade
      const session = startUsageSession();
      session.estimatedCreditsApprox = 15000; // critical level
      setVoiceMode('full');

      markTurnStart();
      const result = checkAutoDowngrade();
      expect(result).toBe(true);
      // Mode should NOT have changed yet
      expect(getVoiceMode()).toBe('full');

      // After turn ends, downgrade should apply
      markTurnEnd();
      expect(getVoiceMode()).toBe('minimal');
    });

    it('applies downgrade immediately between turns', () => {
      const session = startUsageSession();
      session.estimatedCreditsApprox = 15000;
      setVoiceMode('full');

      const result = checkAutoDowngrade();
      expect(result).toBe(true);
      expect(getVoiceMode()).toBe('minimal');
    });
  });

  describe('utterance batching', () => {
    it('combines short utterances', () => {
      const result = batchUtterances(['OK.', 'Good.', 'Here is a longer sentence.']);
      expect(result.length).toBeLessThan(3);
    });

    it('returns single items unchanged', () => {
      expect(batchUtterances(['hello'])).toEqual(['hello']);
    });
  });

  describe('session cost estimation', () => {
    it('labels results as approximate', () => {
      const est = estimateSessionCost();
      expect(est).toHaveProperty('estimatedCreditsApprox');
    });

    it('reduces cost in minimal mode', () => {
      setVoiceMode('full');
      const full = estimateSessionCost();
      setVoiceMode('minimal');
      const minimal = estimateSessionCost();
      expect(minimal.estimatedCreditsApprox).toBeLessThan(full.estimatedCreditsApprox);
    });
  });
});
