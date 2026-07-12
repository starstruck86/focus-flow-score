import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  isIntelligenceClassificationCandidate,
  normalizeSituationResult,
} from "./situationClassifier.ts";

const requestedRetrieval = {
  competitive: {
    include: true,
    competitorNames: ["Adjust"],
    categoryHints: ["MMP"],
  },
  vertical: { include: true },
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

Deno.test("situation retrieval fails closed when confidence is low", () => {
  const result = normalizeSituationResult({
    situation: "adjust-displacement",
    confidence: "low",
    retrieval: requestedRetrieval,
  }, new Map());

  assertEquals(result.retrieval, {
    competitive: { include: false, competitorNames: [], categoryHints: [] },
    vertical: { include: false },
  });
});

Deno.test("situation retrieval fails closed for missing or malformed fields", () => {
  const missingConfidence = normalizeSituationResult({
    retrieval: requestedRetrieval,
  }, new Map());
  assertEquals(missingConfidence.confidence, "low");
  assertEquals(missingConfidence.retrieval.competitive.include, false);
  assertEquals(missingConfidence.retrieval.vertical.include, false);

  const invalidFlags = normalizeSituationResult({
    confidence: "high",
    retrieval: {
      competitive: {
        include: "true",
        competitorNames: ["Adjust"],
        categoryHints: ["MMP"],
      },
      vertical: { include: 1 },
    },
  }, new Map());
  assertEquals(invalidFlags.retrieval, {
    competitive: { include: false, competitorNames: [], categoryHints: [] },
    vertical: { include: false },
  });

  const arrayPlan = normalizeSituationResult({
    confidence: "high",
    retrieval: [requestedRetrieval],
  }, new Map());
  assertEquals(arrayPlan.retrieval.competitive.include, false);
  assertEquals(arrayPlan.retrieval.vertical.include, false);
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
});

Deno.test("medium confidence may authorize a valid retrieval plan", () => {
  const result = normalizeSituationResult({
    confidence: "medium",
    retrieval: requestedRetrieval,
  }, new Map());

  assertEquals(result.retrieval, requestedRetrieval);
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
