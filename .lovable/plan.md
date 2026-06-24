
# Situation Classifier — Architecture Proposal (task 1.1)

## Findings from reading the code

### 1. `supabase/functions/_shared/strategy-router/` (244 lines, 3 files)
This is the **lane router** (direct / assisted / deep_work), not a retrieval router. It is unrelated to KI/playbook selection and should not be touched for this task.

- **`signals.ts`** — pure `extractSignals()`: regex detection of `deep_intent`, `account_attached`, `length_long`, `strategic_keywords`, `is_utility`, `explicit_task`. No I/O.
- **`index.ts`** — pure `routeRequest(signals, override)` → `{ lane, auto_promoted, promotion_offered, downgrade_warning, task_type, signals }`.
- **`log.ts`** — best-effort insert into `routing_decisions`.

### 2. `libraryRetrieval.ts` — `scopes` shape and scoring
Signature: `retrieveLibraryContext(supabase, userId, inputs, { scopes: string[], maxKIs?, maxPlaybooks? })`.

For every active KI row and every playbook row, it builds `searchText` (concatenation of title, chapter, type, framework, summary, when_to_use, tags, etc.) and runs `scoreRow(searchText, scopes)`:

- For each scope keyword: whole-word regex hits × 2, plus +1 if substring-present but no whole-word hit.
- Rows with `score > 0` are sorted by `score` desc, then `confidence_score` desc, then sliced to `maxKIs` / `maxPlaybooks`.
- Returns `{ knowledgeItems, playbooks, contextString, counts }`. `contextString` is the formatted block injected into the prompt.

**Implication:** whatever the classifier emits must end up as a `string[]` to feed `scopes` unchanged — or we add a sidecar "pin playbook by ID" step after retrieval. No change to `libraryRetrieval.ts` itself is required for v1.

### 3. Real `playbooks` table shape (your message used names that don't exist)
There is no `name`, `description`, or `trigger_conditions` column. Actual fields used for classification:
- `id (uuid)`, `title`, `problem_type` (`objection|competitive|usage|negotiation|champion|executive|…`), `when_to_use` (free text including "Signals: …"), `confidence_score`.

Today there are **7 playbooks** for user `9f11e308-…`: Adjust, AppsFlyer Incumbent, Engineering-can-build, QBR Usage Down 30%+, Champion Went Quiet, 30% Discount, Vendor Consolidation. Small enough to embed every playbook in full inside the classifier prompt.

### 4. `deriveLibraryScopes` (strategy-chat/index.ts:2871)
```ts
function deriveLibraryScopes(account, userContent): string[] {
  scopes.push(account.industry, ...account.tags, ...account.tech_stack)
  scopes.push(...first 8 words ≥4 chars from userContent)
  return dedupe(non-empty)
}
```
Exactly the "keyword soup" described.

### 5. Call chain (single insertion point)
- `strategy-chat/index.ts:5612` — `const scopes = deriveLibraryScopes(pack.account, userContent);`
- `5617` — `decideLibraryQuery(...)` (workspace contract gate)
- `5645–5658` — `retrieveLibraryContext(supabase, userId, {}, { scopes, maxKIs: 8, maxPlaybooks: 4 })` inside the `Promise.all`.

One call site, one swap.

---

## Proposed Architecture

### New file
`supabase/functions/_shared/strategy-core/situationClassifier.ts`

Lives in `strategy-core/` next to the other reasoning helpers — **not** under `strategy-router/`, which owns lane routing. The classifier is a retrieval-prep concern.

### Function signature
```ts
export interface SituationClassification {
  situation: string;                 // short label, e.g. "champion_went_quiet"
  situation_summary: string;         // 1-sentence paraphrase of the rep's ask
  playbook_id: string | null;        // exact UUID from embedded list, or null
  playbook_title: string | null;
  confidence: "high" | "medium" | "low";
  scopes: string[];                  // 3–6 retrieval keywords for libraryRetrieval
  reasoning: string;                 // 1–2 sentences (telemetry/debug)
}

export async function classifySituation(
  supabase: any,
  args: {
    userId: string;
    userContent: string;
    account?: { name?; industry?; tech_stack?; tags? } | null;
    opportunity?: { stage?; close_date?; amount? } | null;
    recentTurns?: Array<{ role: string; content: string }>;
  }
): Promise<SituationClassification | null>;
```
Returns `null` on any failure (LLM error, bad JSON, hallucinated playbook id) so the caller can fall back.

### DB query
One read, top of the function:
```sql
select id, title, problem_type, when_to_use, why_it_matters, confidence_score
from playbooks
where user_id = $1
order by confidence_score desc nulls last
limit 50;
```
Cap of 50 future-proofs the prompt as the library grows; today returns 7.

### Classifier prompt shape
One LLM call via Lovable AI gateway (`google/gemini-2.5-flash`, JSON mode).

```
SYSTEM:
You are a sales-situation triage classifier. Given a rep's question plus
optional account/opportunity context, identify (a) the situation they
are in, (b) which of the listed playbooks (if any) best matches, and
(c) 3–6 high-signal retrieval keywords for knowledge lookup.

Rules:
- playbook_id MUST be one of the IDs in AVAILABLE PLAYBOOKS, or null.
  Never invent an ID.
- Prefer null over a weak match. confidence="low" requires playbook_id=null.
- scopes are concepts / tactics / objection types, not the rep's literal
  words. No account names, no stopwords.

AVAILABLE PLAYBOOKS:
- id: 9141ed29-0d01-47c8-b25d-a4dd0562cc4d
  title: Adjust Comes Up
  problem_type: competitive
  when_to_use: Prospect mentions Adjust as current vendor or during
    comparison. Signals: "we use Adjust", "how do you compare to Adjust", …
- id: 300a7450-…
  title: AppsFlyer Incumbent
  …
(every playbook rendered the same way)

USER:
REP QUESTION: "<userContent>"
ACCOUNT: {name, industry, tech_stack}     ← only if present
OPPORTUNITY: {stage, close_date, amount}  ← only if present
RECENT TURNS: <last 2–3, truncated>       ← only if present

Respond as JSON matching SituationClassification.
```

### Returned JSON (concrete example)
```json
{
  "situation": "champion_went_quiet",
  "situation_summary": "Rep's champion at Headspace has not responded in 12 days during an active renewal.",
  "playbook_id": "8dba0b4f-b6d4-455c-aa9e-d8c0cebd5394",
  "playbook_title": "Champion Went Quiet (10+ Days)",
  "confidence": "high",
  "scopes": ["champion re-engagement", "ghosting", "renewal at risk", "multi-thread", "executive escalation"],
  "reasoning": "Question explicitly describes a non-responsive champion past 10 days during a renewal — exact match for the Champion Went Quiet playbook."
}
```

### How it replaces `deriveLibraryScopes`
At `strategy-chat/index.ts:5612`:
```ts
// BEFORE
const scopes = deriveLibraryScopes(pack.account, userContent);

// AFTER
const situation = await classifySituation(supabase, {
  userId, userContent,
  account: pack.account, opportunity: pack.opportunity,
  recentTurns,
}).catch(e => { console.warn("[situation-classifier] failed:", e.message); return null; });

const scopes = (situation?.scopes?.length ?? 0) > 0
  ? situation!.scopes
  : deriveLibraryScopes(pack.account, userContent); // fallback
```
`deriveLibraryScopes` stays in the file as the fallback — do not delete.

### How the result feeds `libraryRetrieval`
Two effects, both surgical:

1. **Scopes path (no signature change):** the classifier's `scopes` array is already a `string[]` and slots directly into the existing `retrieveLibraryContext({ scopes, … })` call. `libraryRetrieval.ts` is unchanged.

2. **Playbook pin (additive, after retrieval returns):** when `situation.playbook_id` is non-null, fetch that playbook row directly and unshift it onto `library.playbooks`, de-duped, capped to `maxPlaybooks`. Then rebuild `library.contextString` so the pinned playbook appears first in the prompt block. Requires extracting a tiny `formatLibraryContext(kis, playbooks)` helper from `libraryRetrieval.ts` so the pin step can re-render without copy-pasting the template. This guarantees the classifier's chosen playbook is always present even if keyword scoring would have ranked it below the cap.

### Telemetry
One log line per call: `[situation-classifier] situation=<label> playbook=<title|null> confidence=<h/m/l> scopes=[…] latency_ms=<n>`. Persistence to a table is out of scope for 1.1.

### Failure / cost guards
- Skip classifier when `userContent.trim().length < 12` or when `__libraryDecision.shouldQuery === false` (workspace contract already suppressed retrieval).
- If LLM errors, returns malformed JSON, or returns a `playbook_id` not in the embedded set → return `null` → caller falls back to `deriveLibraryScopes`. Chat never blocks.
- Single LLM call, capped input (~2k tokens with 7 playbooks).

---

## Open questions before I build

1. **Model:** default `google/gemini-2.5-flash` (cheap, fast, JSON mode). Confirm or override.
2. **Recent turns:** include last 2–3 turns for continuity, or classify on the latest message only? I'd default to last 2.
3. **KI pinning:** v1 stays scopes-only for KIs (the 27k-row KI library is too large to embed). Confirm we are *not* asking the classifier to pick KI IDs.
4. **Logging surface:** stdout-only for v1, or also persist to a new column on `strategy_messages` for later analysis? I'd default to stdout-only.

Approve or correct the architecture and I'll implement.
