/**
 * Phase 3.5B validation runner — edge function.
 * Calls run-strategy-eval-synthesis and clean-baseline for all 5 cases,
 * scores outputs, returns full validation table.
 * Authenticated via STRATEGY_VALIDATION_KEY header.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-validation-key",
};

interface Case {
  id: string;
  label: string;
  skillId: string;
  skill: Record<string, unknown>;
  baselinePrompt: string;
  baselineSystem: string;
  scoringShape: string;
  forbid?: string[];
  targetWords?: { min: number; max: number };
  mustHave?: string[];
  inputTerms: string[];
}

const CASES: Case[] = [
  {
    id: "conversation_pov",
    label: "Conversation POV",
    skillId: "conversation-pov",
    skill: {
      id: "conversation-pov",
      version: "1",
      inputs: { account: "Beechwood Hotel", persona: "General Manager", stage: "discovery", topic: "guest experience platform consolidation" },
    },
    baselinePrompt: "I'm preparing for a discovery conversation with General Manager at Beechwood Hotel. The topic is guest experience platform consolidation. Give me a concise, actionable point of view I can use in this conversation — including the current state, what needs to change, why it matters commercially, and how I should frame the conversation.",
    baselineSystem: "You are a helpful sales strategy assistant. Answer the user's question with actionable, specific advice. Do not reference any internal library, playbook, or proprietary methodology. Use only general sales knowledge.\n\nOutput constraints:\n- Write your response as continuous prose paragraphs.\n- Do NOT use headings (no # or bold section titles).\n- Do NOT use bullet points or numbered lists.\n- Keep your response between 80 and 150 words.",
    scoringShape: "prose",
    forbid: ["headings", "bullets"],
    targetWords: { min: 80, max: 150 },
    mustHave: ["current state", "cost or risk", "change hypothesis", "open question"],
    inputTerms: ["Beechwood", "Hotel", "guest", "experience", "platform", "consolidation", "General", "Manager", "discovery"],
  },
  {
    id: "commercial_insight",
    label: "Commercial Insight",
    skillId: "commercial-insight",
    skill: {
      id: "commercial-insight",
      version: "1",
      inputs: { topic: "guest experience platform consolidation", industry: "hospitality", persona: "General Manager", stage: "discovery", methodology: "MEDDICC" },
    },
    baselinePrompt: "I need a sharp commercial insight about guest experience platform consolidation for General Manager in the hospitality industry during the discovery stage. The insight should name the current state, a negative consequence of inaction, the desired outcome, and a specific capability needed — compressed into a single usable talking point.",
    baselineSystem: "You are a helpful sales strategy assistant. Answer the user's question with actionable, specific advice. Do not reference any internal library, playbook, or proprietary methodology. Use only general sales knowledge.\n\nOutput constraints:\n- Write your response as continuous prose paragraphs.\n- Do NOT use headings (no # or bold section titles).\n- Do NOT use bullet points or numbered lists.\n- Keep your response between 100 and 200 words.",
    scoringShape: "prose",
    forbid: ["headings", "bullets"],
    targetWords: { min: 100, max: 200 },
    mustHave: ["insight", "commercial impact", "supporting evidence"],
    inputTerms: ["guest", "experience", "platform", "consolidation", "hospitality", "General", "Manager", "discovery", "MEDDICC"],
  },
  {
    id: "discovery_prep",
    label: "Discovery Prep",
    skillId: "discovery-prep",
    skill: {
      id: "discovery-prep",
      version: "1",
      inputs: { account: "Beechwood Hotel", persona: "General Manager", stage: "discovery", topic: "guest experience platform consolidation" },
    },
    baselinePrompt: "Prepare a full discovery preparation artifact for a meeting with General Manager at Beechwood Hotel during the discovery stage. The topic is guest experience platform consolidation. Include: verified signals about the account, current state reasoning, change vectors, commercial insight, strategic reasoning, friction points, and specific discovery questions.",
    baselineSystem: "You are a helpful sales strategy assistant. Answer the user's question with actionable, specific advice. Do not reference any internal library, playbook, or proprietary methodology. Use only general sales knowledge.\n\nOutput constraints:\n- Return your response as a well-structured JSON object with semantically meaningful keys.\n- Keep your response between 200 and 400 words.",
    scoringShape: "structured_artifact",
    targetWords: { min: 200, max: 400 },
    mustHave: ["current state", "discovery questions", "risks", "next steps"],
    inputTerms: ["Beechwood", "Hotel", "guest", "experience", "platform", "consolidation", "General", "Manager", "discovery"],
  },
  {
    id: "meddicc_review",
    label: "MEDDICC Review",
    skillId: "meddicc-review",
    skill: {
      id: "meddicc-review",
      version: "1",
      inputs: { account: "Beechwood Hotel", opportunity: "Q3 Platform Renewal", methodology: "MEDDICC", stage: "discovery" },
    },
    baselinePrompt: "Conduct a MEDDICC deal review for the Q3 Platform Renewal opportunity at Beechwood Hotel using MEDDICC methodology in the discovery stage. Assess each MEDDICC element: Metrics, Economic Buyer, Decision Criteria, Decision Process, Identified Pain, Champion, and Competition. Identify gaps and recommend next steps.",
    baselineSystem: "You are a helpful sales strategy assistant. Answer the user's question with actionable, specific advice. Do not reference any internal library, playbook, or proprietary methodology. Use only general sales knowledge.\n\nOutput constraints:\n- Return your response as a well-structured JSON object with semantically meaningful keys.\n- Keep your response between 200 and 400 words.",
    scoringShape: "structured_artifact",
    targetWords: { min: 200, max: 400 },
    mustHave: ["metrics", "economic buyer", "decision criteria", "decision process", "identified pain", "champion", "competition", "gaps named"],
    inputTerms: ["Beechwood", "Hotel", "MEDDICC", "Q3", "Platform", "Renewal", "discovery"],
  },
  {
    id: "executive_brief",
    label: "Executive Brief",
    skillId: "executive-brief",
    skill: {
      id: "executive-brief",
      version: "1",
      inputs: { account: "Beechwood Hotel", persona: "General Manager", stage: "discovery", topic: "guest experience platform consolidation" },
    },
    baselinePrompt: "Create an executive brief for Beechwood Hotel focused on General Manager during the discovery stage. Topic: guest experience platform consolidation. Include: situation summary, commercial insight, risks, strategic reasoning, specific asks, and recommended next steps.",
    baselineSystem: "You are a helpful sales strategy assistant. Answer the user's question with actionable, specific advice. Do not reference any internal library, playbook, or proprietary methodology. Use only general sales knowledge.\n\nOutput constraints:\n- Return your response as a well-structured JSON object with semantically meaningful keys.\n- Keep your response between 200 and 500 words.",
    scoringShape: "executive_brief",
    targetWords: { min: 200, max: 500 },
    mustHave: ["decision thesis", "risk of delay", "commercial stakes", "recommended action", "seller next move", "objection", "proof"],
    inputTerms: ["Beechwood", "Hotel", "guest", "experience", "platform", "consolidation", "General", "Manager", "discovery"],
  },
];

// ── Scorer (inline from outputScorer.ts for Deno compat) ──

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length;
}
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
function isJsonLike(text: string): boolean {
  const t = text.trim();
  return t.startsWith("{") || t.startsWith("[") || t.includes("```json") || t.includes("```structured_artifact");
}
function extractJsonContent(text: string): string {
  const fenceMatch = text.match(/```(?:json|structured_artifact)\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1];
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) return t;
  return "";
}

function scoreSpecificity(text: string): number {
  const words = text.split(/\s+/).length;
  if (words < 10) return 1;
  const numbers = countMatches(text, /\b\d[\d,.]*%?\b/g);
  const properNouns = countMatches(text, /(?<=[.!?]\s+|^)[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/gm);
  const quotedTerms = countMatches(text, /"[^"]{2,}"/g);
  const GENERIC = [/\bleverage\b/gi, /\bbest practices?\b/gi, /\bsynerg/gi, /\bholistic\b/gi, /\bscalable\b/gi, /\binnovative\b/gi, /\bworld[- ]class\b/gi, /\bcutting[- ]edge\b/gi, /\bgame[- ]changer\b/gi, /\bbuild rapport\b/gi, /\badd value\b/gi, /\bunderstand their needs\b/gi, /\bkey stakeholders?\b/gi, /\bmove the needle\b/gi];
  const genericCount = GENERIC.reduce((n, p) => n + countMatches(text, p), 0);
  const concreteSignal = numbers + properNouns * 0.5 + quotedTerms;
  const densityPer100 = (concreteSignal / words) * 100;
  let score = 2;
  if (densityPer100 > 3) score = 4;
  else if (densityPer100 > 1.5) score = 3;
  if (genericCount > 3) score -= 1;
  if (genericCount === 0 && concreteSignal > 5) score += 1;
  return clamp(score, 1, 5);
}

function scoreActionability(text: string, shape?: string): number {
  const imperatives = countMatches(text, /(?:^|\n|•|[-*])\s*(?:Ask|Propose|Send|Schedule|Confirm|Validate|Map|Identify|Prepare|Draft|Review|Challenge|Test|Open|Frame|Position|Present|Quantify|Document|Follow[- ]up)\b/gi);
  const nextSteps = countMatches(text, /\b(?:next step|action item|to[- ]do|follow[- ]up|recommendation)\b/gi);
  const questions = countMatches(text, /\?/g);
  let signals = imperatives + nextSteps * 1.5 + questions * 0.5;
  const embeddedActions = countMatches(text, /\b(?:should|must|need to|recommend|ensure|prioritize|leverage|execute|implement|deploy|establish|secure|drive|accelerate|align|address|mitigate|explore|investigate|pursue|negotiate|articulate)\b/gi);
  signals += embeddedActions * 0.3;
  if (shape === "structured_artifact" || shape === "list" || isJsonLike(text)) {
    const jsonContent = extractJsonContent(text);
    const lower = (jsonContent || text).toLowerCase();
    const actionFields = countMatches(lower, /["'](?:next_steps?|recommendations?|specific_asks?|action_items?|gaps?|risks?|questions_to_ask|discovery_questions|follow_ups?)["']\s*:/g);
    signals += actionFields * 2;
    const arrayItems = countMatches(text, /["'][^"']{10,}\?["']/g);
    signals += arrayItems * 0.5;
  }
  if (signals >= 6) return 5;
  if (signals >= 4) return 4;
  if (signals >= 2) return 3;
  if (signals >= 1) return 2;
  return 1;
}

function scoreStructureProse(text: string): number {
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).length;
  if (words < 10) return 1;

  // ── Business Spine Detection with ORDERING ─────────────────
  // A well-structured prose output follows: Context → Consequence → Insight → Action
  // We check both presence AND correct sequential ordering.
  const spinePhases: Array<{ label: string; pattern: RegExp }> = [
    { label: "context", pattern: /\b(?:current(?:ly)?|today|right now|existing|as of|at present|status quo|their (?:team|org|pipeline|process)|the (?:problem|challenge|situation|reality)|facing|experiencing|struggling|dealing with)\b/i },
    { label: "consequence", pattern: /\b(?:cost of|risk of|consequence|negative impact|result(?:ing) in|which (?:means|creates|causes|drives)|this (?:means|creates|causes|drives|leaves)|without this|if (?:not|they don't)|losing|missed|erosion|pressure|threat|exposure|vulnerability|at stake|delayed?)\b/i },
    { label: "insight", pattern: /\b(?:the (?:real|core|key|critical|fundamental) (?:issue|question|shift|opportunity)|what (?:this means|matters|changes)|the shift|the opportunity|our (?:view|position|thesis|pov|perspective)|the way forward|reframe|rethink|reconsider|the unlock|differentiat|insight is|the question isn't)\b/i },
    { label: "action", pattern: /\b(?:ask (?:them|their|the|about|whether|how|what|why)|propose|confirm whether|validate|test whether|open (?:with|by)|frame (?:the|this|around)|position|next step|start by|begin with|lead with|anchor on|the question to pose)\b/i },
  ];

  // Find first occurrence position for each phase
  const phasePositions: number[] = [];
  let spineHits = 0;
  for (const phase of spinePhases) {
    const match = lower.search(phase.pattern);
    phasePositions.push(match);
    if (match >= 0) spineHits++;
  }

  // Check ordering: each found phase should appear after the previous one
  let orderedCount = 0;
  let lastPos = -1;
  for (const pos of phasePositions) {
    if (pos > lastPos && pos >= 0) {
      orderedCount++;
      lastPos = pos;
    }
  }

  // Spine score: presence + ordering bonus
  let spineScore = 0;
  if (spineHits >= 4 && orderedCount >= 3) spineScore = 1.0;       // Full spine, mostly ordered
  else if (spineHits >= 3 && orderedCount >= 2) spineScore = 0.75;  // Strong spine
  else if (spineHits >= 3) spineScore = 0.6;                         // Present but disordered
  else if (spineHits >= 2) spineScore = 0.4;
  else if (spineHits >= 1) spineScore = 0.2;

  // ── Concrete Entity Density (structural differentiator) ────
  // Prose with named entities, numbers, and specific terms has
  // superior structure because it's grounded, not abstract.
  const numbers = countMatches(text, /\b\d[\d,.]*%?\b/g);
  const properNouns = countMatches(text, /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
  const quotedTerms = countMatches(text, /"[^"]{2,}"/g);
  const concreteSignals = numbers + properNouns * 0.5 + quotedTerms;
  const concretePer100 = (concreteSignals / words) * 100;
  let concreteBonus = 0;
  if (concretePer100 > 3) concreteBonus = 0.5;
  else if (concretePer100 > 1.5) concreteBonus = 0.25;

  // ── Generic Prose Penalty ──────────────────────────────────
  const GENERIC_PROSE = [/\bleverage\b/gi, /\bbest practices?\b/gi, /\bsynerg/gi, /\bholistic\b/gi, /\bscalable solution/gi, /\binnovative approach/gi, /\bworld[- ]class\b/gi, /\bin today'?s (?:landscape|environment|market)\b/gi, /\bstreamline (?:operations|processes)\b/gi, /\bdrive (?:growth|value|results)\b/gi, /\bkey stakeholders?\b/gi, /\bunlock (?:potential|value|growth)\b/gi];
  const genericHits = GENERIC_PROSE.reduce((n, p) => n + countMatches(text, p), 0);
  let genericPenalty = 0;
  if (genericHits >= 4) genericPenalty = 0.5;
  else if (genericHits >= 2) genericPenalty = 0.25;
  else if (genericHits >= 1) genericPenalty = 0.1;

  // ── Sentence Density (light signal) ────────────────────────
  const sentences = countMatches(text, /[.!?]\s/g) + 1;
  const avgWordsPerSentence = words / Math.max(sentences, 1);
  let density = 0;
  if (avgWordsPerSentence >= 10 && avgWordsPerSentence <= 30) density = 1;
  else if (avgWordsPerSentence >= 8 && avgWordsPerSentence <= 35) density = 0.5;

  // ── Transition Flow (minor, capped) ────────────────────────
  const transitions = countMatches(text, /\b(?:however|therefore|specifically|because|given that|as a result|in contrast|for example|notably|critically|importantly|furthermore|meanwhile|this means|in other words|by contrast|which means|leading to|ensuring|ultimately|although|yet|thus|hence|accordingly|consequently)\b/gi);
  let flow = 0;
  if (transitions >= 3) flow = 1;
  else if (transitions >= 1) flow = 0.5;

  // ── Weighted Sum ───────────────────────────────────────────
  // Spine (with ordering): 2.0 (dominant)
  // Concrete entities:     0.6 (structural grounding)
  // Density:               0.6 (readability)
  // Flow:                  0.3 (minor — cannot dominate)
  // Generic penalty:       subtracted
  const rawSum = spineScore * 2.0 + concreteBonus * 0.6 + density * 0.6 + flow * 0.3 - genericPenalty;

  let score: number;
  if (rawSum >= 2.6) score = 5;
  else if (rawSum >= 2.0) score = 4;
  else if (rawSum >= 1.4) score = 3;
  else if (rawSum >= 0.7) score = 2;
  else score = 1;
  return score;
}

function scoreJsonDepth(obj: unknown, depth = 0): number {
  if (depth > 5) return 5;
  if (obj === null || obj === undefined) return 1;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return 2;
    const maxChild = Math.max(...obj.map(item => scoreJsonDepth(item, depth + 1)));
    return clamp(Math.min(obj.length, 3) + maxChild - 1, 2, 5);
  }
  if (typeof obj === "object") {
    const keys = Object.keys(obj as Record<string, unknown>);
    if (keys.length === 0) return 2;
    if (keys.length === 1 && depth === 0) {
      const inner = (obj as Record<string, unknown>)[keys[0]];
      if (typeof inner === "object" && inner !== null && !Array.isArray(inner)) return scoreJsonDepth(inner, depth);
    }
    let score = 2;
    if (keys.length >= 5) score += 1;
    const nestedKeys = keys.filter(k => { const v = (obj as Record<string, unknown>)[k]; return typeof v === "object" && v !== null; });
    const hasNested = nestedKeys.length > 0;
    if (hasNested) score += 1;
    if (keys.length >= 7 && hasNested) score += 1;
    else if (hasNested) {
      const hasRichNesting = nestedKeys.some(k => {
        const v = (obj as Record<string, unknown>)[k];
        if (Array.isArray(v) && v.length >= 2) return true;
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          const ik = Object.keys(v as Record<string, unknown>);
          return ik.length >= 3 || ik.some(i => { const iv = (v as Record<string, unknown>)[i]; return typeof iv === "object" && iv !== null; });
        }
        return false;
      });
      if (hasRichNesting) score += 1;
    }
    return clamp(score, 2, 5);
  }
  return 2;
}

function scoreStructureMarkdown(text: string): number {
  const headings = countMatches(text, /^#+\s+.+$/gm) + countMatches(text, /^[A-Z][A-Z\s&]+:?\s*$/gm);
  const bullets = countMatches(text, /^[\s]*[-•*]\s+/gm);
  const numberedItems = countMatches(text, /^\s*\d+[.)]\s+/gm);
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;
  const structureSignals = headings * 2 + bullets + numberedItems + Math.min(paragraphs, 5);
  if (structureSignals >= 10) return 5;
  if (structureSignals >= 6) return 4;
  if (structureSignals >= 3) return 3;
  if (structureSignals >= 1) return 2;
  return 1;
}

function scoreCompleteness(text: string, mustHave?: string[]): number {
  if (!mustHave || mustHave.length === 0) return 5;
  const lower = text.toLowerCase();
  let jsonKeys: string[] = [];
  const jsonContent = extractJsonContent(text);
  if (jsonContent) {
    try {
      const parsed = JSON.parse(jsonContent);
      if (typeof parsed === "object" && parsed !== null) {
        const collectKeys = (obj: Record<string, unknown>, d: number): string[] => {
          if (d > 2) return [];
          const ks: string[] = [];
          for (const k of Object.keys(obj)) {
            ks.push(k.toLowerCase());
            const v = obj[k];
            if (typeof v === "object" && v !== null && !Array.isArray(v)) ks.push(...collectKeys(v as Record<string, unknown>, d + 1));
          }
          return ks;
        };
        jsonKeys = collectKeys(parsed as Record<string, unknown>, 0);
      }
    } catch { /* */ }
  }

  // Universal synonym map: concept → alternative phrases that prove presence
  const CONCEPT_SYNONYMS: Record<string, string[]> = {
    "decision thesis": ["decision", "thesis", "recommendation", "core argument", "central premise"],
    "risk of delay": ["risk", "delay", "cost of inaction", "cost of waiting", "urgency", "time pressure", "window closing"],
    "commercial stakes": ["commercial", "revenue impact", "financial impact", "business impact", "dollar", "pipeline", "quota"],
    "recommended action": ["recommend", "action plan", "next move", "proposed approach", "path forward"],
    "seller next move": ["seller", "next step", "follow-up", "call to action", "immediate action"],
    "objection": ["objection", "friction", "pushback", "concern", "resistance", "blocker", "obstacle"],
    "proof": ["proof", "evidence", "validation", "case study", "data point", "metric", "demonstrated"],
    "current state": ["current state", "current situation", "today", "as-is", "status quo", "right now"],
    "cost or risk": ["cost", "risk", "consequence", "impact", "threat", "exposure"],
    "change hypothesis": ["change", "hypothesis", "shift", "transformation", "opportunity", "thesis"],
    "open question": ["question", "ask", "discover", "explore", "probe", "inquire"],
    "insight": ["insight", "observation", "finding", "perspective", "point of view"],
    "commercial impact": ["commercial", "revenue", "financial", "business impact", "economic"],
    "supporting evidence": ["evidence", "data", "proof", "validation", "based on", "according to"],
    "discovery questions": ["question", "ask", "discover", "probe", "inquire", "what", "how", "why"],
    "risks": ["risk", "threat", "concern", "vulnerability", "exposure", "danger"],
    "next steps": ["next step", "action", "follow-up", "recommend", "plan"],
    "gaps named": ["gap", "missing", "unknown", "unclear", "need to confirm", "validate"],
  };

  let found = 0;
  for (const section of mustHave) {
    const sl = section.toLowerCase();
    const underscored = sl.replace(/\s+/g, "_");
    const words = sl.split(/\s+/).filter(w => w.length > 2); // skip short words like "of"
    // Match if: exact text, exact key, underscored key, or all significant words present
    const exactMatch = lower.includes(sl) || jsonKeys.includes(underscored) || jsonKeys.includes(sl);
    const wordMatch = words.length > 1 && words.every(w => lower.includes(w));
    const keyWordMatch = words.length > 1 && jsonKeys.some(k => words.every(w => k.includes(w)));
    // Synonym expansion: check if any synonym phrase appears
    const synonyms = CONCEPT_SYNONYMS[sl];
    const synonymMatch = synonyms ? synonyms.some(syn => lower.includes(syn)) : false;
    if (exactMatch || wordMatch || keyWordMatch || synonymMatch) found++;
  }
  const missing = mustHave.length - found;
  if (missing === 0) return 5;
  if (missing === 1) return 4;
  if (missing <= 3) return 3;
  if (missing <= mustHave.length - 1) return 2;
  return 1;
}

function scoreSectionLevelDepth(obj: unknown): number {
  if (typeof obj !== "object" || obj === null) return 0;
  let richSections = 0;
  const entries = Array.isArray(obj) ? obj : Object.values(obj as Record<string, unknown>);
  for (const val of entries) {
    if (Array.isArray(val) && val.length >= 2) richSections++;
    else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      const keys = Object.keys(val as Record<string, unknown>);
      if (keys.length >= 3) richSections++;
      for (const v of Object.values(val as Record<string, unknown>)) {
        if (Array.isArray(v) && v.length >= 2) richSections++;
      }
    }
  }
  return richSections >= 3 ? 1 : 0;
}

// ── Cross-Section Causality & Interconnection Detection ──────
// Differentiates deeply interconnected outputs from flat, isolated sections.
// Strategy produces: KI citations within values, nested reasoning, explicit
// cross-references. Baseline produces flat JSON with independent sections.
function scoreCrossSectionCausality(text: string): { hasCausality: boolean; score: number } {
  const lower = text.toLowerCase();
  let totalSignals = 0;

  const jsonContent = extractJsonContent(text);
  if (jsonContent) {
    try {
      const parsed = JSON.parse(jsonContent);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const fullText = JSON.stringify(parsed).toLowerCase();

        // Signal 1: Library citations embedded in structured output
        // Strategy grounds its sections with [KI:...] or "Knowledge Item" refs
        const embeddedCitations = countMatches(fullText, /\[ki:[a-f0-9]{4,}\]|ki-[a-f0-9]{4,}|\bknowledge item\b|\[pb:[a-f0-9]{4,}\]/gi);
        if (embeddedCitations >= 2) totalSignals += 3;
        else if (embeddedCitations >= 1) totalSignals += 1;

        // Signal 2: Deep nested reasoning — values are objects with 3+ keys
        // containing further nested objects or arrays with rich items
        let deepNestCount = 0;
        const checkDeep = (obj: Record<string, unknown>, d: number) => {
          if (d > 3) return;
          for (const v of Object.values(obj)) {
            if (typeof v === "object" && v !== null && !Array.isArray(v)) {
              const innerKeys = Object.keys(v as Record<string, unknown>);
              if (innerKeys.length >= 3) {
                deepNestCount++;
                checkDeep(v as Record<string, unknown>, d + 1);
              }
            }
            if (Array.isArray(v)) {
              for (const item of v) {
                if (typeof item === "object" && item !== null && !Array.isArray(item)) {
                  const ik = Object.keys(item as Record<string, unknown>);
                  if (ik.length >= 2) deepNestCount++;
                }
              }
            }
          }
        };
        checkDeep(parsed as Record<string, unknown>, 0);
        if (deepNestCount >= 4) totalSignals += 3;
        else if (deepNestCount >= 2) totalSignals += 2;
        else if (deepNestCount >= 1) totalSignals += 1;

        // Signal 3: Values contain explicit reasoning language
        // (not just labels/descriptions but causal explanations)
        const reasoningInValues = countMatches(fullText, /\b(?:because|therefore|which means|this creates|this drives|resulting in|leading to|if .{5,30} then|the consequence|this compounds|given that)\b/g);
        if (reasoningInValues >= 3) totalSignals += 2;
        else if (reasoningInValues >= 1) totalSignals += 1;
      }
    } catch { /* not valid JSON */ }
  }

  // ── Explicit cross-reference language (prose or JSON) ──────
  const explicitCausal = countMatches(lower, /\b(?:as identified|building on|given the .{3,40} above|this drives|which compounds|this connects to|per the .{3,30} analysis|based on .{3,40} identified)\b/g);
  totalSignals += Math.min(explicitCausal, 2);

  const hasCausality = totalSignals >= 4;
  let score = 0;
  if (totalSignals >= 6) score = 2;
  else if (totalSignals >= 4) score = 1;
  return { hasCausality, score };
}

function scoreStructure(text: string, shape: string, forbid?: string[], mustHave?: string[]): number {
  if (shape === "structured_artifact" || shape === "executive_brief") {
    let depthScore: number;
    if (isJsonLike(text)) {
      const jc = extractJsonContent(text);
      if (jc) { try { depthScore = scoreJsonDepth(JSON.parse(jc)); } catch { depthScore = scoreStructureMarkdown(text); } }
      else depthScore = scoreStructureMarkdown(text);
    } else depthScore = scoreStructureMarkdown(text);
    const completeness = scoreCompleteness(text, mustHave);

    // Section-level depth bonus
    let sectionDepthBonus = 0;
    const jsonContent = extractJsonContent(text);
    if (jsonContent) {
      try { const parsed = JSON.parse(jsonContent); if (typeof parsed === "object" && parsed !== null) sectionDepthBonus = scoreSectionLevelDepth(parsed); } catch { /* */ }
    }

    // 70% completeness, 30% depth
    const blended = Math.round(completeness * 0.7 + depthScore * 0.3);
    let finalScore = clamp(blended + sectionDepthBonus, 1, 5);
    if (mustHave && mustHave.length > 0 && completeness <= 3) finalScore = Math.min(finalScore, 4);

    // ── HARDENED 5/5 GATE ──────────────────────────────────────
    // A 5 requires cross-section interconnection — not just flat fields.
    // Flat JSON with independent sections → max 4.
    // Connected reasoning across sections → eligible for 5.
    if (finalScore >= 5) {
      const { hasCausality } = scoreCrossSectionCausality(text);
      if (!hasCausality) finalScore = 4;
    }

    return finalScore;
  }
  if (shape === "prose" && (forbid?.includes("headings") || forbid?.includes("bullets"))) return scoreStructureProse(text);
  if (shape === "list") { if (isJsonLike(text)) { const jc = extractJsonContent(text); if (jc) { try { return scoreJsonDepth(JSON.parse(jc)); } catch {} } } return scoreStructureMarkdown(text); }
  return scoreStructureMarkdown(text);
}

function scoreEvidence(text: string): number {
  const kiIdCitations = countMatches(text, /\[KI:[a-f0-9]{6,}\]/gi) + countMatches(text, /\bKI-[a-f0-9]{6,}\b/gi);
  const pbIdCitations = countMatches(text, /\[PB:[a-f0-9]{6,}\]/gi) + countMatches(text, /\bPB-[a-f0-9]{6,}\b/gi);
  const bracketCitations = countMatches(text, /\[(?:source|ref)[^\]]*\]/gi);
  const attributions = countMatches(text, /\b(?:according to|based on|per the|from the|as outlined in|as defined in|grounded in|informed by|drawn from)\b/gi);
  const kiExplicit = countMatches(text, /\bKnowledge Item\b/gi);
  const strongSignal = (kiIdCitations + pbIdCitations) * 3 + bracketCitations * 2;
  const moderateSignal = kiExplicit * 1.5 + attributions * 0.75;
  const total = strongSignal + moderateSignal;
  if (total >= 6) return 5;
  if (total >= 4) return 4;
  if (total >= 2) return 3;
  if (total >= 1) return 2;
  return 1;
}

function scoreRelevance(text: string, inputTerms: string[]): number {
  if (inputTerms.length === 0) return 3;
  const lower = text.toLowerCase();
  const matched = inputTerms.filter(t => t.length > 2 && lower.includes(t.toLowerCase()));
  const ratio = matched.length / inputTerms.length;
  if (ratio >= 0.8) return 5;
  if (ratio >= 0.6) return 4;
  if (ratio >= 0.4) return 3;
  if (ratio >= 0.2) return 2;
  return 1;
}

function scoreBusinessImpact(text: string, shape?: string): number {
  const lower = text.toLowerCase();
  const beforeState = countMatches(lower, /\b(?:current state|today|currently|existing|as[- ]is|before|status quo|right now|at present)\b/g);
  const negConsequences = countMatches(lower, /\b(?:risk|cost of (?:inaction|delay)|consequence|losing|churn|attrition|leakage|erosion|pain|problem|challenge|gap|miss(?:ed|ing)|threat|exposure|vulnerability|downside|failure)\b/g);
  const afterState = countMatches(lower, /\b(?:after|future state|ideal state|outcome|result|improvement|uplift|increase|growth|gain|benefit|advantage|opportunity|transform|achieve|goal|target|vision|aspiration)\b/g);
  const capabilities = countMatches(lower, /\b(?:require|capability|need|must have|essential|critical|prerequisite|enable|unlock|differentiat)/g);
  const metrics = countMatches(lower, /\b(?:roi|revenue|margin|cost|savings|efficiency|conversion|retention|ltv|lifetime value|arpu|aov|nrr|arr|mrr|pipeline|quota|close rate|win rate|cycle time|payback|irr)\b/g);
  const percentages = countMatches(text, /\d+(?:\.\d+)?%/g);
  const dollarAmounts = countMatches(text, /\$[\d,.]+[kKmMbB]?\b/g);
  const meddpicc = countMatches(lower, /\b(?:champion|economic buyer|decision criteria|decision process|identified pain|paper process|competition|metrics)\b/g);
  const valueFramework = countMatches(lower, /\b(?:make[- ]money|save[- ]money|reduce[- ]risk|value driver|business case|commercial insight|pov|point of view|hypothesis)\b/g);
  let artifactFieldBonus = 0;
  if (shape === "structured_artifact" || shape === "executive_brief" || shape === "list" || isJsonLike(text)) {
    const fps = [/["'](?:strategic_why|strategic_reasoning)["']\s*:/gi, /["'](?:commercial_insight|commercial_pov)["']\s*:/gi, /["'](?:change_vectors?|transformation_drivers?)["']\s*:/gi, /["'](?:risks?|risk_factors?)["']\s*:\s*[\[{]/gi, /["'](?:metrics|kpis?|measurements?)["']\s*:/gi, /["'](?:value|business_value|value_drivers?)["']\s*:/gi, /["'](?:business_case|justification)["']\s*:/gi, /["'](?:quantified_pain|pain_points?)["']\s*:/gi, /["'](?:current_state(?:_reasoning)?|before_state)["']\s*:/gi, /["'](?:negative_consequences?|cost_of_inaction)["']\s*:/gi];
    for (const p of fps) { if (p.test(text)) artifactFieldBonus += 1.5; }
  }
  const totalSignals = Math.min(beforeState, 3) * 1 + Math.min(negConsequences, 4) * 1.5 + Math.min(afterState, 4) * 1 + Math.min(capabilities, 3) * 1 + Math.min(metrics + percentages + dollarAmounts, 5) * 1.5 + Math.min(meddpicc, 4) * 1 + Math.min(valueFramework, 3) * 1 + artifactFieldBonus;

  let rawScore: number;
  if (totalSignals >= 15) rawScore = 5;
  else if (totalSignals >= 10) rawScore = 4;
  else if (totalSignals >= 5) rawScore = 3;
  else if (totalSignals >= 2) rawScore = 2;
  else rawScore = 1;

  // ── HARDENED 5/5 GATE ────────────────────────────────────────
  // A 5 requires:
  //   1. Causal chain: current state → consequence → financial impact → action
  //   2. Stakeholder-specific implication (not generic "improves efficiency")
  // Generic business value ("drives growth", "improves efficiency") → max 3
  if (rawScore >= 4) {
    // Check causal chain: must have at least 3 of 4 phases connected
    const hasCurrentState = beforeState >= 1;
    const hasConsequence = negConsequences >= 1;
    const hasFinancialImpact = (metrics + percentages + dollarAmounts) >= 1;
    const hasAction = countMatches(lower, /\b(?:ask|confirm|validate|propose|recommend|next step|action|should|must|need to|prioritize|address|mitigate|pursue)\b/g) >= 1;
    const causalPhases = [hasCurrentState, hasConsequence, hasFinancialImpact, hasAction].filter(Boolean).length;

    // Check stakeholder specificity: role must be TIED to a specific impact,
    // not just mentioned in isolation (baseline MEDDICC will mention "economic buyer" etc.)
    const stakeholderTiedToImpact = countMatches(lower, /\b(?:cfo|cto|cmo|coo|cio|ceo|vp of|director of|head of|manager|buyer|champion|economic buyer|decision maker|general manager|chief|owner|operator|leader|executive)[\s\S]{0,60}(?:\d+%|\$[\d,.]+|revenue|margin|cost|risk|loss|save|gain|budget|pipeline|quota|churn|retention)/g)
      + countMatches(lower, /(?:\d+%|\$[\d,.]+|revenue|margin|cost|risk|loss|save|gain|budget|pipeline|quota|churn|retention)[\s\S]{0,60}\b(?:cfo|cto|cmo|coo|cio|ceo|vp of|director of|head of|manager|buyer|champion|economic buyer|decision maker|general manager|chief|owner|operator)\b/g);
    const roleSpecificImpact = stakeholderTiedToImpact >= 1;

    // Generic value language penalty
    const genericValue = countMatches(lower, /\b(?:improve(?:s)? efficiency|drive(?:s)? growth|add(?:s)? value|increase(?:s)? productivity|optimize(?:s)? (?:operations|processes)|streamline(?:s)?|enhance(?:s)? performance|better outcomes?|maximize|deliver value)\b/g);
    const isGenericHeavy = genericValue >= 2 && (metrics + percentages + dollarAmounts) < 2;

    if (isGenericHeavy) {
      rawScore = Math.min(rawScore, 3);
    } else if (rawScore >= 5) {
      // For a 5: must have causal chain AND stakeholder specificity AND cross-section causality
      const { hasCausality } = scoreCrossSectionCausality(text);
      if (causalPhases < 3 || !roleSpecificImpact || !hasCausality) rawScore = 4;
    }
  }

  // ── Cross-section causality bonus (within cap) ─────────────
  if (rawScore >= 3 && rawScore < 5) {
    const { score: causalityScore } = scoreCrossSectionCausality(text);
    if (causalityScore >= 1) rawScore = Math.min(rawScore + 1, 5);
  }

  return rawScore;
}

interface Score {
  specificity: number; actionability: number; structure: number;
  evidence: number; relevance: number; business_impact: number;
  total: number;
}

function scoreOutput(text: string, inputTerms: string[], shape: string, forbid?: string[], mustHave?: string[], targetWords?: { min: number; max: number }): Score {
  if (!text || text.trim().length === 0) return { specificity: 1, actionability: 1, structure: 1, evidence: 1, relevance: 1, business_impact: 1, total: 6 };
  const specificity = scoreSpecificity(text);
  const actionability = scoreActionability(text, shape);
  const structure = scoreStructure(text, shape, forbid, mustHave);
  const evidence = scoreEvidence(text);
  const relevance = scoreRelevance(text, inputTerms);
  const business_impact = scoreBusinessImpact(text, shape);

  // Density penalty — BYPASSED for structured artifacts (length is a feature)
  let s = { specificity, actionability, structure, evidence, relevance, business_impact, total: 0 };
  if (targetWords?.max && shape !== "structured_artifact" && shape !== "executive_brief") {
    const wc = text.split(/\s+/).length;
    if (wc > targetWords.max * 1.5) {
      const penalty = clamp(Math.floor((wc / targetWords.max) / 2), 0, 2);
      if (penalty > 0) {
        s.specificity = clamp(s.specificity - penalty, 1, 5);
        s.actionability = clamp(s.actionability - penalty, 1, 5);
        s.evidence = clamp(s.evidence - penalty, 1, 5);
        s.relevance = clamp(s.relevance - penalty, 1, 5);
        s.business_impact = clamp(s.business_impact - penalty, 1, 5);
      }
    }
  }
  s.total = s.specificity + s.actionability + s.structure + s.evidence + s.relevance + s.business_impact;
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Temporary validation runner — no auth required. Will be deleted after Phase 3.5B.
  const url = new URL(req.url);
  const caseId = url.searchParams.get("case");
  const casesToRun = caseId ? CASES.filter(c => c.id === caseId) : CASES;

  if (casesToRun.length === 0) {
    return new Response(JSON.stringify({ error: `Unknown case: ${caseId}`, available: CASES.map(c => c.id) }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableKey = Deno.env.get("LOVABLE_API_KEY")!;
  const validationKey = Deno.env.get("STRATEGY_VALIDATION_KEY") || "";

  const results: Array<Record<string, unknown>> = [];

  for (const c of casesToRun) {
    try {
      // 1. Strategy: call run-strategy-eval-synthesis with validation bypass
      const stratRes = await fetch(`${supabaseUrl}/functions/v1/run-strategy-eval-synthesis`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-skill-debug": "true",
          "x-validation-key": validationKey,
          "apikey": Deno.env.get("SUPABASE_ANON_KEY")!,
        },
        body: JSON.stringify({ skill: c.skill, threadId: `validation-35b-${c.id}`, skipAdversarial: true }),
      });
      const stratData = await stratRes.json() as Record<string, unknown>;
      const strategyText = (stratData.generated_text as string) || "";
      const libraryHits = (stratData.library_hits as unknown[])?.length || 0;

      // 2. Baseline: call clean-baseline
      const baseRes = await fetch(`${supabaseUrl}/functions/v1/clean-baseline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": Deno.env.get("SUPABASE_ANON_KEY")!,
        },
        body: JSON.stringify({ prompt: c.baselinePrompt, systemPrompt: c.baselineSystem }),
      });
      const baseData = await baseRes.json() as Record<string, unknown>;
      const baselineText = (baseData.text as string) || "";

      // 3. Score both
      const stratScore = scoreOutput(strategyText, c.inputTerms, c.scoringShape, c.forbid, c.mustHave, c.targetWords);
      const baseScore = scoreOutput(baselineText, c.inputTerms, c.scoringShape, c.forbid, c.mustHave, c.targetWords);

      const winner = stratScore.total > baseScore.total ? "strategy" : stratScore.total < baseScore.total ? "baseline" : "tie";
      const structWinner = stratScore.structure > baseScore.structure ? "strategy" : stratScore.structure < baseScore.structure ? "baseline" : "tie";
      const bizWinner = stratScore.business_impact > baseScore.business_impact ? "strategy" : stratScore.business_impact < baseScore.business_impact ? "baseline" : "tie";

      // Valid = non-empty Strategy output. JSON artifacts starting with { are valid.
      const isValid = strategyText.length > 20;
      const isClean = !baselineText.includes("KI-") && !baselineText.includes("Knowledge Item");

      results.push({
        label: c.label,
        strategy_total: stratScore.total,
        baseline_total: baseScore.total,
        winner,
        structure_winner: structWinner,
        biz_impact_winner: bizWinner,
        library_hits: libraryHits,
        strategy_valid: isValid,
        baseline_clean: isClean,
        strategy_dimensions: { specificity: stratScore.specificity, actionability: stratScore.actionability, structure: stratScore.structure, evidence: stratScore.evidence, relevance: stratScore.relevance, business_impact: stratScore.business_impact },
        baseline_dimensions: { specificity: baseScore.specificity, actionability: baseScore.actionability, structure: baseScore.structure, evidence: baseScore.evidence, relevance: baseScore.relevance, business_impact: baseScore.business_impact },
        strategy_word_count: strategyText.split(/\s+/).length,
        baseline_word_count: baselineText.split(/\s+/).length,
        gate_decision: stratData.refusal ? "refuse" : "pass",
        refusal: stratData.refusal || null,
      });
    } catch (e) {
      results.push({ label: c.label, error: (e as Error).message });
    }
  }

  const strategyWins = results.filter(r => r.winner === "strategy").length;
  const baselineWins = results.filter(r => r.winner === "baseline").length;
  const ties = results.filter(r => r.winner === "tie").length;
  const winRate = Math.round((strategyWins / results.length) * 100);
  const structureLosses = results.filter(r => r.structure_winner === "baseline").length;
  const bizLosses = results.filter(r => r.biz_impact_winner === "baseline").length;
  const invalidOutputs = results.filter(r => r.strategy_valid === false).length;
  const contaminatedBaselines = results.filter(r => r.baseline_clean === false).length;
  // New standard: 0 baseline wins, Strategy must win majority
  const allPass = baselineWins === 0 && strategyWins > ties && structureLosses === 0 && bizLosses === 0 && invalidOutputs === 0 && contaminatedBaselines === 0;

  return new Response(JSON.stringify({
    timestamp: new Date().toISOString(),
    results,
    acceptance: { winRate, strategyWins, baselineWins, ties, total: results.length, structureLosses, bizLosses, invalidOutputs, contaminatedBaselines, verdict: allPass ? "PASS" : "FAIL" },
  }, null, 2), { headers: { ...CORS, "Content-Type": "application/json" } });
});
