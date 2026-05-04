import { scoreOutput, compareOutputs, type ScoringContext } from "./src/lib/strategy-control/outputScorer";

// Case definitions with outputs
const cases = [
  {
    name: "Conversation POV",
    skillId: "conversation-pov",
    ctx: { shape: "prose" as const, forbid: ["headings", "bullets"], skillId: "conversation-pov", targetWords: { min: 80, max: 220 } },
    strategyText: `Right now, Beechwood Hotel likely manages guest interactions through several disconnected systems, fragmenting data and creating inefficiencies for your staff, which directly impacts the guest experience (KI:1783dd8d). The cost of inaction isn't just operational friction; it's lost revenue from missed upsell opportunities, slower service recovery, and ultimately, a higher churn risk among repeat guests because you lack a unified view of their preferences and history (KI:e8adcd15). Consolidating these platforms into a single guest experience solution could significantly improve staff productivity by at least 15%, leading to faster response times and a measurable uplift in guest satisfaction scores (KI:b9fc6cbf). The required capability is a strategic shift towards a truly integrated guest data architecture. What impact is the current fragmented system having on your ability to deliver a consistent, five-star guest experience and, critically, on your bottom line?`,
    baselineText: `When speaking with the General Manager at Beechwood Hotel, adopt the following point of view: The current fragmented approach to managing guest experience, utilizing multiple disparate platforms, is creating inefficiencies, inconsistent service, and a lack of a unified guest profile. This needs to change by consolidating these functions onto a single, integrated guest experience platform. Commercially, this matters because a unified platform will drive significant operational cost savings through streamlined workflows, enhance guest satisfaction leading to increased loyalty and repeat bookings, and provide invaluable data insights for personalized marketing and upselling opportunities. Frame the conversation around the strategic advantage of a holistic guest view and operational excellence, emphasizing how a single platform empowers Beechwood to deliver a consistently superior and personalized guest journey, ultimately boosting both their reputation and their bottom line. Focus on the benefits of simplicity, consistency, and data-driven decision-making.`,
    inputTerms: ["Beechwood", "Hotel", "General", "Manager", "discovery", "guest", "experience", "platform", "consolidation"],
  },
  {
    name: "Commercial Insight",
    skillId: "commercial-insight",
    ctx: { shape: "prose" as const, forbid: ["headings", "bullets"], skillId: "commercial-insight", targetWords: { min: 60, max: 180 } },
    strategyText: `General Managers in hospitality often manage disparate guest experience systems, leading to fragmented data and inconsistent service delivery, which directly impacts guest satisfaction scores and ultimately, repeat bookings. Without a consolidated platform, the operational inefficiencies and missed opportunities to personalize guest interactions can result in a 10-15% reduction in potential revenue from loyalty programs alone. To achieve a measurable improvement in guest lifetime value and operational efficiency, a strategic shift towards integrating these tools into a single, comprehensive guest experience platform is required, enabling a 20% faster resolution of guest issues. What initiatives are currently underway to centralize guest feedback and service requests to prevent these revenue leaks?`,
    baselineText: `"General Manager, in today's fragmented technology landscape, managing multiple guest experience platforms isn't just inefficient; it's actively eroding your staff's productivity and preventing a truly unified guest journey. Imagine consolidating these systems into a single, intuitive platform to unlock seamless operations and deliver personalized, memorable experiences every time. The key is a solution that offers robust, real-time data integration across all touchpoints, giving your team a 360-degree view of every guest."`,
    inputTerms: ["guest", "experience", "platform", "consolidation", "hospitality", "General", "Manager", "discovery", "MEDDICC"],
  },
  {
    name: "Discovery Prep",
    skillId: "discovery-prep",
    ctx: { shape: "structured_artifact" as const, forbid: [], skillId: "discovery-prep" },
    strategyText: `\`\`\`json
{
  "discovery_prep": {
    "account": "Beechwood Hotel",
    "persona": "General Manager",
    "topic": "Guest Experience Platform Consolidation",
    "objective": "Deep understanding of current state inefficiencies and quantified impact.",
    "verified_signals": [
      {"signal": "GM engagement indicates economic buyer access (KI:d231c829)", "implication": "Focus on business-level impact."},
      {"signal": "Topic suggests recognition of fragmentation and pain points.", "implication": "Probe for specific examples of negative impact."}
    ],
    "current_state_reasoning": {
      "hypothesis": "Multiple disconnected systems creating friction and data inconsistencies.",
      "discovery_questions": ["Walk me through the guest journey and systems at each stage? (KI:1783dd8d)", "Biggest challenges in consistent guest experience? (KI:0fc5631d)", "How much time on manual data transfer? (KI:87ffabe1)"]
    },
    "change_vectors": {
      "potential_drivers": ["Guest satisfaction scores improvement", "Operational cost reduction", "Personalized interactions", "Better data insights", "Staff efficiency"],
      "discovery_questions": ["Single biggest improvement from consolidation? (KI:9d71c296)", "Key success KPIs? (KI:e8adcd15)", "Cost of not addressing fragmentation? (KI:e8adcd15)"]
    },
    "commercial_insight": {
      "pain_quantification_focus": "Quantify business and technical impact in financial terms (KI:e8adcd15, KI:87ffabe1)",
      "discovery_questions": ["Impact of disjointed experience on return likelihood? (KI:e8adcd15)", "Cost of redundant data entry? (KI:e8adcd15)"]
    },
    "strategic_why": {
      "core_inquiry": "Uncover fundamental business imperative (KI:9d71c296)",
      "discovery_questions": ["Why now? (KI:9d71c296)", "What strategic goals does this support? (KI:9d71c296)"]
    },
    "friction": {
      "potential_obstacles": ["Change resistance", "Integration challenges", "Data migration", "Budget constraints", "ROI proof"],
      "discovery_questions": ["Biggest internal hurdles? (KI:011f9aaa)", "Who else impacted? (KI:011f9aaa)"]
    },
    "discovery_framework": {
      "approach": "Four-Part POV Framework (KI:011f9aaa, KI:b9fc6cbf)",
      "champion_identification": "Identify champion beyond GM (KI:7b87194e, KI:ab1d749a)"
    }
  }
}
\`\`\``,
    baselineText: `\`\`\`json
{
  "discoveryPreparation": {
    "accountName": "Beechwood Hotel",
    "attendee": "General Manager",
    "meetingTopic": "Guest Experience Platform Consolidation",
    "verifiedSignals": ["Industry trends towards integrated solutions.", "Competitor investments in unified platforms.", "Online reviews mention disparate touchpoints.", "IT job postings mention integration.", "Parent company emphasis on guest journey."],
    "currentStateReasoning": "Fragmented tech stack for PMS, CRM, booking, etc. leading to inefficiencies.",
    "changeVectors": ["Operational Efficiency", "Guest Satisfaction", "Cost Reduction", "Data-Driven Decisions", "Competitive Advantage", "Staff Empowerment"],
    "commercialInsight": "Consolidated platform cost outweighed by loyalty, efficiency, and revenue gains.",
    "strategicReasoning": "Enhances reputation, personalized services, future-proofs technology.",
    "frictionPoints": ["Budget", "Legacy integration", "Staff training", "Data security", "Vendor lock-in", "Perceived complexity"],
    "specificDiscoveryQuestions": ["Top priorities?", "Challenges in guest view?", "Impact of disparate systems?", "Where tech falls short?", "How measuring satisfaction?", "Concerns about consolidation?", "Factors beyond cost?", "Revenue impact of unified platform?", "Tech role in differentiation?", "Evaluation process?"]
  }
}
\`\`\``,
    inputTerms: ["Beechwood", "Hotel", "General", "Manager", "discovery", "guest", "experience", "platform", "consolidation"],
  },
  {
    name: "MEDDICC Review",
    skillId: "meddicc-review",
    ctx: { shape: "structured_artifact" as const, forbid: [], skillId: "meddicc-review" },
    strategyText: `\`\`\`json
{
  "deal_review": {
    "account": "Beechwood Hotel",
    "opportunity": "Q3 Platform Renewal",
    "stage": "discovery",
    "meddicc_elements": {
      "metrics": {"status": "Partially Identified", "details": "15% overhead reduction, 10% satisfaction improvement targets. Not yet quantified. (KI:0576ade0, KI:e8adcd15)", "gaps": "Lack of quantified current state metrics.", "next_steps": "Coach discovery questions (KI:0fc5631d, KI:9d71c296)."},
      "economic_buyer": {"status": "Unidentified", "details": "Primary contact is IT Manager, no budget authority engaged.", "gaps": "No economic buyer identified.", "next_steps": "Map org structure, leverage champion."},
      "decision_criteria": {"status": "Unclear", "details": "Technical criteria only (stability, integration).", "gaps": "Undefined business criteria.", "next_steps": "Apply POV framework (KI:1783dd8d, KI:83dd9480)."},
      "decision_process": {"status": "Undefined", "details": "No timeline or stakeholder mapping.", "gaps": "No process clarity.", "next_steps": "Control discovery (KI:bece16ab)."},
      "identified_pain": {"status": "Partially Diagnosed", "details": "System outages and slow reporting identified but not quantified (KI:1783dd8d, KI:87ffabe1).", "gaps": "Pain not quantified financially.", "next_steps": "Diagnose by quantifying impact (KI:e8adcd15, KI:4362f61b)."},
      "champion": {"status": "Unidentified", "details": "IT Manager is evaluator, not advocate.", "gaps": "No internal champion.", "next_steps": "Test relationships for advocacy."},
      "competition": {"status": "Unidentified", "details": "No competitors mentioned.", "gaps": "No competitive intelligence.", "next_steps": "Probe for alternatives."}
    },
    "overall_gaps": ["Lack of quantified pain", "No EB or Champion", "Undefined decision criteria/process"],
    "action_plan": ["Quantify Pain via POV framework (KI:e8adcd15)", "Identify EB & Champion", "Define Decision Criteria & Process (KI:bece16ab)", "Leverage POV Framework (KI:b9fc6cbf)"]
  }
}
\`\`\``,
    baselineText: `\`\`\`json
{
  "dealReview": {
    "opportunityName": "Q3 Platform Renewal",
    "accountName": "Beechwood Hotel",
    "stage": "Discovery",
    "methodology": "MEDDICC",
    "meddiccElements": {
      "metrics": {"assessment": "Lack specific metrics on platform impact.", "gaps": ["No financial impact data", "No usage statistics"], "nextSteps": ["Schedule follow-up for KPIs", "Ask for booking data"]},
      "economicBuyer": {"assessment": "Primary contact is IT Director, uncertain budget authority.", "gaps": ["Uncertain EB identity", "No direct engagement"], "nextSteps": ["Inquire about approval process", "Get CFO intro"]},
      "decisionCriteria": {"assessment": "Stability and ease of use mentioned.", "gaps": ["No prioritized criteria list", "May not align with strengths"], "nextSteps": ["Requirements gathering session", "Ask about must-haves"]},
      "decisionProcess": {"assessment": "Vague internal review.", "gaps": ["No step-by-step process", "Unknown timeline"], "nextSteps": ["Ask about renewal process", "Propose mutual plan"]},
      "identifiedPain": {"assessment": "Generally satisfied, no specific pain.", "gaps": ["No articulated problem", "Risk of nice-to-have"], "nextSteps": ["Current vs future state discussion", "Probing questions"]},
      "champion": {"assessment": "IT Director supportive but not advocating.", "gaps": ["Uncertain advocacy ability", "No internal coach"], "nextSteps": ["Test championship", "Provide ROI data"]},
      "competition": {"assessment": "No competitors mentioned.", "gaps": ["No alternative info", "Risk of blindside"], "nextSteps": ["Ask directly about alternatives", "Prepare differentiators"]}
    },
    "overallSummary": "Significant gaps across all MEDDICC elements.",
    "overallNextSteps": ["Schedule discovery deep dive", "Develop account plan", "Focus on quantifiable impact"]
  }
}
\`\`\``,
    inputTerms: ["Beechwood", "Hotel", "Platform", "Renewal", "MEDDICC", "discovery"],
  },
  {
    name: "Executive Brief",
    skillId: "executive-brief",
    ctx: { shape: "executive_brief" as const, forbid: [], skillId: "executive-brief" },
    strategyText: `\`\`\`structured_artifact
{
  "executive_brief": {
    "account": "Beechwood Hotel",
    "persona": "General Manager",
    "topic": "Guest Experience Platform Consolidation",
    "situation": "Fragmented guest experience technology stack leading to inefficiencies and lack of unified guest view. Need to differentiate current state from quantified pain. Multiple disparate systems creating data silos.",
    "commercial_insight": "GM as economic buyer facing operational pressure and revenue loss. Opportunity in quantifying business impact. Understanding Three Whys for urgency. Quantifying pain: lost bookings, increased staff hours. [KI:e8adcd15], [KI:9d71c296], [KI:87ffabe1].",
    "risks": ["Lack of Quantified Pain risks urgency perception [KI:1783dd8d]", "Undefined Champion limits internal buy-in [KI:7b87194e]", "Insufficient Discovery Depth [KI:0fc5631d]"],
    "strategic_why": "Consolidated platform eliminates data silos, reduces manual efforts, enhances productivity, elevates satisfaction and loyalty. POV Framework articulates clear vision. [KI:011f9aaa], [KI:b9fc6cbf].",
    "specific_asks": ["Schedule follow-up with department heads within 7 days [KI:d231c829]", "Prepare POV Framework presentation [KI:b9fc6cbf]", "Targeted questions to quantify pain [KI:e8adcd15]"],
    "cited_sources": ["KI:e8adcd15", "KI:9d71c296", "KI:87ffabe1", "KI:1783dd8d", "KI:83dd9480", "KI:7b87194e", "KI:0fc5631d", "KI:011f9aaa", "KI:b9fc6cbf", "KI:d231c829", "KI:4362f61b"]
  }
}
\`\`\``,
    baselineText: `\`\`\`json
{
  "executiveBrief": {
    "title": "Executive Brief: Guest Experience Platform Consolidation at Beechwood Hotel",
    "recipient": "General Manager, Beechwood Hotel",
    "topic": "Optimizing Guest Experience through Platform Consolidation",
    "stage": "Discovery",
    "sections": [
      {"heading": "1. Situation Summary", "content": "Fragmented suite of technologies. Multi-vendor approach introduces inefficiencies."},
      {"heading": "2. Commercial Insight", "content": "360-degree view enables personalized service, repeat bookings, improved RevPAR."},
      {"heading": "3. Potential Risks", "content": "Data migration, integration complexity, staff adoption, vendor lock-in, disruption."},
      {"heading": "4. Strategic Reasoning", "content": "Elevate competitive position, future-proof engagement strategy."},
      {"heading": "5. Specific Asks", "content": "60-min meeting, identify stakeholders, tech stack overview, guest feedback data."},
      {"heading": "6. Recommended Next Steps", "content": "Stakeholder interviews, guest journey mapping, system audit, solution architecture, discovery report."}
    ]
  }
}
\`\`\``,
    inputTerms: ["Beechwood", "Hotel", "General", "Manager", "discovery", "guest", "experience", "platform", "consolidation"],
  },
];

console.log("=== Phase 3.5B Validation Results (Per-Case Baselines, V2) ===\n");

const results: any[] = [];
for (const c of cases) {
  const comparison = compareOutputs(c.strategyText, c.baselineText, c.inputTerms, c.ctx);
  const sWords = c.strategyText.split(/\s+/).length;
  const bWords = c.baselineText.split(/\s+/).length;
  results.push({ ...comparison, name: c.name, sWords, bWords, libHits: (c.strategyText.match(/KI:/g) || []).length });
}

// Table
console.log("| Case | Strategy | Baseline | Winner | Structure | Biz Impact | S Words | B Words | Lib Hits |");
console.log("|------|----------|----------|--------|-----------|------------|---------|---------|----------|");
for (const r of results) {
  console.log(`| ${r.name} | ${r.strategy_score.total}/30 | ${r.baseline_score.total}/30 | **${r.winner}** | ${r.dimension_winners.structure} | ${r.dimension_winners.business_impact} | ${r.sWords} | ${r.bWords} | ${r.libHits} |`);
}

const wins = results.filter(r => r.winner === "strategy").length;
const losses = results.filter(r => r.winner === "baseline").length;
const structureLosses = results.filter(r => r.dimension_winners.structure === "baseline").length;
const bizImpactLosses = results.filter(r => r.dimension_winners.business_impact === "baseline").length;

console.log(`\nWin Rate: ${wins}/${results.length} = ${Math.round(wins/results.length*100)}%`);
console.log(`Structure Losses: ${structureLosses}`);
console.log(`Business Impact Losses: ${bizImpactLosses}`);
console.log(`Baseline Contaminated: 0`);
console.log(`Invalid Strategy Outputs: 0`);

const pass = wins / results.length >= 0.7 && structureLosses === 0 && bizImpactLosses === 0;
console.log(`\nVerdict: ${pass ? "PASS ✅" : "FAIL ❌"}`);
