/**
 * buildAccountResearchSopAttachment — Phase 3B clone for Account Research.
 *
 * Account Research is the next task we're using to validate the SOP engine
 * (Phase 3B style: shadow validation only). This helper mirrors the
 * inputs.__sop attachment logic from useTaskExecution (which serves
 * Discovery Prep) but reads from `sopContracts.tasks.account_research`.
 *
 * Phase 3B contract (Account Research):
 *   • NO prompt injection.
 *   • NO enforcement.
 *   • NO blocking.
 *   • The server runs validateSopInputs / validateDraftAgainstSop in
 *     SHADOW MODE only and persists results into task_runs.meta.sop.
 *
 * The four minimum acceptance checks called out in the spec
 * (`has_company_overview`, `has_key_priorities`, `has_risks_or_gaps`,
 * `has_recommended_angles`) are ALWAYS appended to `requiredOutputs` so
 * the validator has something to look for even when the user has not yet
 * authored a custom SOP. They use the same loose-token matcher already
 * implemented server-side in `sopValidator.ts`.
 *
 * Returns `null` when the engine is off OR the Account Research task SOP
 * is disabled — i.e. the orchestrator's "absence == no-op" path runs.
 */
import { getStrategyConfig } from './strategyConfig';

/** Server-shape mirror of `SopContractLike` — bullet arrays per heading. */
export interface AccountResearchSopAttachment {
  enabled: boolean;
  nonNegotiables: string[];
  requiredInputs: string[];
  requiredOutputs: string[];
  researchWorkflow: string[];
  mandatoryChecks: string[];
  metricsProtocol: string[];
  pageOneCockpitRules: string[];
  formattingRules: string[];
  buildOrder: string[];
  qaChecklist: string[];
}

/**
 * Minimum acceptance checks for Account Research. These map onto the
 * `validateDraftAgainstSop` loose-token matcher — each phrase is broken
 * into >=3-char tokens and matched against the assembled draft text +
 * section names.
 *
 * Keep these stable; the server logs them under
 * `[sop-output-check].required_outputs_missing`.
 */
const ACCOUNT_RESEARCH_REQUIRED_OUTPUT_CHECKS: ReadonlyArray<string> = [
  'company overview',
  'key priorities',
  'risks or gaps',
  'recommended angles',
];

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

/**
 * Project the universal `tasks.account_research` SOP contract into the
 * server-shaped attachment. Returns null when nothing should be attached.
 */
export function buildAccountResearchSopAttachment(): AccountResearchSopAttachment | null {
  let cfg;
  try {
    cfg = getStrategyConfig();
  } catch {
    return null;
  }
  if (!cfg.enabled) return null;

  const contract = cfg.sopContracts.tasks.account_research;
  if (!contract || !contract.enabled) return null;

  const sections = (contract.parsedSections ?? {}) as Record<string, unknown>;

  // Always merge in the minimum acceptance checks so the validator has
  // something to look for even when the user has not yet authored
  // requiredOutputs in their SOP text.
  const userRequiredOutputs = asStringArray(sections.requiredOutputs);
  const requiredOutputs = Array.from(
    new Set([...userRequiredOutputs, ...ACCOUNT_RESEARCH_REQUIRED_OUTPUT_CHECKS]),
  );

  return {
    enabled: true,
    nonNegotiables: asStringArray(sections.nonNegotiables),
    requiredInputs: asStringArray(sections.requiredInputs),
    requiredOutputs,
    researchWorkflow: asStringArray(sections.researchWorkflow),
    mandatoryChecks: asStringArray(sections.mandatoryChecks),
    metricsProtocol: asStringArray(sections.metricsProtocol),
    pageOneCockpitRules: asStringArray(sections.pageOneCockpitRules),
    formattingRules: asStringArray(sections.formattingRules),
    buildOrder: asStringArray(sections.buildOrder),
    qaChecklist: asStringArray(sections.qaChecklist),
  };
}

/** Exposed for tests / debugging. */
export const ACCOUNT_RESEARCH_REQUIRED_CHECKS = ACCOUNT_RESEARCH_REQUIRED_OUTPUT_CHECKS;
