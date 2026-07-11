/**
 * Canonical Strategy Chat library-citation syntax.
 *
 * Prompt contracts and telemetry must consume this surface instead of
 * redefining narrower namespace regexes that drift from Evidence Policy.
 */

export const STRICT_LIBRARY_CITATION_INSTRUCTION =
  'Use only listed-source citation forms: RESOURCE["title"], KI["title"], or PLAYBOOK["title"]. Prefer titles; KI[abc12345] is allowed only when no title exists. Never use a vague or fabricated reference.';

const TITLE_CITATION_SOURCE = String
  .raw`(?<![a-z0-9_-])(?:RESOURCE|KI|PLAYBOOK)\[\s*"[^"\]\r\n]+"\s*\]`;
const KI_ID_CITATION_SOURCE = String
  .raw`(?<![a-z0-9_-])KI\[\s*[a-f0-9]{8}\s*\]`;
const LITERAL_LIBRARY_CITATION_SOURCE =
  `(?:${TITLE_CITATION_SOURCE}|${KI_ID_CITATION_SOURCE})`;

export function countLiteralLibraryCitations(text: string): number {
  if (!text) return 0;
  return text.match(
    new RegExp(LITERAL_LIBRARY_CITATION_SOURCE, "gi"),
  )?.length ?? 0;
}

export function hasLiteralLibraryCitation(text: string): boolean {
  return countLiteralLibraryCitations(text) > 0;
}

export function missingRequiredLibraryCitation(
  hasCiteableLibraryEvidence: boolean,
  text: string,
): boolean {
  return hasCiteableLibraryEvidence && !hasLiteralLibraryCitation(text);
}
