import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  countLiteralLibraryCitations,
  hasLiteralLibraryCitation,
  missingRequiredLibraryCitation,
  STRICT_LIBRARY_CITATION_INSTRUCTION,
} from "./citationSyntax.ts";

Deno.test("citation syntax accepts every canonical title namespace and KI fallback id", () => {
  const text = [
    'RESOURCE["Discovery Masterclass"]',
    'KI["Quantifying Pain"]',
    'PLAYBOOK["Champion Went Quiet"]',
    "KI[abc12345]",
  ].join(" ");

  assertEquals(countLiteralLibraryCitations(text), 4);
  assertEquals(hasLiteralLibraryCitation(text), true);
  for (const token of ["RESOURCE", "KI", "PLAYBOOK"]) {
    assertStringIncludes(STRICT_LIBRARY_CITATION_INSTRUCTION, `${token}[`);
  }
});

Deno.test("citation syntax rejects vague, malformed, and non-canonical id forms", () => {
  const text = [
    "your library suggests",
    "RESOURCE[abc12345]",
    "CARD[abc12345]",
    'CARD["Quality Pattern"]',
    "KI[aaaaaa]",
    "KI[aaaaaaaaffff]",
    'RESOURCE["unterminated]',
    '⚠ UNVERIFIED-KI["Bogus"]',
    '⚠ UNVERIFIED-CARD["Nope"]',
    '⚠ UNVERIFIED-PLAYBOOK["Invented"]',
  ].join(" ");

  assertEquals(countLiteralLibraryCitations(text), 0);
  assertEquals(hasLiteralLibraryCitation(text), false);
});

Deno.test("missing citation telemetry is evidence-aware", () => {
  assertEquals(missingRequiredLibraryCitation(false, "No sources."), false);
  assertEquals(missingRequiredLibraryCitation(true, "No sources."), true);
  assertEquals(
    missingRequiredLibraryCitation(
      true,
      'Grounded in PLAYBOOK["Champion Went Quiet"].',
    ),
    false,
  );
});
