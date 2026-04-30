/**
 * Sales Lexicon — UI/debug mirror of the SERVER-AUTHORITATIVE lexicon.
 *
 * The SERVER (`the server salesLexicon module`)
 * is the source of truth. This file MUST be kept structurally identical
 * for cross-runtime hash parity in tests and for the Strategy Control
 * Panel debug view. Do not diverge.
 */

export const LEXICON_VERSION = "1";

export interface LexiconEntry {
  trigger: string;
  expansions: ReadonlyArray<string>;
  rule: string;
}

export const SALES_LEXICON: ReadonlyArray<LexiconEntry> = Object.freeze([
  { trigger: "consolidation", expansions: ["change management", "business case", "discovery"], rule: "consolidation→change" },
  { trigger: "consolidate",   expansions: ["change management", "business case"],               rule: "consolidate→change" },
  { trigger: "migration",     expansions: ["change management", "risk", "business case"],       rule: "migration→change" },
  { trigger: "migrate",       expansions: ["change management", "risk"],                        rule: "migrate→change" },
  { trigger: "replatform",    expansions: ["change management", "evaluation criteria"],         rule: "replatform→evaluation" },
  { trigger: "transformation",expansions: ["change management", "executive sponsor"],           rule: "transformation→sponsor" },
  { trigger: "platform",      expansions: ["technical fit", "evaluation criteria"],             rule: "platform→fit" },
  { trigger: "tooling",       expansions: ["technical fit", "evaluation criteria"],             rule: "tooling→fit" },
  { trigger: "stack",         expansions: ["technical fit", "integration"],                     rule: "stack→fit" },
  { trigger: "integration",   expansions: ["technical fit", "implementation"],                  rule: "integration→fit" },
  { trigger: "experience",    expansions: ["value proposition", "outcomes"],                    rule: "experience→value" },
  { trigger: "guest",         expansions: ["end user", "customer outcomes"],                    rule: "guest→customer" },
  { trigger: "customer",      expansions: ["value proposition", "outcomes"],                    rule: "customer→value" },
  { trigger: "renewal",       expansions: ["value realization", "expansion", "commercial"],     rule: "renewal→value" },
  { trigger: "renew",         expansions: ["value realization", "commercial"],                  rule: "renew→value" },
  { trigger: "expansion",     expansions: ["land and expand", "value realization"],             rule: "expansion→land" },
  { trigger: "upsell",        expansions: ["expansion", "value realization"],                   rule: "upsell→expand" },
  { trigger: "pricing",       expansions: ["commercial", "negotiation"],                        rule: "pricing→commercial" },
  { trigger: "problem",       expansions: ["discovery", "pain", "POV"],                         rule: "problem→discovery" },
  { trigger: "pain",          expansions: ["discovery", "POV"],                                 rule: "pain→discovery" },
  { trigger: "evaluation",    expansions: ["evaluation criteria", "decision process"],          rule: "evaluation→criteria" },
  { trigger: "general manager",expansions: ["decision maker", "economic buyer"],                rule: "gm→economic_buyer" },
  { trigger: "vp ",           expansions: ["decision maker", "economic buyer"],                 rule: "vp→economic_buyer" },
  { trigger: "chief ",        expansions: ["executive sponsor", "economic buyer"],              rule: "c-suite→sponsor" },
  { trigger: "cio",           expansions: ["technical buyer", "decision maker"],                rule: "cio→technical_buyer" },
  { trigger: "cto",           expansions: ["technical buyer", "decision maker"],                rule: "cto→technical_buyer" },
  { trigger: "director",      expansions: ["decision maker"],                                   rule: "director→dm" },
  { trigger: "manager",       expansions: ["champion", "user buyer"],                           rule: "manager→champion" },
  { trigger: "discovery",     expansions: ["pain", "POV", "qualification"],                     rule: "discovery→pain" },
  { trigger: "qualification", expansions: ["MEDDICC", "champion", "criteria"],                  rule: "qual→MEDDICC" },
  { trigger: "negotiation",   expansions: ["commercial", "close plan"],                         rule: "negotiation→close" },
]);

function tokenContains(haystackLower: string, needleLower: string): boolean {
  if (!needleLower) return false;
  let from = 0;
  while (true) {
    const idx = haystackLower.indexOf(needleLower, from);
    if (idx < 0) return false;
    const before = idx === 0 ? "" : haystackLower[idx - 1];
    const afterIdx = idx + needleLower.length;
    const after = afterIdx >= haystackLower.length ? "" : haystackLower[afterIdx];
    const beforeOk = !before || !/[a-z0-9]/.test(before);
    const afterOk = !after || !/[a-z0-9]/.test(after);
    if (beforeOk && afterOk) return true;
    from = idx + 1;
  }
}

export interface LexiconMatch {
  expansion: string;
  rule: string;
  fromInput: string;
}

export function matchLexicon(rawSeed: string): LexiconMatch[] {
  const out: LexiconMatch[] = [];
  if (typeof rawSeed !== 'string' || !rawSeed.trim()) return out;
  const hay = rawSeed.toLowerCase();
  const seen = new Set<string>();
  for (const entry of SALES_LEXICON) {
    if (!tokenContains(hay, entry.trigger)) continue;
    for (const exp of entry.expansions) {
      const key = exp.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ expansion: exp, rule: entry.rule, fromInput: rawSeed });
    }
  }
  return out;
}

export const __test__ = { tokenContains };
