/**
 * Planner public surface — Phase 2 (inert).
 * Re-exports only. No side effects on import.
 */
export * from './contextTypes';
export { resolveBindings } from './resolveBindings';
export { SCOPE_BUDGETS, TOTAL_CAPS, budgetsForDepth } from './scopeBudgets';
export { SCOPE_WEIGHTS, weightsForMode } from './scopeWeights';
export { scoreConfidence } from './confidence';
export { buildPlan } from './buildPlan';
export {
  buildPlanBuilt,
  buildPlanCompleted,
  buildPlanRefused,
} from './telemetry';
export type {
  PlanBuiltEvent,
  PlanCompletedEvent,
  PlanRefusedEvent,
} from './telemetry';
