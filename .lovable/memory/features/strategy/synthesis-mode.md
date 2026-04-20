---
name: Strategy Library-Grounded Modes (Synthesis / Creation / Evaluation) + Application Layer + Consistency Guard
description: Three resource-grounded intents in strategy-chat with mandatory Application Appendix AND a body↔appendix consistency guard that kills "appendix theater" by validating audience vocabulary, situation structure, and industry vocabulary in the body.
type: feature
---

# Strategy Library-Grounded Modes + Application Layer + Consistency Guard

All three modes live in `supabase/functions/strategy-chat/index.ts`. Pipeline:
intent classifier → forced `useCore=true` → pre-gen short-circuit on thin signal → mode-locked system prompt → **Application Layer appendix** → post-gen structural guard → **body↔appendix consistency guard** → one-shot strict regen on violation.

## Triggers, contracts, and short-circuit
See prior spec — synthesis (≥2 hits), creation (≥1 hit), evaluation (≥2 hits).
Output contracts unchanged: synthesis 5 sections, creation 4, evaluation 6, all + mandatory Application appendix.

## Application appendix (unchanged requirement)
`hasApplicationAppendix(text)` scans last ~1800 chars for `Application` header AND `Situation:` AND `Audience:` AND `Industry:`. Missing → `<intent>_missing_application_appendix` + regen.

## NEW: Body ↔ Appendix Consistency Guard

`enforceApplicationConsistency(text)` runs ONLY when the appendix exists. It parses the declared Situation / Audience / Industry, strips the appendix region, then validates the BODY against:

### Audience vocabulary (≥2 distinct hits required)
| Audience | Required signals (any ≥2) |
|---|---|
| CFO | roi, payback, cost of inaction, budget, margin, cash, downside, financial impact, $-figures, NPV/IRR, business case |
| Champion | internal sell, forwardable, proof point, narrative, buy-in, credibility, stakeholder alignment, political cover, talk track |
| VP Sales / CRO | pipeline, conversion, forecast, velocity, quota, win rate, stage progression, ramp, attainment, coverage |
| Procurement | contract, pricing, terms, vendor risk, approval, legal, MSA, redline, SLA |
| Technical buyer / CTO | integration, implementation, architecture, feasibility, deployment, technical risk, API, SSO, infrastructure |
| Founder / CEO | narrative, differentiation, strategic leverage, market position, moat, vision |
| Board | governance, strategic, risk, milestone, outcomes, capital |

Mismatch → `application_body_audience_mismatch` + regen.

### Situation structural shape
| Situation | Body requirement |
|---|---|
| Cold call | If wordCount > 350 → first ~600 chars must contain a hook ("reason for…", "30 seconds", "won't take", etc.) |
| Discovery | ≥2 questions OR explicit hypothesis language ("we think/believe/suspect", "our take") |
| Renewal | ≥2 hits across {retention, renew, expansion, upsell, churn, risk, consequence, usage, adoption, value realized} |
| Objection / pricing pushback | reframe ("flip", "I hear you", "here's why") OR rebuttal ("actually", "the data", "in fact") |
| Exec / board prep | ≥2 hits across {$, ROI, payback, outcome, consequence, P&L, margin, revenue, cost, risk} |

Mismatch → `application_body_situation_mismatch` + regen.

### Industry vocabulary (≥2 distinct hits required)
| Industry | Required signals |
|---|---|
| SaaS | ARR, churn, seats, expansion, payback, renewal, adoption, MRR |
| Healthcare | compliance, patient, auditab*, operational burden, regulat*, governance, HIPAA, clinical |
| Manufacturing | throughput, uptime, efficiency, waste, downtime, output, operational reliability, yield, OEE |
| Financial services | controls, regulatory, risk, governance, audit trail, compliance, SOX, Basel |
| Retail / ecommerce | conversion, basket, AOV, SKU, inventory, footfall, margin, GMV |

Mismatch → `application_body_industry_mismatch` + regen.

**SaaS-leak rule:** for non-SaaS declared industries (healthcare, manufacturing, finserv, retail), presence of `arr|mrr|churn|seats?` in the body is itself a mismatch (body still talking SaaS in spite of declared vertical).

### Generic-despite-context floor
If body wordCount > 120 AND ≥2 dimensions failed, also tag `application_body_generic_despite_context`.

## Violation tags surfaced in `[mode-lock]` logs
- `application_body_audience_mismatch`
- `application_body_situation_mismatch`
- `application_body_industry_mismatch`
- `application_body_generic_despite_context`
- `<intent>_missing_application_appendix` (existing)

## What this prevents
A response that writes a generic business case, slaps `Audience: CFO / Situation: Renewal / Industry: Healthcare` at the bottom, and adds 2-4 vague "tailored for…" bullets now FAILS verification because the body lacks CFO vocabulary, retention/expansion framing, and healthcare-specific language. The guard fires a strict one-shot regen with the violation tags visible in logs.
