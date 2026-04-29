/**
 * Strategy Skills Registry — Phase 1 (inert).
 *
 * Read-only catalog of declarative skill manifests. NOT imported by
 * any runtime code (edge functions, hooks, components). Reachable
 * only from tests in `src/lib/strategy-skills/__tests__/`.
 */
import type { SkillManifest } from './types';
import { povManifest } from './manifests/pov';
import { researchManifest } from './manifests/research';
import { conversationManifest } from './manifests/conversation';
import { refineManifest } from './manifests/refine';
import { brainstormManifest } from './manifests/brainstorm';
import { discoveryPrepManifest } from './manifests/discoveryPrep';
import { accountBriefManifest } from './manifests/accountBrief';
import { ninetyDayPlanManifest } from './manifests/ninetyDayPlan';
import { objectionManifest } from './manifests/objection';
import { stakeholderMapManifest } from './manifests/stakeholderMap';

export const SKILL_MANIFESTS: ReadonlyArray<SkillManifest> = Object.freeze([
  povManifest,
  researchManifest,
  conversationManifest,
  refineManifest,
  brainstormManifest,
  discoveryPrepManifest,
  accountBriefManifest,
  ninetyDayPlanManifest,
  objectionManifest,
  stakeholderMapManifest,
]);

export const SKILL_REGISTRY: Readonly<Record<string, SkillManifest>> = Object.freeze(
  SKILL_MANIFESTS.reduce<Record<string, SkillManifest>>((acc, m) => {
    acc[m.id] = m;
    return acc;
  }, {}),
);
