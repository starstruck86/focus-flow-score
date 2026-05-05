/**
 * Regression tests: Prose Structure Scoring — Business Spine vs Generic Polish
 *
 * Validates that scoreStructureProse rewards business spine
 * (context → consequence → insight → action) over transition density
 * and paragraph prettiness.
 */
import { describe, it, expect } from "vitest";

// ── Inline the scorer for unit testing ───────────────────────────
function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length;
}
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function scoreStructureProse(text: string): number {
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).length;
  if (words < 10) return 1;

  const spinePhases = [
    /\b(?:current(?:ly)?|today|right now|existing|as of|at present|status quo|their (?:team|org|pipeline|process)|the (?:problem|challenge|situation|reality)|facing|experiencing|struggling|dealing with)\b/i,
    /\b(?:cost|risk|consequence|impact|result(?:ing)?|leading to|which (?:means|creates|causes|drives)|this (?:means|creates|causes|drives|leaves)|without|if (?:not|they don't)|losing|missed|gap|erosion|pressure|threat|exposure|vulnerability|at stake|delay)\b/i,
    /\b(?:insight|the (?:real|core|key|critical|fundamental) (?:issue|question|shift|opportunity)|what (?:this means|matters|changes)|the shift|the opportunity|our (?:view|position|thesis|pov|perspective)|the way forward|reframe|rethink|reconsider|the unlock|differentiat)\b/i,
    /\b(?:ask|propose|confirm|validate|test|open with|frame|position|question|next step|action|recommend|should|must|need to|start by|begin with|prioritize|lead with|anchor on)\b/i,
  ];
  let spineHits = 0;
  for (const phase of spinePhases) {
    if (phase.test(lower)) spineHits++;
  }
  let spineScore = 0;
  if (spineHits >= 4) spineScore = 1.0;
  else if (spineHits >= 3) spineScore = 0.75;
  else if (spineHits >= 2) spineScore = 0.5;
  else if (spineHits >= 1) spineScore = 0.25;

  const GENERIC_PROSE = [/\bleverage\b/gi, /\bbest practices?\b/gi, /\bsynerg/gi, /\bholistic\b/gi, /\bscalable solution/gi, /\binnovative approach/gi, /\bworld[- ]class\b/gi, /\bin today'?s (?:landscape|environment|market)\b/gi, /\bstreamline (?:operations|processes)\b/gi, /\bdrive (?:growth|value|results)\b/gi, /\bkey stakeholders?\b/gi, /\bunlock (?:potential|value|growth)\b/gi];
  const genericHits = GENERIC_PROSE.reduce((n, p) => n + countMatches(text, p), 0);
  let genericPenalty = 0;
  if (genericHits >= 4) genericPenalty = 0.4;
  else if (genericHits >= 2) genericPenalty = 0.2;

  const sentences = countMatches(text, /[.!?]\s/g) + 1;
  const avgWordsPerSentence = words / Math.max(sentences, 1);
  let density = 0;
  if (avgWordsPerSentence >= 10 && avgWordsPerSentence <= 30) density = 1;
  else if (avgWordsPerSentence >= 8 && avgWordsPerSentence <= 35) density = 0.5;

  const transitions = countMatches(text, /\b(?:however|therefore|specifically|because|given that|as a result|in contrast|for example|notably|critically|importantly|furthermore|meanwhile|this means|in other words|by contrast|which means|leading to|ensuring|ultimately|although|yet|thus|hence|accordingly|consequently)\b/gi);
  let flow = 0;
  if (transitions >= 3) flow = 1;
  else if (transitions >= 1) flow = 0.5;

  const rawSum = spineScore * 2.0 + density * 0.8 + flow * 0.4 - genericPenalty;

  let score: number;
  if (rawSum >= 2.8) score = 5;
  else if (rawSum >= 2.2) score = 4;
  else if (rawSum >= 1.5) score = 3;
  else if (rawSum >= 0.8) score = 2;
  else score = 1;
  return score;
}

// ── Tests ────────────────────────────────────────────────────────

describe("Prose Structure: Business Spine Scoring", () => {
  const SPINE_PROSE = `Acme's pipeline currently relies on manual qualification, resulting in 40% of reps spending time on deals that never close. The cost is not just lost quota — it's compounding rep attrition as top performers leave for orgs with better tooling. The real issue is that Acme treats qualification as a checkbox rather than a diagnostic process. We should open by asking their VP Sales how they measure qualification accuracy today, then frame the gap between their current close rate and what's achievable with structured scoring.`;

  const GENERIC_POLISHED_PROSE = `In today's landscape, it is important to leverage best practices when engaging with key stakeholders. However, organizations must also consider the holistic approach to their go-to-market strategy. Furthermore, innovative approaches can help streamline operations and drive growth. Additionally, scalable solutions ensure long-term value creation. Consequently, teams should explore synergies across departments. Moreover, building rapport with decision-makers remains critical. Ultimately, a world-class methodology will unlock potential and differentiate your offering in a competitive market.`;

  const TRANSITIONS_ONLY_PROSE = `However, we need to think about this differently. Furthermore, there are additional considerations. Additionally, the team should evaluate options. Consequently, a new approach may be warranted. Moreover, other factors come into play. Therefore, we recommend further analysis. Ultimately, the path forward requires careful thought. Accordingly, next steps should be defined soon.`;

  const SINGLE_PARAGRAPH_SPINE = `Their SDR team is currently booking meetings at 12% conversion but losing 60% to no-shows because there's no pre-call value exchange — the risk is that their $2M pipeline target becomes unreachable by Q3 if the pattern holds. The core shift needed is moving from volume-based outbound to signal-triggered sequences that earn the meeting. Start by asking their Head of Revenue how they measure meeting quality vs quantity today.`;

  it("business spine prose scores higher than generic polished prose", () => {
    const spineScore = scoreStructureProse(SPINE_PROSE);
    const genericScore = scoreStructureProse(GENERIC_POLISHED_PROSE);
    expect(spineScore).toBeGreaterThan(genericScore);
  });

  it("transition-word count alone cannot create a structure win", () => {
    const transitionsScore = scoreStructureProse(TRANSITIONS_ONLY_PROSE);
    const spineScore = scoreStructureProse(SPINE_PROSE);
    expect(spineScore).toBeGreaterThanOrEqual(transitionsScore);
    // Transitions-only should not reach top score
    expect(transitionsScore).toBeLessThanOrEqual(3);
  });

  it("single-paragraph constrained prose can score 5/5 with full business spine", () => {
    const score = scoreStructureProse(SINGLE_PARAGRAPH_SPINE);
    expect(score).toBe(5);
  });

  it("Commercial Insight-style prose with context→consequence→insight→action does not lose structure", () => {
    const ciProse = `Drift's marketing team currently generates 4,000 MQLs per month but sales only accepts 22% — the gap isn't lead quality, it's that marketing defines "qualified" by form fills while sales needs budget confirmation. This creates a 78% rejection rate that erodes marketing's credibility with the board and forces a quarterly fight over attribution. The real opportunity is redefining MQL criteria around buying signals rather than engagement signals. Ask their CMO: "If you could only pass leads where budget was confirmed, would your team hit pipeline targets with 1/4 the volume?"`;
    const score = scoreStructureProse(ciProse);
    expect(score).toBeGreaterThanOrEqual(4);
  });

  it("generic prose with clean transitions but weak business spine scores lower", () => {
    const weakSpineGoodTransitions = `It is important to consider various factors in this engagement. However, the competitive landscape requires careful analysis. Furthermore, stakeholders must be aligned on priorities. Additionally, the timeline should be clearly established. Consequently, teams can move forward with greater confidence. Moreover, best practices suggest a phased approach. Therefore, we recommend thorough due diligence before proceeding.`;
    const score = scoreStructureProse(weakSpineGoodTransitions);
    expect(score).toBeLessThanOrEqual(3);
  });
});
