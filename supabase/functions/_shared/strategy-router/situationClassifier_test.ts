import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  isIntelligenceClassificationCandidate,
  normalizeSituationResult,
  requiresCurrentExternalFacts,
} from "./situationClassifier.ts";

const requestedRetrieval = {
  competitive: {
    include: true,
    competitorNames: ["Adjust"],
    categoryHints: ["MMP"],
  },
  vertical: { include: true },
  webResearch: { include: false },
};

Deno.test("classification pre-gate recognizes unknown named competitors without authorizing retrieval", () => {
  assertEquals(
    isIntelligenceClassificationCandidate(
      "How should I position against Airbridge?",
    ),
    true,
  );
  assertEquals(
    isIntelligenceClassificationCandidate("Can you rewrite this sentence?"),
    false,
  );
});

Deno.test("classification pre-gate admits only fact-shaped current web needs", () => {
  for (
    const prompt of [
      "What did Acme report in its latest earnings?",
      "Verify the current CFO of Acme before my meeting",
      "What App Store policy change was announced this week?",
      "Look up whether Acme was recently acquired",
    ]
  ) {
    assertEquals(isIntelligenceClassificationCandidate(prompt), true, prompt);
  }

  for (
    const prompt of [
      "How should I multithread this renewal?",
      "Rewrite this email",
      "What is the current state of this deal?",
      "If Apple changed ATT, how should we react?",
      "What's new?",
    ]
  ) {
    assertEquals(isIntelligenceClassificationCandidate(prompt), false, prompt);
  }
});

Deno.test("deterministic web gate excludes evergreen and merely competitive asks", () => {
  for (
    const prompt of [
      "What did Acme report in its latest earnings?",
      "Verify the current CFO of Acme before my meeting",
      "What App Store policy change was announced this week?",
    ]
  ) {
    assertEquals(requiresCurrentExternalFacts(prompt), true, prompt);
  }

  for (
    const prompt of [
      "How should I position against Airbridge?",
      "Give me a market framing for this account",
      "Rewrite this competitive email",
      "What is the current state of this deal?",
      "Research Acme",
    ]
  ) {
    assertEquals(requiresCurrentExternalFacts(prompt), false, prompt);
  }
});

Deno.test("situation retrieval fails closed when confidence is low", () => {
  const result = normalizeSituationResult({
    situation: "adjust-displacement",
    confidence: "low",
    retrieval: requestedRetrieval,
  }, new Map());

  assertEquals(result.retrieval, {
    competitive: { include: false, competitorNames: [], categoryHints: [] },
    vertical: { include: false },
    webResearch: { include: false },
  });
});

Deno.test("situation retrieval fails closed for missing or malformed fields", () => {
  const missingConfidence = normalizeSituationResult({
    retrieval: requestedRetrieval,
  }, new Map());
  assertEquals(missingConfidence.confidence, "low");
  assertEquals(missingConfidence.retrieval.competitive.include, false);
  assertEquals(missingConfidence.retrieval.vertical.include, false);
  assertEquals(missingConfidence.retrieval.webResearch.include, false);

  const invalidFlags = normalizeSituationResult({
    confidence: "high",
    retrieval: {
      competitive: {
        include: "true",
        competitorNames: ["Adjust"],
        categoryHints: ["MMP"],
      },
      vertical: { include: 1 },
      webResearch: { include: "true" },
    },
  }, new Map());
  assertEquals(invalidFlags.retrieval, {
    competitive: { include: false, competitorNames: [], categoryHints: [] },
    vertical: { include: false },
    webResearch: { include: false },
  });

  const arrayPlan = normalizeSituationResult({
    confidence: "high",
    retrieval: [requestedRetrieval],
  }, new Map());
  assertEquals(arrayPlan.retrieval.competitive.include, false);
  assertEquals(arrayPlan.retrieval.vertical.include, false);
  assertEquals(arrayPlan.retrieval.webResearch.include, false);
});

Deno.test("situation retrieval caps, cleans, and case-deduplicates hints", () => {
  const result = normalizeSituationResult({
    confidence: "high",
    retrieval: {
      competitive: {
        include: true,
        competitorNames: [
          " Adjust ",
          "adjust",
          "AppsFlyer",
          "Ko\u0000chava",
          "Singular",
        ],
        categoryHints: ["MMP", "mmp", "build-\u007fvs-buy", "extra"],
      },
      vertical: { include: true },
      webResearch: { include: false },
    },
  }, new Map());

  assertEquals(result.retrieval.competitive.competitorNames, [
    "Adjust",
    "AppsFlyer",
    "Ko chava",
  ]);
  assertEquals(result.retrieval.competitive.categoryHints, [
    "MMP",
    "build- vs-buy",
  ]);
  assertEquals(result.retrieval.vertical.include, true);
  assertEquals(result.retrieval.webResearch.include, false);
});

Deno.test("medium confidence may authorize a valid retrieval plan", () => {
  const result = normalizeSituationResult({
    confidence: "medium",
    retrieval: requestedRetrieval,
  }, new Map());

  assertEquals(result.retrieval, requestedRetrieval);
});

Deno.test("automatic web research requires a literal high-confidence opt-in", () => {
  const high = normalizeSituationResult({
    confidence: "high",
    retrieval: {
      competitive: {
        include: false,
        competitorNames: [],
        categoryHints: [],
      },
      vertical: { include: false },
      webResearch: { include: true },
    },
  }, new Map());
  assertEquals(high.retrieval.webResearch.include, true);

  const medium = normalizeSituationResult({
    confidence: "medium",
    retrieval: {
      ...requestedRetrieval,
      webResearch: { include: true },
    },
  }, new Map());
  assertEquals(medium.retrieval.competitive.include, true);
  assertEquals(medium.retrieval.vertical.include, true);
  assertEquals(medium.retrieval.webResearch.include, false);

  for (const invalid of [undefined, null, true, [], { include: 1 }]) {
    const malformed = normalizeSituationResult({
      confidence: "high",
      retrieval: {
        ...requestedRetrieval,
        webResearch: invalid,
      },
    }, new Map());
    assertEquals(malformed.retrieval.webResearch.include, false);
  }
});

Deno.test("no-playbook results can authorize retrieval without accepting an invented id", () => {
  const result = normalizeSituationResult({
    situation: "industry-account-research",
    playbookId: "invented-playbook-id",
    playbookTitle: "Invented title",
    confidence: "high",
    retrieval: requestedRetrieval,
  }, new Map());

  assertEquals(result.playbookId, null);
  assertEquals(result.playbookTitle, null);
  assertEquals(result.retrieval, requestedRetrieval);
});

Deno.test("no-playbook result may authorize a high-confidence current-fact lookup", () => {
  const result = normalizeSituationResult({
    situation: "current-company-earnings",
    playbookId: "invented-playbook-id",
    confidence: "high",
    retrieval: {
      competitive: {
        include: false,
        competitorNames: [],
        categoryHints: [],
      },
      vertical: { include: false },
      webResearch: { include: true },
    },
  }, new Map());

  assertEquals(result.playbookId, null);
  assertEquals(result.retrieval.webResearch.include, true);
});
