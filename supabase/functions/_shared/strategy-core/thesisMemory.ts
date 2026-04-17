// ════════════════════════════════════════════════════════════════
// Strategy Core — Working Thesis Memory
//
// Persists a single, structured "working thesis state" per account so
// Strategy chat stops having same-day amnesia. The state lives in the
// existing `account_strategy_memory` table as one row per
// (user_id, account_id) with memory_type='working_thesis'. The full
// state is JSON-serialized into the existing `content` text column —
// NO schema change required.
//
// Tiny by design. Three functions only:
//   • loadWorkingThesisState   — rehydrate
//   • saveWorkingThesisState   — upsert (one row per account)
//   • mergeWorkingThesisState  — pure, deterministic state evolution
//
// Behavior contract for callers:
//   • Seller-provided evidence overrides model pattern-matching.
//   • If the seller invalidates a prior thesis, mark it dead (do not
//     silently replace).
//   • Killed hypotheses stay dead unless explicitly revived.
// ════════════════════════════════════════════════════════════════

export type ThesisConfidence = "VALID" | "INFER" | "HYPO" | "UNKN";

export interface KilledHypothesis {
  hypothesis: string;
  killed_by: string;
  killed_at: string;
}

export interface WorkingThesisState {
  account_id: string;
  thread_id?: string | null;
  current_thesis: string;
  current_leakage: string;
  confidence: ThesisConfidence;
  supporting_evidence: string[];
  killed_hypotheses: KilledHypothesis[];
  open_questions: string[];
  last_updated_at: string;
}

const MEMORY_TYPE = "working_thesis";

// ──────────────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────────────
export function emptyWorkingThesisState(
  accountId: string,
  threadId?: string | null,
): WorkingThesisState {
  return {
    account_id: accountId,
    thread_id: threadId ?? null,
    current_thesis: "",
    current_leakage: "",
    confidence: "UNKN",
    supporting_evidence: [],
    killed_hypotheses: [],
    open_questions: [],
    last_updated_at: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────────
// Load
// ──────────────────────────────────────────────────────────────────
export async function loadWorkingThesisState(
  supabase: any,
  args: { userId: string; accountId: string },
): Promise<WorkingThesisState | null> {
  if (!args.accountId || !args.userId) return null;
  const { data, error } = await supabase
    .from("account_strategy_memory")
    .select("id, content, updated_at")
    .eq("user_id", args.userId)
    .eq("account_id", args.accountId)
    .eq("memory_type", MEMORY_TYPE)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.content) return null;
  try {
    const parsed = JSON.parse(data.content) as WorkingThesisState;
    if (!parsed || typeof parsed !== "object" || !parsed.account_id) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────
// Save (upsert one row per account)
// ──────────────────────────────────────────────────────────────────
export async function saveWorkingThesisState(
  supabase: any,
  args: { userId: string; state: WorkingThesisState },
): Promise<void> {
  const { userId, state } = args;
  if (!state?.account_id || !userId) return;
  const stamped: WorkingThesisState = {
    ...state,
    last_updated_at: new Date().toISOString(),
  };
  const content = JSON.stringify(stamped);

  // Find existing row to keep one-per-account.
  const { data: existing } = await supabase
    .from("account_strategy_memory")
    .select("id")
    .eq("user_id", userId)
    .eq("account_id", state.account_id)
    .eq("memory_type", MEMORY_TYPE)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("account_strategy_memory")
      .update({
        content,
        source_thread_id: state.thread_id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("account_strategy_memory").insert({
      user_id: userId,
      account_id: state.account_id,
      memory_type: MEMORY_TYPE,
      content,
      source_thread_id: state.thread_id ?? null,
    });
  }
}

// ──────────────────────────────────────────────────────────────────
// Merge — pure, deterministic. Used by tests AND by chat post-stream.
//
// Rules:
//   • Patch.current_thesis: if non-empty AND different from prior, the
//     prior thesis becomes a killed hypothesis (kill_reason required).
//   • Patch.killed_hypotheses: appended; dedup by hypothesis text.
//   • supporting_evidence + open_questions: appended; dedup; trimmed.
//   • Killed hypotheses cannot be revived implicitly — caller must drop
//     them from killed_hypotheses AND set them as current_thesis.
//   • last_updated_at always refreshed.
// ──────────────────────────────────────────────────────────────────
export interface ThesisStatePatch {
  current_thesis?: string;
  current_leakage?: string;
  confidence?: ThesisConfidence;
  /** Evidence to add. Each entry is a short factual statement. */
  add_evidence?: string[];
  /** Hypotheses to mark dead. killed_by = the seller statement / event that killed it. */
  kill_hypotheses?: Array<{ hypothesis: string; killed_by: string }>;
  /** Open questions to add. */
  add_open_questions?: string[];
  /** Open questions to remove (e.g., answered). */
  resolve_open_questions?: string[];
  /**
   * Reason the prior current_thesis is being replaced. Required when
   * current_thesis changes from a non-empty value — otherwise the old
   * thesis vanishes silently, which is exactly the bug we're fixing.
   */
  thesis_change_reason?: string;
  thread_id?: string | null;
  /**
   * Set true ONLY when this patch is grounded in seller-provided
   * evidence on the live conversation, retrieved library/source
   * material, or transcript content. Required to promote confidence
   * to VALID. Defaults to false. The chat layer infers this from the
   * model's emitted patch — the model is instructed to set it true
   * only when citing the seller / a transcript / a retrieved KI.
   */
  seller_confirmed?: boolean;
  /**
   * Required when current_thesis matches a previously killed
   * hypothesis. Without this, the validator drops the thesis change
   * to prevent silent zombie revival.
   */
  revive_hypothesis_reason?: string;
}

// ──────────────────────────────────────────────────────────────────
// Validation — the trust boundary.
//
// Saved thesis state must be MORE disciplined than the model, not
// less. The validator never throws — it returns a sanitized patch
// plus a list of human-readable downgrades so callers can log them.
//
// Rules enforced:
//   1. Patch.confidence cannot be promoted to VALID by model
//      pattern-matching alone. Requires seller_confirmed === true OR
//      add_evidence with at least one entry OR prior state already
//      has supporting evidence carrying through.
//   2. Numeric claims (%, $, "X points", "Nx") in current_thesis or
//      current_leakage cap confidence at INFER unless evidence is
//      provided (seller_confirmed or add_evidence with a numeric).
//   3. Empty / whitespace-only current_thesis cannot overwrite a
//      non-empty prior thesis.
//   4. current_thesis matching a previously killed hypothesis is
//      dropped unless revive_hypothesis_reason is present and
//      seller_confirmed is true.
// ──────────────────────────────────────────────────────────────────
const NUMERIC_CLAIM_RE = /(\$\s?\d|\d+\s?%|\b\d+(\.\d+)?\s?(points?|x|bps|basis points|million|billion|m|bn|k|years?|months?|days?)\b)/i;

function hasNumericClaim(s: string | undefined | null): boolean {
  if (!s) return false;
  return NUMERIC_CLAIM_RE.test(s);
}

function normalizeForCompare(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface ValidationResult {
  patch: ThesisStatePatch;
  downgrades: string[];
}

export function validateWorkingThesisState(
  prior: WorkingThesisState | null,
  patchIn: ThesisStatePatch,
): ValidationResult {
  const patch: ThesisStatePatch = { ...patchIn };
  const downgrades: string[] = [];

  // Rule 3: empty thesis cannot overwrite a good thesis.
  if (
    typeof patch.current_thesis === "string" &&
    !patch.current_thesis.trim() &&
    prior?.current_thesis?.trim()
  ) {
    downgrades.push(
      "Empty current_thesis ignored — refusing to overwrite a non-empty prior thesis.",
    );
    delete patch.current_thesis;
    delete patch.thesis_change_reason;
  }

  // Rule 4: zombie revival of killed hypothesis without explicit reason.
  if (
    typeof patch.current_thesis === "string" &&
    patch.current_thesis.trim() &&
    prior?.killed_hypotheses?.length
  ) {
    const candidate = normalizeForCompare(patch.current_thesis);
    const isZombie = prior.killed_hypotheses.some(
      (k) => normalizeForCompare(k.hypothesis) === candidate,
    );
    if (isZombie) {
      const hasReason = !!patch.revive_hypothesis_reason?.trim();
      if (!hasReason || patch.seller_confirmed !== true) {
        downgrades.push(
          `Refused to revive killed hypothesis "${patch.current_thesis.trim()}" — needs revive_hypothesis_reason + seller_confirmed.`,
        );
        delete patch.current_thesis;
        delete patch.thesis_change_reason;
      }
    }
  }

  // Rule 1: VALID requires real grounding.
  if (patch.confidence === "VALID") {
    const hasNewEvidence = (patch.add_evidence ?? []).some((e) =>
      (e ?? "").trim().length > 0
    );
    const carriedEvidence = (prior?.supporting_evidence ?? []).length > 0;
    const sellerConfirmed = patch.seller_confirmed === true;
    if (!sellerConfirmed && !hasNewEvidence && !carriedEvidence) {
      downgrades.push(
        "Confidence VALID downgraded to INFER — no seller-confirmed evidence, no new add_evidence, no carried supporting_evidence.",
      );
      patch.confidence = "INFER";
    }
  }

  // Rule 2: numeric claims in thesis/leakage cap confidence at INFER
  // unless the patch itself is seller_confirmed OR carries numeric
  // evidence (a number-bearing add_evidence entry).
  const thesisHasNumeric = hasNumericClaim(patch.current_thesis) ||
    (patch.current_thesis === undefined &&
      hasNumericClaim(prior?.current_thesis));
  const leakageHasNumeric = hasNumericClaim(patch.current_leakage) ||
    (patch.current_leakage === undefined &&
      hasNumericClaim(prior?.current_leakage));
  const numericInEvidence = (patch.add_evidence ?? []).some(hasNumericClaim) ||
    (prior?.supporting_evidence ?? []).some(hasNumericClaim);
  const targetConfidence = patch.confidence ?? prior?.confidence ?? "UNKN";

  if (
    (thesisHasNumeric || leakageHasNumeric) &&
    targetConfidence === "VALID" &&
    !patch.seller_confirmed &&
    !numericInEvidence
  ) {
    downgrades.push(
      "Numeric claim present without numeric evidence — confidence capped at INFER.",
    );
    patch.confidence = "INFER";
  }

  return { patch, downgrades };
}

function dedupTrim(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = (v ?? "").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function mergeWorkingThesisState(
  prior: WorkingThesisState,
  patch: ThesisStatePatch,
): WorkingThesisState {
  const next: WorkingThesisState = {
    ...prior,
    killed_hypotheses: [...prior.killed_hypotheses],
    supporting_evidence: [...prior.supporting_evidence],
    open_questions: [...prior.open_questions],
  };

  // Thesis change → silently kill the prior thesis as a hypothesis.
  if (
    typeof patch.current_thesis === "string" &&
    patch.current_thesis.trim() &&
    patch.current_thesis.trim() !== prior.current_thesis.trim()
  ) {
    if (prior.current_thesis.trim()) {
      next.killed_hypotheses.push({
        hypothesis: prior.current_thesis.trim(),
        killed_by: (patch.thesis_change_reason ?? "superseded by new evidence")
          .trim(),
        killed_at: new Date().toISOString(),
      });
    }
    next.current_thesis = patch.current_thesis.trim();
  }

  if (typeof patch.current_leakage === "string") {
    next.current_leakage = patch.current_leakage.trim();
  }
  if (patch.confidence) next.confidence = patch.confidence;

  if (patch.kill_hypotheses?.length) {
    for (const k of patch.kill_hypotheses) {
      const h = (k.hypothesis ?? "").trim();
      if (!h) continue;
      // Dedup by hypothesis text (case-insensitive).
      if (
        next.killed_hypotheses.some(
          (x) => x.hypothesis.toLowerCase() === h.toLowerCase(),
        )
      ) continue;
      next.killed_hypotheses.push({
        hypothesis: h,
        killed_by: (k.killed_by ?? "seller correction").trim(),
        killed_at: new Date().toISOString(),
      });
    }
  }

  if (patch.add_evidence?.length) {
    next.supporting_evidence = dedupTrim([
      ...next.supporting_evidence,
      ...patch.add_evidence,
    ]);
  }

  if (patch.add_open_questions?.length) {
    next.open_questions = dedupTrim([
      ...next.open_questions,
      ...patch.add_open_questions,
    ]);
  }
  if (patch.resolve_open_questions?.length) {
    const resolved = new Set(
      patch.resolve_open_questions.map((q) => q.trim().toLowerCase()),
    );
    next.open_questions = next.open_questions.filter(
      (q) => !resolved.has(q.toLowerCase()),
    );
  }

  if (patch.thread_id !== undefined) next.thread_id = patch.thread_id;
  next.last_updated_at = new Date().toISOString();
  return next;
}

// ──────────────────────────────────────────────────────────────────
// Prompt rendering — the block that gets injected into the system
// prompt under "=== CURRENT WORKING THESIS STATE ===".
// ──────────────────────────────────────────────────────────────────
export function renderWorkingThesisStateBlock(
  state: WorkingThesisState | null,
): string {
  if (!state) return "";
  const hasAny =
    state.current_thesis ||
    state.current_leakage ||
    state.killed_hypotheses.length ||
    state.open_questions.length ||
    state.supporting_evidence.length;
  if (!hasAny) return "";

  const lines: string[] = [];
  lines.push("=== CURRENT WORKING THESIS STATE ===");
  lines.push(
    "This is the running thesis you and the seller built across prior conversations on this account. Treat it as the live operating model. Do NOT silently restart. Do NOT re-litigate killed hypotheses unless the seller introduces NEW evidence that revives them.",
  );
  if (state.current_thesis) {
    lines.push(
      `CURRENT THESIS (${state.confidence}): ${state.current_thesis}`,
    );
  }
  if (state.current_leakage) {
    lines.push(`CURRENT LEAKAGE: ${state.current_leakage}`);
  }
  if (state.supporting_evidence.length) {
    lines.push("SUPPORTING EVIDENCE (validated):");
    for (const e of state.supporting_evidence) lines.push(`  - ${e}`);
  }
  if (state.killed_hypotheses.length) {
    lines.push(
      "DEAD HYPOTHESES (do not revive without new evidence — name them as dead if relevant):",
    );
    for (const k of state.killed_hypotheses) {
      lines.push(`  - "${k.hypothesis}" — killed by: ${k.killed_by}`);
    }
  }
  if (state.open_questions.length) {
    lines.push("OPEN QUESTIONS (still unresolved):");
    for (const q of state.open_questions) lines.push(`  - ${q}`);
  }
  lines.push(
    "BEHAVIOR: When the seller adds new evidence, explicitly state whether it CONFIRMS, WEAKENS, or KILLS the current thesis — then give the updated thesis. Do not act like this is a fresh conversation.",
  );
  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────
// Fallback extractor — deterministic, prose-only.
//
// Runs ONLY when the model forgot to emit the fenced ```thesis_update
// block. Reads the assistant's visible answer text and infers a
// minimal patch from explicit signal phrases. No LLM call. No
// guessing. If the prose is ambiguous, returns null and we save
// nothing — saving nothing is better than saving weak state.
//
// Detected signals (case-insensitive):
//   • Thesis declarations:
//       "current thesis: X" / "revised thesis: X" / "working thesis: X"
//       "the (real|new|updated) thesis is X"
//   • Killed hypotheses:
//       "throw out X" / "kill the X (thesis|hypothesis)"
//       "X is dead" / "that hypothesis is dead"
//       "this kills the X (thesis|hypothesis)"
//   • Open questions:
//       "open question: X" / "we still need to know X"
//   • Seller-confirmed evidence:
//       "seller said X" / "VP confirmed X" / "confirmed by seller: X"
//       "the (VP|CFO|CRO|champion|buyer) (said|told us|confirmed) X"
//   • Confidence words: "valid" / "infer" / "hypo(thesis)" / "unknown"
//
// The returned patch goes through validateWorkingThesisState exactly
// like a fenced patch — so all trust rules still apply.
// ──────────────────────────────────────────────────────────────────

const THESIS_DECLARATION_PATTERNS: RegExp[] = [
  /(?:^|\n)\s*(?:current|revised|updated|new|working|real)\s+thesis\s*[:\-—]\s*(.+?)(?:\n|$)/i,
  /(?:^|\n)\s*thesis\s*[:\-—]\s*(.+?)(?:\n|$)/i,
  /\bthe\s+(?:real|new|updated|revised)\s+thesis\s+is\s+(?:that\s+)?(.+?)(?:[.!?\n]|$)/i,
];

const KILL_PATTERNS: RegExp[] = [
  /\bthrow(?:ing)?\s+out\s+(?:the\s+)?(.+?)\s+(?:thesis|hypothesis|theory|story|idea)\b/i,
  /\bkill(?:s|ed|ing)?\s+(?:the\s+)?(.+?)\s+(?:thesis|hypothesis|theory)\b/i,
  /\bthis\s+kills\s+(?:the\s+)?(.+?)(?:[.!?\n]|$)/i,
  /\b(?:that\s+|the\s+)?(.+?)\s+(?:thesis|hypothesis|theory|story)\s+is\s+dead\b/i,
  /\bdrop(?:ping)?\s+(?:the\s+)?(.+?)\s+(?:thesis|hypothesis|theory)\b/i,
];

const OPEN_QUESTION_PATTERNS: RegExp[] = [
  /(?:^|\n)\s*open\s+question\s*[:\-—]\s*(.+?)(?:\n|$)/i,
  /\bwe\s+still\s+(?:need\s+to\s+know|don'?t\s+know)\s+(.+?)(?:[.!?\n]|$)/i,
  /\bstill\s+unresolved\s*[:\-—]\s*(.+?)(?:\n|$)/i,
];

const SELLER_EVIDENCE_PATTERNS: RegExp[] = [
  /\b(?:the\s+)?(?:VP|CFO|CRO|CEO|COO|CTO|champion|buyer|seller|prospect)\s+(?:said|told\s+us|confirmed|stated|mentioned)\s+(?:that\s+)?(.+?)(?:[.!?\n]|$)/i,
  /\bconfirmed\s+by\s+(?:the\s+)?(?:seller|VP|CFO|CRO|champion|buyer)\s*[:\-—]?\s*(.+?)(?:[.!?\n]|$)/i,
  /\bseller\s+(?:just\s+)?confirmed\s+(?:that\s+)?(.+?)(?:[.!?\n]|$)/i,
  /\bon\s+the\s+call\s+the\s+(?:VP|CFO|CRO|champion|buyer)\s+(?:said|confirmed)\s+(?:that\s+)?(.+?)(?:[.!?\n]|$)/i,
];

const CONFIDENCE_WORD_RE =
  /\b(?:confidence\s*[:=]\s*)?(VALID|INFER|HYPO|HYPOTHESIS|UNKN|UNKNOWN)\b/i;

function cleanCapture(s: string | undefined): string {
  if (!s) return "";
  let out = s.trim();
  // Strip surrounding quotes/markdown emphasis.
  out = out.replace(/^[\s"'`*_]+|[\s"'`*_.,;:]+$/g, "");
  return out;
}

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) {
      const cleaned = cleanCapture(m[1]);
      if (cleaned.length >= 4 && cleaned.length <= 280) return cleaned;
    }
  }
  return "";
}

function allMatches(text: string, patterns: RegExp[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const re of patterns) {
    // Re-run with global flag for sweep.
    const gre = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = gre.exec(text)) !== null) {
      const cleaned = cleanCapture(m[1]);
      if (cleaned.length < 4 || cleaned.length > 280) continue;
      const k = cleaned.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(cleaned);
      if (out.length >= 5) return out;
    }
  }
  return out;
}

function inferConfidence(text: string): ThesisConfidence | undefined {
  const m = text.match(CONFIDENCE_WORD_RE);
  if (!m) return undefined;
  const raw = m[1].toUpperCase();
  if (raw === "VALID") return "VALID";
  if (raw === "INFER") return "INFER";
  if (raw === "HYPO" || raw === "HYPOTHESIS") return "HYPO";
  if (raw === "UNKN" || raw === "UNKNOWN") return "UNKN";
  return undefined;
}

/**
 * Deterministically infer a thesis patch from the assistant's visible
 * prose. Returns null when the prose is too ambiguous to safely persist.
 *
 * The caller MUST still pass the result through validateWorkingThesisState
 * before merging — fallback inference does not bypass the trust boundary.
 */
export function extractThesisPatchFromProse(
  text: string,
): ThesisStatePatch | null {
  if (!text || typeof text !== "string") return null;
  const body = text.trim();
  if (body.length < 30) return null;

  const thesis = firstMatch(body, THESIS_DECLARATION_PATTERNS);
  const killedTargets = allMatches(body, KILL_PATTERNS);
  const openQs = allMatches(body, OPEN_QUESTION_PATTERNS);
  const sellerFacts = allMatches(body, SELLER_EVIDENCE_PATTERNS);

  // Ambiguity guard: nothing structural to lean on → save nothing.
  if (!thesis && killedTargets.length === 0 && sellerFacts.length === 0) {
    return null;
  }

  const patch: ThesisStatePatch = {};

  if (thesis) {
    patch.current_thesis = thesis;
    // thesis_change_reason: prefer a seller fact, else generic.
    patch.thesis_change_reason = sellerFacts[0]
      ? `Inferred from assistant prose; grounded in: ${sellerFacts[0]}`
      : "Inferred from assistant prose (fallback extractor)";
  }

  if (killedTargets.length) {
    patch.kill_hypotheses = killedTargets.map((h) => ({
      hypothesis: h,
      killed_by: sellerFacts[0]
        ? `Seller evidence: ${sellerFacts[0]}`
        : "Assistant marked dead in prose (fallback extractor)",
    }));
  }

  if (openQs.length) patch.add_open_questions = openQs;

  if (sellerFacts.length) {
    patch.add_evidence = sellerFacts;
    patch.seller_confirmed = true;
  }

  // Confidence: only carry through if the model explicitly named it AND
  // we have grounding for VALID. Otherwise leave undefined and let the
  // validator apply defaults.
  const conf = inferConfidence(body);
  if (conf) patch.confidence = conf;

  // Final ambiguity guard: an empty patch is not worth persisting.
  const hasAnything =
    !!patch.current_thesis ||
    (patch.kill_hypotheses?.length ?? 0) > 0 ||
    (patch.add_evidence?.length ?? 0) > 0 ||
    (patch.add_open_questions?.length ?? 0) > 0;
  if (!hasAnything) return null;

  return patch;
}
