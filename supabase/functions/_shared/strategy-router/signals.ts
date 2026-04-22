// ════════════════════════════════════════════════════════════════
// Strategy Router — pure signal extraction.
// No I/O. Caller injects library_precheck_count if used.
// ════════════════════════════════════════════════════════════════

export type DeepIntentType = "account_brief" | "ninety_day_plan";

export interface RouterSignals {
  deep_intent: boolean;
  deep_intent_type: DeepIntentType | null;
  account_attached: boolean;
  opp_attached: boolean;
  length_long: boolean;
  strategic_keywords: boolean;
  is_utility: boolean;
  explicit_task: boolean;
  library_precheck_count: number;
}

export interface SignalInput {
  message: string;
  thread: { account_id?: string | null; opportunity_id?: string | null } | null;
  explicit_task_type?: string | null;
  library_precheck_count?: number;
}

const ACCOUNT_BRIEF_PATTERNS: RegExp[] = [
  /\baccount\s+brief\b/i,
  /\bbrief\s+(me\s+)?on\s+(this\s+|the\s+)?account\b/i,
  /\bbrief\s+(me\s+)?on\s+[A-Z][\w&.\- ]{1,40}\b/,
  /\btell\s+me\s+about\s+(this|the)\s+account\b/i,
  /\bwalk\s+me\s+through\s+(this|the)\s+account\b/i,
];

const NINETY_DAY_PATTERNS: RegExp[] = [
  /\b90[\s\-]?day\s+plan\b/i,
  /\bninety[\s\-]?day\s+plan\b/i,
  /\b30[\s\-/]60[\s\-/]90\b/,
  /\bfirst\s+90\s+days\b/i,
];

const STRATEGIC_KEYWORDS_RE = /\b(plan|strategy|brief|prep|approach|playbook|game\s*plan)\b/i;

const UTILITY_PATTERNS: RegExp[] = [
  /^\s*(what|when|where|who|how\s+do\s+i|define|explain|format|convert|list)\b/i,
  /\?\s*$/,
];

function detectDeepIntent(message: string, explicitTaskType: string | null | undefined): {
  deep_intent: boolean;
  deep_intent_type: DeepIntentType | null;
} {
  if (explicitTaskType === "account_brief" || explicitTaskType === "ninety_day_plan") {
    return { deep_intent: true, deep_intent_type: explicitTaskType };
  }
  for (const re of ACCOUNT_BRIEF_PATTERNS) {
    if (re.test(message)) return { deep_intent: true, deep_intent_type: "account_brief" };
  }
  for (const re of NINETY_DAY_PATTERNS) {
    if (re.test(message)) return { deep_intent: true, deep_intent_type: "ninety_day_plan" };
  }
  return { deep_intent: false, deep_intent_type: null };
}

function isUtility(message: string): boolean {
  const trimmed = (message || "").trim();
  if (!trimmed) return false;
  if (trimmed.length > 240) return false;
  // Short + factual/lookup-shaped + no strategic keywords.
  if (STRATEGIC_KEYWORDS_RE.test(trimmed)) return false;
  return UTILITY_PATTERNS.some((re) => re.test(trimmed));
}

export function extractSignals(input: SignalInput): RouterSignals {
  const message = typeof input.message === "string" ? input.message : "";
  const thread = input.thread || null;
  const explicit = input.explicit_task_type ?? null;

  const { deep_intent, deep_intent_type } = detectDeepIntent(message, explicit);

  const account_attached = !!(thread && thread.account_id);
  const opp_attached = !!(thread && thread.opportunity_id);
  const length_long = message.length > 400;
  const strategic_keywords = STRATEGIC_KEYWORDS_RE.test(message);
  const is_util = isUtility(message);
  const explicit_task = explicit === "account_brief" || explicit === "ninety_day_plan";
  const library_precheck_count = Math.max(
    0,
    Number.isFinite(input.library_precheck_count) ? Number(input.library_precheck_count) : 0,
  );

  return {
    deep_intent,
    deep_intent_type,
    account_attached,
    opp_attached,
    length_long,
    strategic_keywords,
    is_utility: is_util,
    explicit_task,
    library_precheck_count,
  };
}
