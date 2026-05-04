import { scoreOutput, type ScoringContext } from "./src/lib/strategy-control/outputScorer";

// MEDDICC detailed scores
const medCtx: ScoringContext = { shape: "structured_artifact", forbid: [], skillId: "meddicc-review" };
const medS = scoreOutput(`\`\`\`json
{
  "deal_review": {
    "account": "Beechwood Hotel",
    "opportunity": "Q3 Platform Renewal",
    "stage": "discovery",
    "meddicc_elements": {
      "metrics": {"status": "Partially Identified", "details": "15% overhead reduction target (KI:0576ade0, KI:e8adcd15)", "gaps": "Lack of quantified metrics.", "next_steps": "Coach discovery (KI:0fc5631d)."},
      "economic_buyer": {"status": "Unidentified", "gaps": "No EB identified.", "next_steps": "Map org."},
      "decision_criteria": {"status": "Unclear", "gaps": "Technical only.", "next_steps": "POV framework (KI:1783dd8d)."},
      "decision_process": {"status": "Undefined", "gaps": "No process.", "next_steps": "Control discovery (KI:bece16ab)."},
      "identified_pain": {"status": "Partially Diagnosed", "details": "Outages and slow reporting (KI:1783dd8d, KI:87ffabe1).", "gaps": "Not quantified.", "next_steps": "Quantify (KI:e8adcd15)."},
      "champion": {"status": "Unidentified", "gaps": "No champion."},
      "competition": {"status": "Unidentified", "gaps": "No competitors."}
    },
    "overall_gaps": ["No quantified pain", "No EB or Champion", "Undefined process"],
    "action_plan": ["Quantify Pain (KI:e8adcd15)", "Identify EB & Champion", "Define Process (KI:bece16ab)", "POV Framework (KI:b9fc6cbf)"]
  }
}
\`\`\``, ["Beechwood", "Hotel", "Platform", "Renewal", "MEDDICC", "discovery"], medCtx);

const medB = scoreOutput(`\`\`\`json
{
  "dealReview": {
    "opportunityName": "Q3 Platform Renewal",
    "accountName": "Beechwood Hotel",
    "stage": "Discovery",
    "methodology": "MEDDICC",
    "meddiccElements": {
      "metrics": {"assessment": "Lack metrics.", "gaps": ["No financial data", "No usage stats"], "nextSteps": ["Schedule follow-up", "Ask for data"]},
      "economicBuyer": {"assessment": "IT Director, uncertain authority.", "gaps": ["Uncertain EB"], "nextSteps": ["Inquire approval"]},
      "decisionCriteria": {"assessment": "Stability mentioned.", "gaps": ["No prioritized list"], "nextSteps": ["Requirements gathering"]},
      "decisionProcess": {"assessment": "Vague review.", "gaps": ["No process"], "nextSteps": ["Ask about process"]},
      "identifiedPain": {"assessment": "Satisfied, no pain.", "gaps": ["No problem"], "nextSteps": ["Current vs future"]},
      "champion": {"assessment": "IT Director supportive.", "gaps": ["Uncertain advocacy"], "nextSteps": ["Test championship"]},
      "competition": {"assessment": "None mentioned.", "gaps": ["No info"], "nextSteps": ["Ask directly"]}
    },
    "overallSummary": "Significant gaps across all elements.",
    "overallNextSteps": ["Schedule deep dive", "Develop plan", "Focus on impact"]
  }
}
\`\`\``, ["Beechwood", "Hotel", "Platform", "Renewal", "MEDDICC", "discovery"], medCtx);

console.log("MEDDICC Strategy:", JSON.stringify(medS));
console.log("MEDDICC Baseline:", JSON.stringify(medB));

// Executive Brief structure check
const ebCtx: ScoringContext = { shape: "executive_brief", forbid: [], skillId: "executive-brief" };
const ebS = scoreOutput(`\`\`\`structured_artifact
{
  "executive_brief": {
    "account": "Beechwood Hotel",
    "persona": "General Manager",
    "topic": "Guest Experience Platform Consolidation",
    "situation": "Fragmented tech stack.",
    "commercial_insight": "GM facing pressure. [KI:e8adcd15].",
    "risks": ["Lack of Quantified Pain [KI:1783dd8d]", "Undefined Champion [KI:7b87194e]", "Insufficient Discovery [KI:0fc5631d]"],
    "strategic_why": "Consolidated platform benefits. [KI:011f9aaa].",
    "specific_asks": ["Schedule follow-up [KI:d231c829]", "Prepare POV [KI:b9fc6cbf]", "Targeted questions [KI:e8adcd15]"],
    "cited_sources": ["KI:e8adcd15", "KI:9d71c296", "KI:87ffabe1"]
  }
}
\`\`\``, ["Beechwood", "Hotel", "General", "Manager", "discovery", "guest", "experience", "platform", "consolidation"], ebCtx);

const ebB = scoreOutput(`\`\`\`json
{
  "executiveBrief": {
    "title": "Executive Brief",
    "recipient": "General Manager",
    "topic": "Platform Consolidation",
    "stage": "Discovery",
    "sections": [
      {"heading": "Situation Summary", "content": "Fragmented tech."},
      {"heading": "Commercial Insight", "content": "360-degree view."},
      {"heading": "Risks", "content": "Data migration, complexity."},
      {"heading": "Strategic Reasoning", "content": "Competitive position."},
      {"heading": "Specific Asks", "content": "60-min meeting."},
      {"heading": "Next Steps", "content": "Interviews, audit."}
    ]
  }
}
\`\`\``, ["Beechwood", "Hotel", "General", "Manager", "discovery", "guest", "experience", "platform", "consolidation"], ebCtx);

console.log("EB Strategy:", JSON.stringify(ebS));
console.log("EB Baseline:", JSON.stringify(ebB));
