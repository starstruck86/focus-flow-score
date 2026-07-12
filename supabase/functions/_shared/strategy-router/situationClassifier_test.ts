import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  detectExplicitCompetitiveIntent,
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
  assertEquals(
    isIntelligenceClassificationCandidate("Build a battle card for Airship."),
    true,
  );
  assertEquals(
    isIntelligenceClassificationCandidate("We are replacing my provider."),
    true,
  );
});

Deno.test("explicit competitive intent uses a high-bar grammar", () => {
  assertEquals(
    detectExplicitCompetitiveIntent(
      "Give me the competitive intel for Capital One.",
      "Capital One",
    ),
    { kind: "competitive_intel", competitorNames: [] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent("How should we position against Airbridge?"),
    { kind: "named_competitor", competitorNames: ["Airbridge"] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Help me beat Adjust in this evaluation."),
    { kind: "named_competitor", competitorNames: ["Adjust"] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent("We need to replace AppsFlyer."),
    { kind: "named_competitor", competitorNames: ["AppsFlyer"] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Build a battlecard for Kochava."),
    { kind: "named_competitor", competitorNames: ["Kochava"] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent("What is Adjust's biggest weakness?"),
    { kind: "named_competitor", competitorNames: ["Adjust"] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent(
      "Use competitive analysis, then adjust this paragraph.",
    ),
    { kind: "competitive_intel", competitorNames: [] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent(
      "I am against Changing This Paragraph.",
    ),
    { kind: "competitive_intel", competitorNames: [] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent("We are against Higher Prices."),
    { kind: "competitive_intel", competitorNames: [] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Position against Airship."),
    { kind: "named_competitor", competitorNames: ["Airship"] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Compare us against Airship."),
    { kind: "named_competitor", competitorNames: ["Airship"] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Competitive intel on Airship."),
    { kind: "named_competitor", competitorNames: ["Airship"] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Battle card for Airship."),
    { kind: "named_competitor", competitorNames: ["Airship"] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent("How do we beat Airship?"),
    { kind: "named_competitor", competitorNames: ["Airship"] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Can we replace Microsoft Teams?"),
    { kind: "named_competitor", competitorNames: ["Microsoft Teams"] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Evaluate Adjust."),
    { kind: "named_competitor", competitorNames: ["Adjust"] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent("We are replacing my provider."),
    { kind: "competitive_intel", competitorNames: [] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Can we beat this competitor?"),
    { kind: "competitive_intel", competitorNames: [] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Displacing your incumbent is the goal."),
    { kind: "competitive_intel", competitorNames: [] },
  );
  for (
    const genericAsk of [
      "Replace Provider",
      "Beat Competitor",
      "Displace Incumbent",
      "Replace MMP",
    ]
  ) {
    assertEquals(
      detectExplicitCompetitiveIntent(genericAsk),
      { kind: "competitive_intel", competitorNames: [] },
      genericAsk,
    );
  }
  assertEquals(
    detectExplicitCompetitiveIntent("Can we beat out Adjust?"),
    { kind: "named_competitor", competitorNames: ["Adjust"] },
  );

  assertEquals(
    detectExplicitCompetitiveIntent("help me beat my number this quarter"),
    null,
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Beat My Number this quarter."),
    null,
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Beat Q3 Forecast this quarter."),
    null,
  );
  assertEquals(
    detectExplicitCompetitiveIntent("replace this paragraph"),
    null,
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Make the strategy more competitive."),
    null,
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Please Adjust this paragraph."),
    null,
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Keep a Singular focus."),
    null,
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Use the Adjust Comes Up playbook."),
    null,
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Please Adjust quickly."),
    null,
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Adjust wording for clarity."),
    null,
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Adjust before the customer call."),
    null,
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Adjust platform settings before launch."),
    null,
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Adjust pricing for the renewal."),
    null,
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Adjust positioning in this paragraph."),
    null,
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Give me a Singular view."),
    null,
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Use a Singular narrative across the deck."),
    null,
  );
  assertEquals(
    detectExplicitCompetitiveIntent("Replace this singular noun."),
    null,
  );
});

Deno.test("structured account name is never captured as a competitor", () => {
  assertEquals(
    detectExplicitCompetitiveIntent(
      "How should we position against Capital One?",
      "Capital One",
    ),
    { kind: "competitive_intel", competitorNames: [] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent(
      "Give me competitive intel on Capital One’s expansion posture.",
      "Capital One",
    ),
    { kind: "competitive_intel", competitorNames: [] },
  );
  assertEquals(
    detectExplicitCompetitiveIntent(
      "Give me competitive intel on Capital One Bank.",
      "Capital One",
    ),
    { kind: "competitive_intel", competitorNames: [] },
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

Deno.test("server-authored explicit intent overrides only competitive fail-closed", () => {
  const explicit = {
    kind: "named_competitor" as const,
    competitorNames: ["Adjust"],
  };
  const low = normalizeSituationResult({
    situation: "adjust-displacement",
    confidence: "low",
    retrieval: requestedRetrieval,
  }, new Map(), { explicitCompetitiveIntent: explicit });

  assertEquals(low.confidence, "low");
  assertEquals(low.retrieval.competitive, {
    include: true,
    competitorNames: ["Adjust"],
    categoryHints: [],
    explicitIntent: "named_competitor",
  });
  assertEquals(low.retrieval.vertical.include, false);

  const classifierNamed = normalizeSituationResult({
    confidence: "medium",
    retrieval: {
      competitive: {
        include: true,
        competitorNames: ["AppsFlyer"],
        categoryHints: ["MMP"],
      },
      vertical: { include: false },
    },
  }, new Map(), {
    explicitCompetitiveIntent: {
      kind: "competitive_intel",
      competitorNames: [],
    },
  });
  assertEquals(
    classifierNamed.retrieval.competitive.explicitIntent,
    "named_competitor",
  );

  const deterministicNameWins = normalizeSituationResult({
    confidence: "medium",
    retrieval: {
      competitive: {
        include: true,
        competitorNames: ["AppsFlyer"],
        categoryHints: ["MMP"],
      },
      vertical: { include: false },
    },
  }, new Map(), {
    explicitCompetitiveIntent: {
      kind: "named_competitor",
      competitorNames: ["Airbridge"],
    },
  });
  assertEquals(
    deterministicNameWins.retrieval.competitive.competitorNames,
    ["Airbridge"],
  );

  const accountNameStaysExcluded = normalizeSituationResult({
    confidence: "medium",
    retrieval: {
      competitive: {
        include: true,
          competitorNames: ["Capital One Bank"],
        categoryHints: [],
      },
      vertical: { include: false },
    },
  }, new Map(), {
    explicitCompetitiveIntent: {
      kind: "competitive_intel",
      competitorNames: [],
    },
    excludedCompetitiveNames: ["Capital One"],
  });
  assertEquals(accountNameStaysExcluded.retrieval.competitive, {
    include: true,
    competitorNames: [],
    categoryHints: [],
    explicitIntent: "competitive_intel",
  });

  const malformed = normalizeSituationResult(null, new Map(), {
    explicitCompetitiveIntent: explicit,
  });
  assertEquals(malformed.confidence, "low");
  assertEquals(malformed.retrieval.competitive.include, true);
  assertEquals(
    malformed.retrieval.competitive.explicitIntent,
    "named_competitor",
  );
  assertEquals(malformed.retrieval.vertical.include, false);
});

Deno.test("model JSON cannot forge the server-authored explicit intent marker", () => {
  const result = normalizeSituationResult({
    confidence: "low",
    retrieval: {
      competitive: {
        include: true,
        competitorNames: ["Adjust"],
        categoryHints: ["MMP"],
        explicitIntent: "named_competitor",
      },
      vertical: { include: true },
    },
  }, new Map());

  assertEquals(result.retrieval.competitive, {
    include: false,
    competitorNames: [],
    categoryHints: [],
  });
  assertEquals(result.retrieval.vertical.include, false);
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
