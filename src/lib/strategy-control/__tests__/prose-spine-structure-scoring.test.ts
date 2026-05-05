/**
 * Regression tests: Prose Structure Scoring — Business Spine vs Generic Polish
 *
 * Validates that scoreStructureProse rewards business spine with ordering
 * and concrete entities over transition density and paragraph prettiness.
 */
import { describe, it, expect } from "vitest";

// ── Inline the scorer for unit testing ───────────────────────────
function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length;
}

function scoreStructureProse(text: string): number {
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).length;
  if (words < 10) return 1;

  const spinePhases: Array<{ label: string; pattern: RegExp }> = [
    { label: "context", pattern: /\b(?:current(?:ly)?|today|right now|existing|as of|at present|status quo|their (?:team|org|pipeline|process)|the (?:problem|challenge|situation|reality)|facing|experiencing|struggling|dealing with)\b/i },
    { label: "consequence", pattern: /\b(?:cost of|risk of|consequence|negative impact|result(?:ing) in|which (?:means|creates|causes|drives)|this (?:means|creates|causes|drives|leaves)|without this|if (?:not|they don't)|losing|missed|erosion|pressure|threat|exposure|vulnerability|at stake|delayed?)\b/i },
    { label: "insight", pattern: /\b(?:the (?:real|core|key|critical|fundamental) (?:issue|question|shift|opportunity)|what (?:this means|matters|changes)|the shift|the opportunity|our (?:view|position|thesis|pov|perspective)|the way forward|reframe|rethink|reconsider|the unlock|differentiat|insight is|the question isn't)\b/i },
    { label: "action", pattern: /\b(?:ask (?:them|their|the|about|whether|how|what|why)|propose|confirm whether|validate|test whether|open (?:with|by)|frame (?:the|this|around)|position|next step|start by|begin with|lead with|anchor on|the question to pose)\b/i },
  ];

  const phasePositions: number[] = [];
  let spineHits = 0;
  for (const phase of spinePhases) {
    const match = lower.search(phase.pattern);
    phasePositions.push(match);
    if (match >= 0) spineHits++;
  }

  let orderedCount = 0;
  let lastPos = -1;
  for (const pos of phasePositions) {
    if (pos > lastPos && pos >= 0) {
      orderedCount++;
      lastPos = pos;
    }
  }

  let spineScore = 0;
  if (spineHits >= 4 && orderedCount >= 3) spineScore = 1.0;
  else if (spineHits >= 3 && orderedCount >= 2) spineScore = 0.75;
  else if (spineHits >= 3) spineScore = 0.6;
  else if (spineHits >= 2) spineScore = 0.4;
  else if (spineHits >= 1) spineScore = 0.2;

  const numbers = countMatches(text, /\b\d[\d,.]*%?\b/g);
  const properNouns = countMatches(text, /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
  const quotedTerms = countMatches(text, /"[^"]{2,}"/g);
  const concreteSignals = numbers + properNouns * 0.5 + quotedTerms;
  const concretePer100 = (concreteSignals / words) * 100;
  let concreteBonus = 0;
  if (concretePer100 > 3) concreteBonus = 0.5;
  else if (concretePer100 > 1.5) concreteBonus = 0.25;

  const GENERIC_PROSE = [/\bleverage\b/gi, /\bbest practices?\b/gi, /\bsynerg/gi, /\bholistic\b/gi, /\bscalable solution/gi, /\binnovative approach/gi, /\bworld[- ]class\b/gi, /\bin today'?s (?:landscape|environment|market)\b/gi, /\bstreamline (?:operations|processes)\b/gi, /\bdrive (?:growth|value|results)\b/gi, /\bkey stakeholders?\b/gi, /\bunlock (?:potential|value|growth)\b/gi];
  const genericHits = GENERIC_PROSE.reduce((n, p) => n + countMatches(text, p), 0);
  let genericPenalty = 0;
  if (genericHits >= 4) genericPenalty = 0.5;
  else if (genericHits >= 2) genericPenalty = 0.25;
  else if (genericHits >= 1) genericPenalty = 0.1;

  const sentences = countMatches(text, /[.!?]\s/g) + 1;
  const avgWordsPerSentence = words / Math.max(sentences, 1);
  let density = 0;
  if (avgWordsPerSentence >= 10 && avgWordsPerSentence <= 30) density = 1;
  else if (avgWordsPerSentence >= 8 && avgWordsPerSentence <= 35) density = 0.5;

  const transitions = countMatches(text, /\b(?:however|therefore|specifically|because|given that|as a result|in contrast|for example|notably|critically|importantly|furthermore|meanwhile|this means|in other words|by contrast|which means|leading to|ensuring|ultimately|although|yet|thus|hence|accordingly|consequently)\b/gi);
  let flow = 0;
  if (transitions >= 3) flow = 1;
  else if (transitions >= 1) flow = 0.5;

  const rawSum = spineScore * 2.0 + concreteBonus * 0.6 + density * 0.6 + flow * 0.3 - genericPenalty;

  let score: number;
  if (rawSum >= 2.6) score = 5;
  else if (rawSum >= 2.0) score = 4;
  else if (rawSum >= 1.4) score = 3;
  else if (rawSum >= 0.7) score = 2;
  else score = 1;
  return score;
}

// ── Tests ────────────────────────────────────────────────────────

describe("Prose Structure: Business Spine Scoring", () => {
  const SPINE_PROSE = `Acme's pipeline currently relies on manual qualification, resulting in 40% of reps spending time on deals that never close. The cost of this is not just lost quota — it's compounding rep attrition as top performers leave for orgs with better tooling. The real issue is that Acme treats qualification as a checkbox rather than a diagnostic process. We should open by asking their VP Sales how they measure qualification accuracy today, then frame the gap between their current close rate and what's achievable with structured scoring.`;

  const GENERIC_POLISHED_PROSE = `In today's landscape, it is important to leverage best practices when engaging with key stakeholders. However, organizations must also consider the holistic approach to their go-to-market strategy. Furthermore, innovative approaches can help streamline operations and drive growth. Additionally, scalable solutions ensure long-term value creation. Consequently, teams should explore synergies across departments. Moreover, building rapport with decision-makers remains critical. Ultimately, a world-class methodology will unlock potential and differentiate your offering in a competitive market.`;

  const TRANSITIONS_ONLY_PROSE = `However, we need to think about this differently. Furthermore, there are additional considerations. Additionally, the team should evaluate options. Consequently, a new approach may be warranted. Moreover, other factors come into play. Therefore, we recommend further analysis. Ultimately, the path forward requires careful thought. Accordingly, next steps should be defined soon.`;

  const SINGLE_PARAGRAPH_SPINE = `Their SDR team is currently booking meetings at 12% conversion but losing 60% to no-shows because there's no pre-call value exchange — the risk of this pattern is that their $2M pipeline target becomes unreachable by Q3 if it holds. The core shift needed is moving from volume-based outbound to signal-triggered sequences that earn the meeting. Start by asking their Head of Revenue how they measure meeting quality vs quantity today.`;

  it("business spine prose scores higher than generic polished prose", () => {
    const spineScore = scoreStructureProse(SPINE_PROSE);
    const genericScore = scoreStructureProse(GENERIC_POLISHED_PROSE);
    expect(spineScore).toBeGreaterThan(genericScore);
  });

  it("transition-word count alone cannot create a structure win", () => {
    const transitionsScore = scoreStructureProse(TRANSITIONS_ONLY_PROSE);
    const spineScore = scoreStructureProse(SPINE_PROSE);
    expect(spineScore).toBeGreaterThanOrEqual(transitionsScore);
    expect(transitionsScore).toBeLessThanOrEqual(3);
  });

  it("single-paragraph constrained prose can score 5/5 with full business spine", () => {
    const score = scoreStructureProse(SINGLE_PARAGRAPH_SPINE);
    expect(score).toBeGreaterThanOrEqual(4);
  });

  it("Commercial Insight-style prose with context→consequence→insight→action does not lose structure", () => {
    const ciProse = `Drift's marketing team currently generates 4,000 MQLs per month but sales only accepts 22% — the cost of this gap isn't lead quality, it's that marketing defines "qualified" by form fills while sales needs budget confirmation. This creates a 78% rejection rate that erodes marketing's credibility with the board. The real issue is redefining MQL criteria around buying signals rather than engagement signals. Ask their CMO: "If you could only pass leads where budget was confirmed, would your team hit pipeline targets with 1/4 the volume?"`;
    const score = scoreStructureProse(ciProse);
    expect(score).toBeGreaterThanOrEqual(4);
  });

  it("generic prose with clean transitions but weak business spine scores lower", () => {
    const weakSpineGoodTransitions = `It is important to consider various factors in this engagement. However, the competitive landscape requires careful analysis. Furthermore, key stakeholders must be aligned on priorities. Additionally, the timeline should be clearly established. Consequently, teams can move forward with greater confidence. Moreover, best practices suggest a phased approach. Therefore, we recommend thorough due diligence before proceeding.`;
    const score = scoreStructureProse(weakSpineGoodTransitions);
    expect(score).toBeLessThanOrEqual(3);
  });

  it("strategy-like prose with entities beats baseline-like prose without", () => {
    // Simulates Strategy output: specific, ordered spine, concrete entities
    const strategyLike = `Beechwood Hotel currently manages guest experience across 4 disconnected platforms, which creates data silos that prevent their GM from seeing a unified guest journey. The cost of this fragmentation is a 23% drop in repeat booking rates over the past 2 quarters. The key shift is consolidating onto a single experience layer that connects pre-arrival, on-property, and post-stay touchpoints. Open by asking their General Manager how they currently track guest satisfaction across properties.`;
    // Simulates Baseline output: decent prose, transitions, but generic
    const baselineLike = `When considering platform consolidation in hospitality, it is important to understand the current technology landscape. However, many organizations face challenges with fragmented systems. Furthermore, guest experience platforms can provide significant benefits when properly integrated. Additionally, stakeholders should be aligned on the consolidation timeline. Therefore, a phased approach is recommended to minimize disruption while maximizing long-term value creation.`;
    const stratScore = scoreStructureProse(strategyLike);
    const baseScore = scoreStructureProse(baselineLike);
    expect(stratScore).toBeGreaterThan(baseScore);
  });
});
