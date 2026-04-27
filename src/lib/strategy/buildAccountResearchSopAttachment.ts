/**
 * buildAccountResearchSopAttachment — Phase 3 wrapper.
 *
 * The Account Research task SOP attachment is now produced by the unified
 * resolver `buildStrategySopPayloads({ taskType: 'account_research' })`.
 * This wrapper preserves the original signature + named export
 * (`ACCOUNT_RESEARCH_REQUIRED_CHECKS`) so existing imports continue to
 * work unchanged.
 */
import {
  buildStrategySopPayloads,
  ACCOUNT_RESEARCH_REQUIRED_CHECKS,
  type AccountResearchSopAttachment,
} from './buildStrategySopPayloads';

export type { AccountResearchSopAttachment };
export { ACCOUNT_RESEARCH_REQUIRED_CHECKS };

export function buildAccountResearchSopAttachment(): AccountResearchSopAttachment | null {
  return buildStrategySopPayloads({ taskType: 'account_research' }).taskSop;
}
