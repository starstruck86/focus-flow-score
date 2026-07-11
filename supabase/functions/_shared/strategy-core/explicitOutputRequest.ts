/**
 * High-precision parser for an exact, user-requested output count.
 *
 * A count is authoritative only when it begins the request or follows a
 * request-clause verb. This avoids treating factual mentions such as
 * "we sent 4 messages" as a request for four new outputs.
 */

export type ExplicitOutputCategory = "alternatives" | "artifact";

export interface ExplicitOutputRequest {
  count: number;
  noun: string;
  category: ExplicitOutputCategory;
  requestVerb: string | null;
}

const NUMBER_WORDS: Readonly<Record<string, number>> = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
});

const COUNT_SOURCE = String
  .raw`(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)`;
const NOUN_SOURCE = String
  .raw`((?:[a-z][a-z0-9-]*\s+){0,2}(?:talk[\s-]?tracks|[a-z][a-z0-9-]*s))`;
const AFTER_NOUN = String
  .raw`(?=\s*(?:$|[,.!?;:]|\b(?:and|then|for|about|on|using|based|that|which|with|to|please)\b))`;
const COUNTED_OUTPUT_SOURCE = String
  .raw`(?:exactly\s+)?${COUNT_SOURCE}\s+${NOUN_SOURCE}${AFTER_NOUN}`;

const REQUEST_VERBS = [
  "give",
  "show",
  "send",
  "write",
  "draft",
  "compose",
  "create",
  "generate",
  "produce",
  "return",
  "list",
  "offer",
  "propose",
  "brainstorm",
] as const;
const REQUEST_VERB_SOURCE = `(${REQUEST_VERBS.join("|")})`;
const CLAUSE_START = String.raw`(?:^|[.!?;,]\s*)`;

const DIRECT_RE = new RegExp(
  String.raw`^\s*(?:please\s+)?${COUNTED_OUTPUT_SOURCE}`,
  "i",
);
const ACTION_RE = new RegExp(
  String
    .raw`${CLAUSE_START}(?:(?:please\s+)?(?:can|could|would)\s+you\s+(?:please\s+)?${REQUEST_VERB_SOURCE}|(?:please\s+)?${REQUEST_VERB_SOURCE})(?:\s+me)?\s+${COUNTED_OUTPUT_SOURCE}`,
  "i",
);
const WANT_RE = new RegExp(
  String
    .raw`${CLAUSE_START}(?:i|we)\s+(?:need|want|would\s+like|['’]d\s+like)\s+${COUNTED_OUTPUT_SOURCE}`,
  "i",
);

const ALTERNATIVE_HEADS = new Set([
  "ideas",
  "angles",
  "options",
  "ways",
  "approaches",
  "paths",
  "hooks",
  "openers",
  "questions",
  "entries",
  "recommendations",
  "concepts",
  "variations",
]);

const ARTIFACT_HEADS = new Set([
  "scripts",
  "messages",
  "drafts",
  "versions",
  "emails",
  "notes",
  "voicemails",
  "sequences",
  "plans",
  "briefs",
  "decks",
  "docs",
  "documents",
  "templates",
  "outlines",
  "agendas",
  "summaries",
  "memos",
  "proposals",
  "tracks",
]);

// These are quantities or durations, not requested output objects. Keep this
// list deliberately narrow: unknown plural output nouns remain eligible so an
// explicit "<integer> <plural noun>" request is not constrained by a closed
// vocabulary, while common phrases such as "give me 4 business days" do not
// become an instruction to generate four alternatives.
const NON_OUTPUT_QUANTITY_HEADS = new Set([
  "seconds",
  "minutes",
  "hours",
  "days",
  "weeks",
  "months",
  "quarters",
  "years",
  "dollars",
  "cents",
  "euros",
  "pounds",
  "kilograms",
  "miles",
  "feet",
  "inches",
]);

function parseCount(raw: string): number | null {
  const normalized = raw.toLocaleLowerCase();
  const parsed = /^\d+$/.test(normalized)
    ? Number(normalized)
    : NUMBER_WORDS[normalized];
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 20 ? parsed : null;
}

function normalizeNoun(raw: string): string {
  return raw.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function categoryFor(
  noun: string,
  requestVerb: string | null,
): ExplicitOutputCategory | null {
  const head = noun.replace(/-/g, " ").split(/\s+/).at(-1) || noun;
  if (NON_OUTPUT_QUANTITY_HEADS.has(head)) return null;
  if (ALTERNATIVE_HEADS.has(head)) return "alternatives";
  if (ARTIFACT_HEADS.has(head)) return "artifact";
  if (
    requestVerb &&
    ["send", "write", "draft", "compose", "create", "produce"].includes(
      requestVerb,
    )
  ) return "artifact";
  return "alternatives";
}

function resultFromMatch(
  match: RegExpMatchArray,
  shape: "direct" | "action" | "want",
): ExplicitOutputRequest | null {
  let verb: string | null = null;
  let countRaw: string;
  let nounRaw: string;
  if (shape === "action") {
    // ACTION_RE contains two mutually exclusive request-verb captures.
    verb = (match[1] || match[2] || "").toLocaleLowerCase() || null;
    countRaw = match[3];
    nounRaw = match[4];
  } else {
    countRaw = match[1];
    nounRaw = match[2];
  }
  const count = parseCount(countRaw);
  if (count === null) return null;
  const noun = normalizeNoun(nounRaw);
  const category = categoryFor(noun, verb);
  if (category === null) return null;
  return {
    count,
    noun,
    category,
    requestVerb: verb,
  };
}

export function detectExplicitOutputRequest(
  userContent: string | null | undefined,
): ExplicitOutputRequest | null {
  const text = (userContent || "").trim();
  if (!text) return null;

  const action = text.match(ACTION_RE);
  if (action) return resultFromMatch(action, "action");
  const want = text.match(WANT_RE);
  if (want) return resultFromMatch(want, "want");
  const direct = text.match(DIRECT_RE);
  if (direct) return resultFromMatch(direct, "direct");
  return null;
}

/** Compatibility surface for callers that only need the resolved count. */
export function detectExplicitOutputCount(
  userContent: string | null | undefined,
): number | null {
  return detectExplicitOutputRequest(userContent)?.count ?? null;
}
