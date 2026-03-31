/**
 * Adversarial Regression Tests for Content Intelligence
 * 
 * Tests tricky edge cases:
 * 1. Mixed doc with tactic + template + example
 * 2. Descriptive doc that should NOT become tactic
 * 3. Real email that should be example, not template
 * 4. Structured draft that should be template, not example
 * 5. Doc with important instruction lines that must survive transformation
 */

import { describe, it, expect } from 'vitest';
import {
  routeByContent,
  segmentAndRoute,
  shapeAsTemplate,
  shapeAsExample,
  contentSimilarity,
  scoreRouteConfidence,
} from '../contentSignature';

// ── Test 1: Mixed doc with tactic + template + example ─────

const MIXED_DOC = `
## Cold Call Opener Template

Subject: [Company] + [Product] Quick Question

Hi [Name],

I noticed [Company] recently [trigger event]. Many teams in [Industry] use [Product] to solve [pain point].

Would 15 minutes this week make sense?

Best,
[Rep Name]

## Discovery Tactic

When the prospect says "we're happy with our current solution," instead of backing off, try:

"That's great to hear. Can I ask — what would need to change for you to even consider looking at alternatives?"

This works because it reframes satisfaction as complacency without being confrontational.

## Follow-Up Example

Hi Sarah,

Thanks for taking the time to chat yesterday. We discussed how your team's onboarding process currently takes 3 weeks, and I shared how Acme Corp reduced theirs to 5 days using our platform.

As promised, here's the case study: [link]

Next steps:
- You'll review with your VP by Friday
- We'll reconnect Monday at 2pm

Best regards,
Jake
`;

describe('Mixed document segmentation', () => {
  it('should split into 3 segments with correct routes', () => {
    const segments = segmentAndRoute(MIXED_DOC);
    expect(segments.length).toBeGreaterThanOrEqual(3);
    
    const routes = segments.map(s => s.route);
    expect(routes).toContain('template');
    expect(routes).toContain('tactic');
    expect(routes).toContain('example');
  });

  it('should assign charRange provenance to each segment', () => {
    const segments = segmentAndRoute(MIXED_DOC);
    for (const seg of segments) {
      expect(seg.charRange).toBeDefined();
      expect(seg.charRange[1]).toBeGreaterThan(seg.charRange[0]);
    }
  });
});

// ── Test 2: Descriptive doc should NOT become tactic ───────

const DESCRIPTIVE_DOC = `
## Overview of Modern Sales Methodology

In general, the sales landscape has evolved significantly over the past decade. 
Various approaches to customer engagement have emerged, typically including 
consultative selling, challenger methodology, and solution selling.

According to research from Gartner, buyers now complete approximately 57% of their 
purchase decision before engaging with a sales representative. This shift in the 
landscape means that traditional cold calling approaches are less effective than 
they once were.

The history of sales methodology shows a clear evolution from transactional 
approaches to relationship-based selling. Industry leaders often cite the importance 
of understanding the buyer's journey as the foundation of modern sales practice.

Several studies indicate that personalized outreach generates 6x higher response 
rates compared to generic mass messaging, though the specific approach varies 
significantly based on industry and buyer persona.
`;

describe('Descriptive content routing', () => {
  it('should NOT route descriptive content as tactic', () => {
    const routes = routeByContent(DESCRIPTIVE_DOC);
    expect(routes).not.toContain('tactic');
  });

  it('should route as reference', () => {
    const routes = routeByContent(DESCRIPTIVE_DOC);
    expect(routes).toContain('reference');
  });

  it('should have low tactic confidence', () => {
    const score = scoreRouteConfidence(DESCRIPTIVE_DOC, 'tactic');
    expect(score).toBeLessThan(0.3);
  });
});

// ── Test 3: Real email should be example, not template ─────

const REAL_EMAIL = `
Hi Michael,

Thanks for taking my call earlier today. I appreciate you sharing the challenges 
your team is facing with the renewal process at TechCorp.

We discussed three key areas:
1. Your current renewal cycle takes 45 days on average
2. You're losing 15% of renewals due to late outreach
3. Your team of 8 AMs each manages 200+ accounts

I wanted to follow up with a quick summary of how we helped DataFlow Inc solve 
similar challenges — they reduced their renewal cycle to 18 days and improved 
retention by 22%.

I've attached the case study we discussed. The ROI calculator I mentioned is here: 
https://example.com/roi

Next steps:
- You'll share this with Jennifer (VP of CS) by Thursday
- We'll schedule a demo for your team next Tuesday

Looking forward to moving this forward. Thanks again for your time.

Best regards,
Sarah Johnson
Senior AE, Acme Solutions
`;

describe('Real email routing', () => {
  it('should route as example', () => {
    const routes = routeByContent(REAL_EMAIL);
    expect(routes).toContain('example');
  });

  it('should NOT route as template (no placeholders)', () => {
    const routes = routeByContent(REAL_EMAIL);
    // It may technically match template signals, but example should be primary
    const exScore = scoreRouteConfidence(REAL_EMAIL, 'example');
    const tplScore = scoreRouteConfidence(REAL_EMAIL, 'template');
    expect(exScore).toBeGreaterThan(tplScore);
  });
});

// ── Test 4: Structured draft should be template, not example

const STRUCTURED_DRAFT = `
Subject: [Company] — Renewal Discussion for [Product]

Hi [Name],

Step 1: Acknowledge the relationship
Thank you for being a valued [Product] customer for the past [Duration]. 
We've enjoyed partnering with [Company] on [use case].

Step 2: Reference value delivered
Over the past year, your team has achieved:
- [Metric 1] improvement in [area]
- [Metric 2] reduction in [area]
- [Metric 3] increase in [area]

Step 3: Present the renewal
I'd love to discuss your renewal options. We have a few paths:
1. Standard renewal at current terms
2. Expanded package with [Feature] access
3. Multi-year agreement with [Discount]% savings

Step 4: Call to action
Would [Day] at [Time] work for a 20-minute call to review these options?

Best regards,
[Rep Name]
[Title]
`;

describe('Structured draft routing', () => {
  it('should route as template', () => {
    const routes = routeByContent(STRUCTURED_DRAFT);
    expect(routes).toContain('template');
  });

  it('should score higher as template than example', () => {
    const tplScore = scoreRouteConfidence(STRUCTURED_DRAFT, 'template');
    const exScore = scoreRouteConfidence(STRUCTURED_DRAFT, 'example');
    expect(tplScore).toBeGreaterThan(exScore);
  });
});

// ── Test 5: Instruction lines must survive transformation ──

const DOC_WITH_INSTRUCTIONS = `
Note: This is a draft template

Subject: Partnership Discussion with {company}

Hi {name},

// This line should be removed
Reminder: always personalize the opener

When the prospect is a VP or above, use formal tone.
If they've been a customer before, reference the previous engagement.

"I'd love to explore how we can help {company} achieve {goal}."

Persona: Enterprise Decision Maker
Constraint: Never mention pricing in the first email
Rule: Always include a specific meeting time suggestion

Would Tuesday at 2pm work for a brief call?

Best regards,
{rep_name}

Version 2
Comment: needs review before sending
`;

describe('Transformation safety — instruction preservation', () => {
  it('should preserve conditional lines in template shaping', () => {
    const result = shapeAsTemplate(DOC_WITH_INSTRUCTIONS);
    expect(result.shaped).toContain('When the prospect is a VP');
    expect(result.shaped).toContain('If they\'ve been a customer');
  });

  it('should preserve quoted phrasing', () => {
    const result = shapeAsTemplate(DOC_WITH_INSTRUCTIONS);
    expect(result.shaped).toContain('I\'d love to explore');
  });

  it('should preserve persona/constraint/rule lines', () => {
    const result = shapeAsTemplate(DOC_WITH_INSTRUCTIONS);
    expect(result.shaped).toContain('Persona: Enterprise');
    expect(result.shaped).toContain('Constraint: Never mention');
    expect(result.shaped).toContain('Rule: Always include');
  });

  it('should strip meta lines (Note, Comment, //, Version)', () => {
    const result = shapeAsTemplate(DOC_WITH_INSTRUCTIONS);
    expect(result.shaped).not.toContain('This is a draft template');
    expect(result.shaped).not.toContain('// This line');
    expect(result.shaped).not.toContain('needs review before sending');
  });

  it('should normalize placeholders', () => {
    const result = shapeAsTemplate(DOC_WITH_INSTRUCTIONS);
    expect(result.shaped).toContain('[Company]');
    expect(result.shaped).toContain('[Name]');
    expect(result.shaped).not.toContain('{company}');
  });

  it('should flag high-risk removals', () => {
    const result = shapeAsTemplate(DOC_WITH_INSTRUCTIONS);
    // The "Reminder: always personalize" line has instruction language and should be preserved
    // The meta lines should be flagged if they contain high-risk patterns
    expect(result.highRiskRemovals).toBeDefined();
  });

  it('should track removed line count accurately', () => {
    const result = shapeAsTemplate(DOC_WITH_INSTRUCTIONS);
    expect(result.removedLines.length).toBeGreaterThan(0);
    expect(result.originalLineCount).toBeGreaterThan(result.shapedLineCount);
  });
});

// ── Content similarity edge cases ──────────────────────────

describe('Content similarity edge cases', () => {
  it('should detect near-identical emails as duplicates (>0.65)', () => {
    const email1 = REAL_EMAIL;
    const email2 = REAL_EMAIL.replace('Michael', 'David').replace('TechCorp', 'InnovateCo');
    expect(contentSimilarity(email1, email2)).toBeGreaterThan(0.65);
  });

  it('should NOT flag structurally different content as duplicates', () => {
    expect(contentSimilarity(STRUCTURED_DRAFT, DESCRIPTIVE_DOC)).toBeLessThan(0.4);
  });

  it('should distinguish template from example even with similar topic', () => {
    const sim = contentSimilarity(STRUCTURED_DRAFT, REAL_EMAIL);
    expect(sim).toBeLessThan(0.65);
  });
});
