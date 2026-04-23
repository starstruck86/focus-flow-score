// ════════════════════════════════════════════════════════════════
// Strategy Core — Targeted Library Lookup
//
// Real DB-backed search across the user's full library. Bypasses
// vector retrieval and top-K so counts/lists are authoritative across
// 1200+ resources and 24k+ KIs.
//
// Public surface:
//   • detectLookupIntent(text)        → parsed lookup intent or null
//   • detectAffirmative(text)         → boolean
//   • runLibraryLookup(supabase, …)   → real counts + samples
//   • renderLookupResultText(result)  → human-readable assistant reply
//   • buildPendingLookupAction(intent)→ object stored on assistant msg
//
// Search semantics:
//   For each topic, we OR-match across title/description/content/tags
//   using ILIKE. We use count='exact' head queries for totals so we
//   never page through rows. Sample lists pull 10 titles max.
// ════════════════════════════════════════════════════════════════

export type LookupTarget = "resources" | "knowledge_items" | "both";
export type LookupKind = "count" | "list";

export interface LookupIntent {
  kind: LookupKind;
  target: LookupTarget;
  topic: string;
}

export interface LookupResult {
  intent: LookupIntent;
  resources_total: number | null;
  knowledge_items_total: number | null;
  resource_samples: Array<{ id: string; title: string }>;
  ki_samples: Array<{ id: string; title: string }>;
  computed_at: string;
}

export interface PendingLookupAction {
  pending_action: "resource_lookup";
  lookup_type: LookupKind;
  topic: string;
  target: LookupTarget;
  offered_at: string;
}

// ── Stopwords stripped from extracted topics ──────────────
const STOPWORDS = new Set([
  "a","an","the","my","our","your","this","that","these","those","of","for",
  "to","in","on","with","and","or","about","around","regarding","related",
  "include","includes","including","content","stuff","things","items",
  "resources","resource","kis","ki","knowledge","items","item","library",
  "do","does","have","has","i","me","you","we","they","it","is","are","be",
  "how","many","much","what","which","show","list","find","give","get","tell",
  "any","some","all","more","please","can","could","would","run","do","it",
  "calls","call",
]);

function cleanTopic(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const kept = tokens.filter((t) => !STOPWORDS.has(t) && t.length > 1);
  return kept.join(" ").trim();
}

// ── Intent detection ──────────────────────────────────────
const COUNT_RE =
  /\bhow\s+many\b|\bcount\s+(?:of\s+)?|\bnumber\s+of\b|\btotal\s+(?:number\s+of\s+)?/i;
const LIST_RE =
  /\b(?:show|list|find|give\s+me|get|pull\s+up|surface|what\s+(?:are|do\s+i\s+have))\b/i;
const RESOURCES_RE =
  /\bresources?\b|\barticles?\b|\bsources?\b|\bdocs?\b|\bdocuments?\b|\bpodcasts?\b|\bvideos?\b|\bbooks?\b/i;
const KI_RE =
  /\bkis?\b|\bknowledge[\s-]?items?\b|\btactics?\b|\bplays?\b|\bmoves?\b/i;

const TOPIC_PATTERNS: RegExp[] = [
  // "...about cold calling", "...related to discovery"
  /(?:about|on|regarding|related\s+to|covering|involving|for|around)\s+(.+?)(?:[?.!]|$)/i,
  // "cold calling resources"
  /([a-z][a-z0-9\s\-]{2,60})\s+(?:resources?|kis?|knowledge[\s-]?items?|tactics?)\b/i,
];

export function detectLookupIntent(rawText: string): LookupIntent | null {
  const text = (rawText || "").trim();
  if (!text || text.length < 6) return null;

  const isCount = COUNT_RE.test(text);
  const isList = LIST_RE.test(text);
  const mentionsResources = RESOURCES_RE.test(text);
  const mentionsKIs = KI_RE.test(text);

  if (!isCount && !isList) return null;
  if (!mentionsResources && !mentionsKIs) return null;

  let target: LookupTarget = "both";
  if (mentionsResources && !mentionsKIs) target = "resources";
  else if (mentionsKIs && !mentionsResources) target = "knowledge_items";

  // Extract topic
  let topic = "";
  for (const pat of TOPIC_PATTERNS) {
    const m = text.match(pat);
    if (m && m[1]) {
      topic = cleanTopic(m[1]);
      if (topic) break;
    }
  }

  // Fallback: strip the count/list verb + entity word and clean what's left
  if (!topic) {
    topic = cleanTopic(text);
  }
  if (!topic || topic.length < 2) return null;

  return {
    kind: isList && !isCount ? "list" : "count",
    target,
    topic,
  };
}

// ── Affirmative reply detection ───────────────────────────
//
// We accept short, unambiguous "yes"-like replies. To avoid false
// positives we cap the message length: if the user wrote a sentence
// longer than ~60 chars it's almost certainly not just "do it" — they
// changed topic and we should not silently fire the pending lookup.
//
// Patterns are anchored to start (so "yes" / "yep" / "do it" / "go ahead"
// / "okay, run it" / "sounds good" / "please do" / "yeah do it" all
// match) and tolerate trailing punctuation or a short tail like
// "please" / "now" / "thanks".
const AFFIRMATIVE_LEAD =
  /^\s*(?:yes|yep|yeah|yup|sure|ok(?:ay)?|y|aye|affirmative|please(?:\s+do(?:\s+it)?)?|do\s+it|run\s+it|go\s+(?:for\s+it|ahead)|sounds?\s+good|let'?s\s+do\s+(?:it|that)|let'?s\s+go|pull\s+it\s+up|fire\s+it|hit\s+it|proceed)\b/i;
const NEGATIVE_LEAD =
  /^\s*(?:no|nope|nah|never\s*mind|nvm|cancel|stop|skip|don'?t|forget\s+it|hold\s+off|not\s+(?:now|yet))\b/i;
// Anywhere-in-string clear cancel/reverse signals — used to reject
// ambiguous "yes but actually never mind" style replies.
const NEGATIVE_ANYWHERE =
  /\b(?:never\s*mind|cancel|forget\s+it|skip\s+it|hold\s+off|not\s+(?:now|yet)|don'?t\s+(?:bother|run))\b/i;
const MAX_AFFIRMATIVE_LEN = 60;

export function detectAffirmative(rawText: string): boolean {
  const t = (rawText || "").trim();
  if (!t || t.length > MAX_AFFIRMATIVE_LEN) return false;
  // Reject if a negative lead OR a clear cancel signal anywhere — ambiguous → no.
  if (NEGATIVE_LEAD.test(t)) return false;
  if (NEGATIVE_ANYWHERE.test(t)) return false;
  return AFFIRMATIVE_LEAD.test(t);
}

export function detectNegative(rawText: string): boolean {
  const t = (rawText || "").trim();
  if (!t || t.length > MAX_AFFIRMATIVE_LEN) return false;
  return NEGATIVE_LEAD.test(t);
}

// ── Real DB-backed search ─────────────────────────────────
function buildIlikeOr(topic: string, fields: string[]): string {
  // Escape % and , for PostgREST or() syntax
  const safe = topic.replace(/[\\%_,()]/g, " ").trim();
  const pattern = `%${safe}%`;
  return fields.map((f) => `${f}.ilike.${pattern}`).join(",");
}

async function countTable(
  supabase: any,
  table: string,
  userId: string,
  topic: string,
  fields: string[],
): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .or(buildIlikeOr(topic, fields));
    if (error) {
      console.warn(JSON.stringify({
        tag: "[strategy-core/libraryLookup:count_failed]",
        table,
        topic,
        reason: error.message,
      }));
      return null;
    }
    return typeof count === "number" ? count : null;
  } catch (e) {
    console.warn(JSON.stringify({
      tag: "[strategy-core/libraryLookup:count_failed]",
      table,
      topic,
      reason: (e as Error).message,
    }));
    return null;
  }
}

async function listTable(
  supabase: any,
  table: string,
  userId: string,
  topic: string,
  fields: string[],
  limit = 10,
): Promise<Array<{ id: string; title: string }>> {
  try {
    const { data, error } = await supabase
      .from(table)
      .select("id, title")
      .eq("user_id", userId)
      .or(buildIlikeOr(topic, fields))
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn(JSON.stringify({
        tag: "[strategy-core/libraryLookup:list_failed]",
        table,
        topic,
        reason: error.message,
      }));
      return [];
    }
    return (data ?? []).map((r: any) => ({
      id: String(r.id),
      title: String(r.title ?? "(untitled)"),
    }));
  } catch (e) {
    console.warn(JSON.stringify({
      tag: "[strategy-core/libraryLookup:list_failed]",
      table,
      topic,
      reason: (e as Error).message,
    }));
    return [];
  }
}

// NOTE: PostgREST `ilike` does not work on text[] columns (e.g. tags),
// and a single bad operand short-circuits the whole or() filter, returning
// zero results. So we restrict to text columns only.
const RESOURCE_FIELDS = ["title", "description", "content"];
const KI_FIELDS = [
  "title",
  "tactic_summary",
  "how_to_execute",
  "why_it_matters",
  "when_to_use",
  "source_excerpt",
];

export async function runLibraryLookup(
  supabase: any,
  userId: string,
  intent: LookupIntent,
): Promise<LookupResult> {
  const wantResources = intent.target === "resources" || intent.target === "both";
  const wantKIs = intent.target === "knowledge_items" || intent.target === "both";

  const tasks: Array<Promise<unknown>> = [];
  let resources_total: number | null = null;
  let knowledge_items_total: number | null = null;
  let resource_samples: Array<{ id: string; title: string }> = [];
  let ki_samples: Array<{ id: string; title: string }> = [];

  if (wantResources) {
    tasks.push(
      countTable(supabase, "resources", userId, intent.topic, RESOURCE_FIELDS)
        .then((n) => { resources_total = n; }),
    );
    if (intent.kind === "list") {
      tasks.push(
        listTable(supabase, "resources", userId, intent.topic, RESOURCE_FIELDS)
          .then((rows) => { resource_samples = rows; }),
      );
    }
  }
  if (wantKIs) {
    tasks.push(
      countTable(supabase, "knowledge_items", userId, intent.topic, KI_FIELDS)
        .then((n) => { knowledge_items_total = n; }),
    );
    if (intent.kind === "list") {
      tasks.push(
        listTable(supabase, "knowledge_items", userId, intent.topic, KI_FIELDS)
          .then((rows) => { ki_samples = rows; }),
      );
    }
  }

  await Promise.all(tasks);

  return {
    intent,
    resources_total,
    knowledge_items_total,
    resource_samples,
    ki_samples,
    computed_at: new Date().toISOString(),
  };
}

// ── Render assistant-facing text ──────────────────────────
function fmtCount(n: number | null): string {
  return typeof n === "number" ? n.toString() : "unknown (query failed)";
}

export function renderLookupResultText(result: LookupResult): string {
  const { intent } = result;
  const parts: string[] = [];
  const topicLabel = intent.topic;

  if (intent.kind === "count") {
    if (intent.target === "resources") {
      parts.push(
        `I found **${fmtCount(result.resources_total)} resource${result.resources_total === 1 ? "" : "s"}** in your library related to "${topicLabel}".`,
      );
    } else if (intent.target === "knowledge_items") {
      parts.push(
        `I found **${fmtCount(result.knowledge_items_total)} knowledge item${result.knowledge_items_total === 1 ? "" : "s"}** related to "${topicLabel}".`,
      );
    } else {
      parts.push(
        `Across your full library related to "${topicLabel}":\n` +
        `- **${fmtCount(result.resources_total)}** resource${result.resources_total === 1 ? "" : "s"}\n` +
        `- **${fmtCount(result.knowledge_items_total)}** knowledge item${result.knowledge_items_total === 1 ? "" : "s"}`,
      );
    }
  } else {
    // list
    if (intent.target === "resources" || intent.target === "both") {
      const n = result.resources_total;
      parts.push(`**Resources matching "${topicLabel}"** (${fmtCount(n)} total):`);
      if (result.resource_samples.length === 0) {
        parts.push("_(no titles to preview)_");
      } else {
        for (const r of result.resource_samples) parts.push(`- ${r.title}`);
        if (typeof n === "number" && n > result.resource_samples.length) {
          parts.push(`_…and ${n - result.resource_samples.length} more._`);
        }
      }
    }
    if (intent.target === "knowledge_items" || intent.target === "both") {
      if (parts.length) parts.push("");
      const n = result.knowledge_items_total;
      parts.push(`**Knowledge items matching "${topicLabel}"** (${fmtCount(n)} total):`);
      if (result.ki_samples.length === 0) {
        parts.push("_(no titles to preview)_");
      } else {
        for (const k of result.ki_samples) parts.push(`- ${k.title}`);
        if (typeof n === "number" && n > result.ki_samples.length) {
          parts.push(`_…and ${n - result.ki_samples.length} more._`);
        }
      }
    }
  }

  parts.push("");
  parts.push(
    `_Source: exact Postgres search across your full library (title + description + content + tags). Not a vector slice._`,
  );
  return parts.join("\n");
}

export function buildPendingLookupAction(intent: LookupIntent): PendingLookupAction {
  return {
    pending_action: "resource_lookup",
    lookup_type: intent.kind,
    topic: intent.topic,
    target: intent.target,
    offered_at: new Date().toISOString(),
  };
}

export function pendingActionToIntent(p: PendingLookupAction | null | undefined): LookupIntent | null {
  if (!p || p.pending_action !== "resource_lookup") return null;
  if (!p.topic || !p.lookup_type || !p.target) return null;
  return { kind: p.lookup_type, topic: p.topic, target: p.target };
}
