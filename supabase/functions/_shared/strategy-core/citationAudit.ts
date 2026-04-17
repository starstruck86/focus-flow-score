// ════════════════════════════════════════════════════════════════
// Strategy Core — Citation Auditor
//
// Closes the single biggest remaining hole in resource awareness:
// the model could still INVENT a resource title because the only
// thing stopping it was prompt instructions.
//
// This module runs AFTER the assistant text is finalized. It:
//
//   1. Finds anything the model wrote that LOOKS like a resource
//      citation:
//        • RESOURCE["..."] / RESOURCE[id] (the contract form)
//        • "<title>" template / calculator / playbook / example
//          (informal references the model often slips into)
//   2. Validates each citation against the actual retrieved hit set
//      (titles + short ids).
//   3. For any citation that does NOT match a retrieved title:
//        • RESOURCE[…] form → rewritten to ⚠ UNVERIFIED["…"]
//        • Generic "X template/calculator" form → annotated inline
//          with [⚠ not in your library]
//   4. If anything was rewritten, appends a single, short server-side
//      truth banner so the user (and any downstream summarizer) sees
//      that the assistant tried to cite something we cannot prove
//      exists in their library.
//
// This is deterministic. No model calls. No state. Pure string work.
// It cannot "fix" a hallucination, but it can no longer let one slip
// past silently — which is the actual standard the user asked for.
//
// Notes:
//   - Empty hit set + no citations → no-op.
//   - Non-resource quoted strings (e.g. seller quotes from transcripts)
//     are NOT touched. We only annotate when the surrounding text
//     contains an artifact-intent word (template, calculator, playbook,
//     framework, example, business case, one-pager, checklist, doc).
// ════════════════════════════════════════════════════════════════

export interface CitationAuditHit {
  /** The retrieved resource id (full uuid). */
  id: string;
  /** The retrieved resource title — what the model is allowed to cite. */
  title: string;
}

export interface CitationAuditResult {
  /** Possibly-rewritten assistant text. Falls back to input if nothing changed. */
  text: string;
  /** Did anything get rewritten? */
  modified: boolean;
  /** Citations the model wrote that DID match a retrieved hit. */
  verifiedTitles: string[];
  /** Citations the model wrote that did NOT match. */
  unverifiedCitations: string[];
}

const ARTIFACT_WORDS = [
  "template",
  "calculator",
  "playbook",
  "framework",
  "example",
  "business case",
  "one-pager",
  "one pager",
  "checklist",
  "worksheet",
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/["“”'’`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTitleIndex(hits: CitationAuditHit[]): {
  titles: Set<string>;
  idShorts: Set<string>;
} {
  const titles = new Set<string>();
  const idShorts = new Set<string>();
  for (const h of hits) {
    if (h.title) titles.add(normalize(h.title));
    if (h.id) idShorts.add(h.id.slice(0, 8).toLowerCase());
  }
  return { titles, idShorts };
}

/**
 * Audit the assistant text for resource citations and downgrade any
 * that don't appear in the retrieved hit set.
 *
 * If no citations are present and no hits exist, the text is returned
 * unchanged with modified=false.
 */
export function auditResourceCitations(
  assistantText: string,
  hits: CitationAuditHit[],
): CitationAuditResult {
  const text = assistantText ?? "";
  if (!text.trim()) {
    return { text, modified: false, verifiedTitles: [], unverifiedCitations: [] };
  }

  const { titles, idShorts } = buildTitleIndex(hits);

  const verified: string[] = [];
  const unverified: string[] = [];
  let modified = false;

  // ── 1. RESOURCE["title"] / RESOURCE[id] form ───────────────────
  // Match either bracketed id-shorts or quoted titles inside RESOURCE[…].
  let out = text.replace(
    /RESOURCE\[\s*("?)([^\]"]+?)\1\s*\]/g,
    (_full, _q, inner: string) => {
      const trimmed = inner.trim();
      // id-short form: 8 hex chars
      if (/^[a-f0-9]{8}$/i.test(trimmed)) {
        if (idShorts.has(trimmed.toLowerCase())) {
          verified.push(trimmed);
          return `RESOURCE[${trimmed}]`;
        }
        unverified.push(trimmed);
        modified = true;
        return `⚠ UNVERIFIED[${trimmed}]`;
      }
      // title form
      const norm = normalize(trimmed);
      // Allow exact OR substring match against any retrieved title —
      // the prompt asks for exact, but tolerating "contains" prevents
      // false alarms when the model trims a long title.
      let hit = titles.has(norm);
      if (!hit) {
        for (const t of titles) {
          if (t.includes(norm) || norm.includes(t)) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        verified.push(trimmed);
        return `RESOURCE["${trimmed}"]`;
      }
      unverified.push(trimmed);
      modified = true;
      return `⚠ UNVERIFIED["${trimmed}"]`;
    },
  );

  // ── 2. Informal "<Title>" + artifact-word references ──────────
  // We only flag quoted strings that sit next to an artifact word, so
  // we don't spuriously annotate seller quotes from a transcript.
  // We also skip anything already wrapped by RESOURCE[…] / UNVERIFIED[…]
  // (handled by step 1) to avoid double-flagging.
  const quotedRe = /["“]([A-Z][^"“”]{2,80})["”]/g;
  out = out.replace(quotedRe, (full, inner: string, offset: number) => {
    // Skip if this quoted string is the value of a RESOURCE[…] or
    // UNVERIFIED[…] bracket (already audited in step 1).
    const before = out.slice(Math.max(0, offset - 20), offset);
    if (/(?:RESOURCE|UNVERIFIED)\[\s*$/.test(before)) return full;

    const window = out.slice(Math.max(0, offset - 60), Math.min(out.length, offset + full.length + 60)).toLowerCase();
    const looksLikeArtifact = ARTIFACT_WORDS.some((w) => window.includes(w));
    if (!looksLikeArtifact) return full;

    const norm = normalize(inner);
    let hit = titles.has(norm);
    if (!hit) {
      for (const t of titles) {
        if (t.includes(norm) || norm.includes(t)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) {
      verified.push(inner);
      return full;
    }
    unverified.push(inner);
    modified = true;
    return `${full} [⚠ not in your library]`;
  });

  if (modified) {
    out =
      out.trimEnd() +
      `\n\n_⚠ Citation audit: ${unverified.length} resource reference${unverified.length === 1 ? " was" : "s were"} not found in your library and cannot be verified. Strategy will not pretend it exists._`;
  }

  // Dedupe, preserve order.
  const dedupe = (arr: string[]) => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const s of arr) {
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      result.push(s);
    }
    return result;
  };

  return {
    text: out,
    modified,
    verifiedTitles: dedupe(verified),
    unverifiedCitations: dedupe(unverified),
  };
}
