/**
 * Strategy Skills Registry — Phase 1 (inert).
 *
 * Read-only catalog of declarative skill manifests. NOT imported by
 * any runtime code (edge functions, hooks, components). Reachable
 * only from tests in `src/lib/strategy-skills/_tests__/`.
 */
import type { SkillManifest } from './types';
import { conversationPovManifest } from './manifests/conversationPov';
import { discoveryPrepManifest } from './manifests/discoveryPrep';
import { commercialInsightManifest } from './manifests/commercialInsight';
import { accountResearchManifest } from './manifests/accountResearch';
import { discoveryQuestionsManifest } from './manifests/discoveryQuestions';
import { meddiccReviewManifest } from './manifests/meddiccReview';
import { demoStrategyManifest } from './manifests/demoStrategy';
import { followUpEmailManifest } from './manifests/followUpEmail';
import { objectionStrategyManifest } from './manifests/objectionStrategy';
import { executiveBriefManifest } from './manifests/executiveBrief';

export const SKILL_MANIFESTS: ReadonlyArray<SkillManifest> = Object.freeze([
  conversationPovManifest,
  discoveryPrepManifest,
  commercialInsightManifest,
  accountResearchManifest,
  discoveryQuestionsManifest,
  meddiccReviewManifest,
  demoStrategyManifest,
  followUpEmailManifest,
  objectionStrategyManifest,
  executiveBriefManifest,
]);

export const SKILL_REGISTRY: Readonly<Record<string, SkillManifest>> = Object.freeze(
  SKILL_MANIFESTS.reduce<Record<string, SkillManifest>>((acc, m) => {
    acc[m.id] = m;
    return acc;
  }, {}),
);
