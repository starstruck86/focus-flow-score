/**
 * Retrieval Expansion Layer — UI/debug MIRROR.
 *
 * Source of truth lives at
 * `the server expansion module`. This file
 * exists so the Strategy Control Panel and frontend tests can simulate
 * the server's planning output WITHOUT calling the edge function. The
 * server NEVER trusts this output — it rebuilds the plan itself.
 */
import type { PlannerContext } from './contextTypes';
import { LEXICON_VERSION, matchLexicon, type LexiconMatch } from './salesLexicon';

export const EXPANSION_MAX = 8;

const STOP_LIST: ReadonlySet<string> = new Set([
  'call', 'meeting', 'deal', 'customer', 'prospect', 'account', 'thing', 'stuff',
]);

export type ExpansionSource = 'lexicon' | 'context_anchor' | 'persona_role';

export interface ExpansionTraceEntry {
  term: string;
  source: ExpansionSource;
  rule: string;
  fromInput?: string;
  lexiconVersion: string;
}

export interface ExpansionResult {
  expandedSeeds: ReadonlyArray<string>;
  expansionTrace: ReadonlyArray<ExpansionTraceEntry>;
  lexiconVersion: string;
  expansionEnabled: boolean;
}

export interface ExpansionFlags {
  enabled: boolean;
}

function pushUnique(
  out: string[],
  trace: ExpansionTraceEntry[],
  candidate: string,
  source: ExpansionSource,
  rule: string,
  fromInput: string | undefined,
  seen: Set<string>,
): boolean {
  const term = String(candidate ?? '').trim();
  if (!term) return false;
  const key = term.toLowerCase();
  if (seen.has(key)) return false;
  if (STOP_LIST.has(key)) return false;
  seen.add(key);
  out.push(term);
  trace.push({ term, source, rule, fromInput, lexiconVersion: LEXICON_VERSION });
  return true;
}

export function expandSeeds(
  rawSeeds: ReadonlyArray<string>,
  ctx: PlannerContext,
  flags: ExpansionFlags,
): ExpansionResult {
  if (!flags.enabled) {
    return {
      expandedSeeds: Object.freeze([]),
      expansionTrace: Object.freeze([]),
      lexiconVersion: LEXICON_VERSION,
      expansionEnabled: false,
    };
  }
  const expandedSeeds: string[] = [];
  const expansionTrace: ExpansionTraceEntry[] = [];
  const seen = new Set<string>(rawSeeds.map((s) => String(s).toLowerCase()));

  for (const raw of rawSeeds) {
    if (expandedSeeds.length >= EXPANSION_MAX) break;
    const matches: LexiconMatch[] = matchLexicon(raw);
    for (const m of matches) {
      if (expandedSeeds.length >= EXPANSION_MAX) break;
      pushUnique(expandedSeeds, expansionTrace, m.expansion, 'lexicon', m.rule, m.fromInput, seen);
    }
  }

  if (expandedSeeds.length < EXPANSION_MAX) {
    const oppStage = ctx.thread?.opportunity?.stage;
    if (typeof oppStage === 'string' && oppStage.trim()) {
      pushUnique(expandedSeeds, expansionTrace, oppStage.trim(), 'context_anchor', 'thread.opportunity.stage', oppStage, seen);
    }
  }

  if (expandedSeeds.length < EXPANSION_MAX) {
    const personaTitle = ctx.thread?.persona?.title;
    if (typeof personaTitle === 'string' && personaTitle.trim()) {
      const alreadyRaw = rawSeeds.some((s) => String(s).toLowerCase() === personaTitle.toLowerCase());
      if (!alreadyRaw) {
        const matches = matchLexicon(personaTitle);
        for (const m of matches) {
          if (expandedSeeds.length >= EXPANSION_MAX) break;
          pushUnique(expandedSeeds, expansionTrace, m.expansion, 'persona_role', m.rule, personaTitle, seen);
        }
      }
    }
  }

  return {
    expandedSeeds: Object.freeze([...expandedSeeds]),
    expansionTrace: Object.freeze([...expansionTrace]),
    lexiconVersion: LEXICON_VERSION,
    expansionEnabled: true,
  };
}

export const __test__ = { STOP_LIST };
