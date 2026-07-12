/**
 * Shared strong-synthesis marker authority.
 *
 * The live semantic prompt tail renders these exact phrases and the telemetry
 * sentinel verifies the same phrases. Keeping both consumers on this module
 * prevents a dormant prompt builder from becoming a second contract.
 */

export const SYNTHESIS_CONTRACT_PHRASES = {
  povFirstOpener: "OPEN WITH POV",
  unequalWeighting: "UNEQUAL WEIGHTING",
  literalCitations: "CITE LITERAL TITLES INLINE",
  whatIsOverrated: "WHAT'S OVERRATED",
  commercialConsequence: "COMMERCIAL CONSEQUENCE",
  executableNextMoves: "EXECUTABLE NEXT MOVES",
} as const;

const SYNTHESIS_NON_NEGOTIABLES = [
  {
    key: "pov_first_opener",
    phrase: SYNTHESIS_CONTRACT_PHRASES.povFirstOpener,
  },
  {
    key: "unequal_weighting",
    phrase: SYNTHESIS_CONTRACT_PHRASES.unequalWeighting,
  },
  {
    key: "literal_citations",
    phrase: SYNTHESIS_CONTRACT_PHRASES.literalCitations,
  },
  {
    key: "what_is_overrated",
    phrase: SYNTHESIS_CONTRACT_PHRASES.whatIsOverrated,
  },
  {
    key: "commercial_consequence",
    phrase: SYNTHESIS_CONTRACT_PHRASES.commercialConsequence,
  },
  {
    key: "executable_next_moves",
    phrase: SYNTHESIS_CONTRACT_PHRASES.executableNextMoves,
  },
] as const;

/** Telemetry-only drift check; never mutates, blocks, or regenerates output. */
export function assertSynthesisContractIntact(
  systemPrompt: string,
): { intact: boolean; missing: string[] } {
  const prompt = systemPrompt || "";
  const missing = SYNTHESIS_NON_NEGOTIABLES
    .filter(({ phrase }) => !prompt.toLocaleUpperCase().includes(phrase))
    .map(({ key }) => key);
  return { intact: missing.length === 0, missing };
}
