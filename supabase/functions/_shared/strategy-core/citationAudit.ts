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
//        • RESOURCE["..."] (the contract form)
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

export interface CitationAuditOptions {
  /**
   * When true, treat the hit set as a CLOSED naming set: any quoted
   * resource-like title in the assistant text that is not present in
   * the hit set is stripped/annotated even if it isn't wrapped in
   * RESOURCE[…]. Used when the user explicitly picked a resource via
   * /library and we must prevent adjacent-variant hallucinations
   * ("Q3" when they picked "Q2", etc.).
   */
  closedSet?: boolean;
  /**
   * Optional KI hit set. When provided AND non-empty, KI["title"] /
   * KI[id-short] citations in the assistant text are validated against
   * it. When omitted/empty (the default), KI citations are NOT
   * scanned — preserving prior behavior for callers that don't yet
   * thread KI hits through.
   */
  kiHits?: CitationAuditHit[];
  /**
   * Optional CARD hit set. Exact title and exact-eight-character short-id
   * citations are canonical when the caller supplied the retrieved card set.
   */
  cardHits?: CitationAuditHit[];
  /** Optional PLAYBOOK hit set. Only title citations are canonical. */
  playbookHits?: CitationAuditHit[];
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
  options: CitationAuditOptions = {},
): CitationAuditResult {
  const text = assistantText ?? "";
  if (!text.trim()) {
    return { text, modified: false, verifiedTitles: [], unverifiedCitations: [] };
  }

  const { titles } = buildTitleIndex(hits);
  const closedSet = options.closedSet === true && hits.length > 0;

  const verified: string[] = [];
  const unverified: string[] = [];
  let modified = false;

  // ── 1. RESOURCE["title"] form ───────────────────────────────────
  // Bare resource IDs are scanned but deliberately fail: Evidence Policy
  // requires the visible title for Resource attribution.
  let out = text.replace(
    /(?<![A-Z0-9_-])RESOURCE\[\s*("?)([^\]"]+?)\1\s*\]/gi,
    (_full, quote: string, inner: string) => {
      const trimmed = inner.trim();
      // Non-canonical id-short form. It fails even when the id belongs to a
      // real hit so presence telemetry cannot bless competing syntax.
      if (!quote && /^[a-f0-9]+$/i.test(trimmed)) {
        unverified.push(trimmed);
        modified = true;
        return `⚠ UNVERIFIED[${trimmed}]`;
      }
      if (!quote) {
        unverified.push(trimmed);
        modified = true;
        return `⚠ UNVERIFIED["${trimmed}"]`;
      }
      // title form
      const norm = normalize(trimmed);
      const hit = titles.has(norm);
      if (hit) {
        verified.push(trimmed);
        return `RESOURCE["${trimmed}"]`;
      }
      unverified.push(trimmed);
      modified = true;
      return `⚠ UNVERIFIED["${trimmed}"]`;
    },
  );

  // ── 2. KI[…], CARD[…], and PLAYBOOK[…] forms (only when the caller threads
  //        the relevant hit set through; otherwise we leave these alone
  //        to preserve prior behavior).
  //        Runs BEFORE the informal-quoted-string scanner so that titles
  //        like "Command of the Message Framework" wrapped in KI["…"]
  //        are not double-flagged by the artifact-word heuristic.
  const auditNamespacedCitation = (
    ns: "KI" | "CARD" | "PLAYBOOK",
    nsHits: CitationAuditHit[] | undefined,
    allowIdFallback: boolean,
    allowTitle: boolean,
  ) => {
    // Omitted means legacy caller did not provide that namespace. An explicit
    // empty array is a closed empty set, so every such citation is fabricated.
    if (nsHits === undefined) return;
    const { titles: nsTitles, idShorts: nsIdShorts } = buildTitleIndex(nsHits);
    const re = new RegExp(
      `(?<![A-Z0-9_-])${ns}\\[\\s*("?)([^\\]"]+?)\\1\\s*\\]`,
      "gi",
    );
    out = out.replace(re, (_full, quote: string, inner: string) => {
      const trimmed = inner.trim();
      // Canonical KI fallback is exactly the rendered 8-character short id.
      if (!quote && /^[a-f0-9]+$/i.test(trimmed)) {
        if (!allowIdFallback || trimmed.length !== 8) {
          unverified.push(`${ns}:${trimmed}`);
          modified = true;
          return `⚠ UNVERIFIED-${ns}[${trimmed}]`;
        }
        if (nsIdShorts.has(trimmed.slice(0, 8).toLowerCase())) {
          verified.push(`${ns}:${trimmed}`);
          return `${ns}[${trimmed}]`;
        }
        unverified.push(`${ns}:${trimmed}`);
        modified = true;
        return `⚠ UNVERIFIED-${ns}[${trimmed}]`;
      }
      if (!quote) {
        unverified.push(`${ns}:${trimmed}`);
        modified = true;
        return `⚠ UNVERIFIED-${ns}["${trimmed}"]`;
      }
      // title form
      const norm = normalize(trimmed);
      if (!allowTitle) {
        unverified.push(`${ns}:${trimmed}`);
        modified = true;
        return `⚠ UNVERIFIED-${ns}["${trimmed}"]`;
      }
      const hit = nsTitles.has(norm);
      if (hit) {
        verified.push(`${ns}:${trimmed}`);
        return `${ns}["${trimmed}"]`;
      }
      unverified.push(`${ns}:${trimmed}`);
      modified = true;
      return `⚠ UNVERIFIED-${ns}["${trimmed}"]`;
    });
  };
  auditNamespacedCitation("KI", options.kiHits, true, true);
  auditNamespacedCitation("CARD", options.cardHits, true, true);
  auditNamespacedCitation("PLAYBOOK", options.playbookHits, false, true);

  // ── 3. Informal "<Title>" + artifact-word references ──────────
  // We only flag quoted strings that sit next to an artifact word, so
  // we don't spuriously annotate seller quotes from a transcript.
  // We also skip anything already wrapped by a namespaced citation or its
  // UNVERIFIED replacement (handled above) to avoid double-flagging.
  //
  // CLOSED-SET MODE: when the user explicitly picked a resource, the
  // artifact-word requirement is relaxed — any quoted phrase that
  // shares ≥2 significant tokens with a known/picked title is treated
  // as an attempted resource reference and must be verified. This is
  // what catches "FTD Q3 Business Case" when the picked title was
  // "FTD Q2 Business Case".
  const STOP = new Set(["the","a","an","of","for","to","and","or","my","our","your","this","that"]);
  const sigTokens = (s: string) =>
    normalize(s).split(/\s+/).filter((t) => t.length >= 2 && !STOP.has(t));
  const knownTokenSets = Array.from(titles).map((t) => new Set(sigTokens(t)));
  const sharesTokensWithKnown = (inner: string): boolean => {
    const innerToks = sigTokens(inner);
    if (innerToks.length < 2) return false;
    for (const set of knownTokenSets) {
      let shared = 0;
      for (const tok of innerToks) if (set.has(tok)) shared++;
      if (shared >= 2) return true;
    }
    return false;
  };

  const quotedRe = /["“]([A-Z][^"“”]{2,80})["”]/g;
  out = out.replace(quotedRe, (full, inner: string, offset: number) => {
    // Skip namespaced/UNVERIFIED brackets already audited above.
    const before = out.slice(Math.max(0, offset - 40), offset);
    if (
      /(?:RESOURCE|KI|CARD|PLAYBOOK|UNVERIFIED(?:-KI|-CARD|-PLAYBOOK)?)\[\s*$/.test(
        before,
      )
    ) return full;

    const window = out.slice(Math.max(0, offset - 60), Math.min(out.length, offset + full.length + 60)).toLowerCase();
    const looksLikeArtifact = ARTIFACT_WORDS.some((w) => window.includes(w));
    const closedSetTrigger = closedSet && sharesTokensWithKnown(inner);
    if (!looksLikeArtifact && !closedSetTrigger) return full;

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
    const tag = closedSetTrigger
      ? `[⚠ not in your library — only the picked resource may be cited]`
      : `[⚠ not in your library]`;
    return `${full} ${tag}`;
  });

  if (modified) {
    out =
      out.trimEnd() +
      `\n\n_⚠ Citation audit: ${unverified.length} library reference${unverified.length === 1 ? " was" : "s were"} not found in your library and cannot be verified. Strategy will not pretend it exists._`;
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
