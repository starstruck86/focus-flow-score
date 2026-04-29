/**
 * Library-biased synthesis addendum (Phase 3, pure).
 *
 * Builds a SYSTEM-PROMPT FRAGMENT that injects:
 *   • The skill's behavior intent and rubric (mustHave / forbidden phrases).
 *   • The skill's output contract (shape, target words, forbid).
 *   • A "library standards win" instruction listing the retrieved KI/Playbook
 *     titles that the model is required to lean on.
 *
 * This module is pure: it returns a string. It is injected into the
 * existing prompt pipeline; it does not replace it. When the skill
 * envelope is absent, this module is never called.
 */
import type { SkillManifest } from "./types.ts";

export interface LibraryHit {
  kind: "knowledge_item" | "playbook";
  id: string;
  title: string;
  /** Compact reason this item was retrieved (chapter / problem_type). */
  context?: string | null;
}

export interface AddendumInput {
  manifest: SkillManifest;
  hits: ReadonlyArray<LibraryHit>;
  overridesClamped: ReadonlyArray<string>;
  sourceModeWarning?: string;
}

const HARD_RULES = [
  "The skill manifest is the AUTHORITY. Do not change behavior based on user message phrasing.",
  "Library standards win: lean on the retrieved Knowledge Items / Playbooks listed below.",
  "Do not invent library citations. If a tactic is not grounded in the retrieved items, say so plainly.",
  "Never produce a generic answer to silently meet the request — refuse with a specific reason instead.",
];

function rubricBlock(m: SkillManifest): string {
  const must = m.rubric.mustHave.length
    ? `MUST cover: ${m.rubric.mustHave.join(", ")}.`
    : "";
  const avoid = m.rubric.genericMarkers.length
    ? `Avoid generic phrases like: ${m.rubric.genericMarkers.map((g) => `"${g}"`).join(", ")}.`
    : "";
  return [must, avoid].filter(Boolean).join("\n");
}

function outputBlock(m: SkillManifest): string {
  const lines: string[] = [];
  lines.push(`Output shape: ${m.output.shape}.`);
  if (m.output.targetWords) {
    lines.push(`Target length: ${m.output.targetWords.min}–${m.output.targetWords.max} words.`);
  }
  if (m.output.forbid?.length) {
    lines.push(`Do not use: ${m.output.forbid.join(", ")}.`);
  }
  return lines.join("\n");
}

function libraryBlock(hits: ReadonlyArray<LibraryHit>): string {
  if (!hits.length) {
    return "Library hits: NONE. State this explicitly in your answer.";
  }
  const lines = hits.slice(0, 12).map((h) => {
    const kind = h.kind === "knowledge_item" ? "KI" : "PB";
    const ctx = h.context ? ` — ${h.context}` : "";
    return `- [${kind}:${h.id.slice(0, 8)}] ${h.title}${ctx}`;
  });
  return `Library hits to ground the answer:\n${lines.join("\n")}`;
}

export function buildSynthesisAddendum(input: AddendumInput): string {
  const m = input.manifest;
  const sections: string[] = [];
  sections.push(`=== SKILL: ${m.label} (${m.id}) ===`);
  sections.push(`Behavior intent (locked): ${m.behaviorIntent}`);
  sections.push(`Workspace (locked): ${m.workspace}`);
  sections.push(`Source mode: ${m.sourceMode}`);
  sections.push("");
  sections.push("RULES");
  for (const r of HARD_RULES) sections.push(`- ${r}`);
  sections.push("");
  sections.push("RUBRIC");
  sections.push(rubricBlock(m));
  sections.push("");
  sections.push("OUTPUT");
  sections.push(outputBlock(m));
  sections.push("");
  sections.push(libraryBlock(input.hits));
  if (input.sourceModeWarning) {
    sections.push("");
    sections.push(`PROOF NOTE: ${input.sourceModeWarning}`);
  }
  if (input.overridesClamped.length) {
    sections.push("");
    sections.push(
      `Note: client attempted to override [${input.overridesClamped.join(", ")}] — ignored. Manifest is authoritative.`,
    );
  }
  return sections.join("\n");
}
