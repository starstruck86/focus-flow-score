/**
 * Voice Intent Classifier
 *
 * Classifies spoken input into action intents and routes them
 * to the correct existing systems.
 */

export type VoiceIntent =
  | 'ask'
  | 'explain'
  | 'act'
  | 'diagnose'
  | 'recover'
  | 'confirm-required';

export type VoiceMetaIntent =
  | 'shorter'
  | 'more-detail'
  | 'repeat'
  | 'summarize'
  | 'continue'
  | 'stop'
  | 'pause'
  | 'resume'
  | 'go-back'
  | null;

export interface ClassifiedIntent {
  intent: VoiceIntent;
  meta: VoiceMetaIntent;
  confidence: number;
  /** The tool or system this should route to */
  suggestedRoute: string | null;
  /** Whether this references the current operating context */
  usesContext: boolean;
}

// ── Meta-intent patterns (response control) ────────────────

const META_PATTERNS: [VoiceMetaIntent, RegExp[]][] = [
  ['shorter', [/\b(shorter|brief|less detail|too long|cut it down|tldr)\b/i]],
  ['more-detail', [/\b(more detail|elaborate|expand|tell me more|explain further|dig deeper)\b/i]],
  ['repeat', [/\b(repeat that|say that again|what did you say|come again)\b/i]],
  ['summarize', [/\b(summarize|sum it up|bottom line|give me the gist)\b/i]],
  ['continue', [/\b(continue|keep going|go on|and then|next one|what else)\b/i]],
  ['stop', [/\b(stop|nevermind|cancel|forget it|that's enough)\b/i]],
  ['pause', [/\b(pause|hold on|wait|one sec|hang on)\b/i]],
  ['resume', [/\b(resume|pick up|where were we|continue where|left off)\b/i]],
  ['go-back', [/\b(go back|previous|back to|undo that|revert)\b/i]],
];

// ── Primary intent patterns ────────────────────────────────

const INTENT_PATTERNS: [VoiceIntent, RegExp[], number][] = [
  // ACT — performing actions, creating, updating
  ['act', [
    /\b(log|create|set|update|move|mark|complete|send|draft|write|start|open|launch)\b/i,
    /\b(reminder|follow.?up|task|email|note|roleplay|power hour|focus timer)\b/i,
    /\bprep\s+(me|for)\b/i,
    /\bwalk\s+me\s+through\b/i,
  ], 2],

  // EXPLAIN — understanding reasoning
  ['explain', [
    /\b(explain|why\s+(did|is|was|should)|what'?s\s+the\s+reasoning|how\s+did\s+you)\b/i,
    /\b(break\s+down|clarify|what\s+does\s+that\s+mean)\b/i,
  ], 2],

  // DIAGNOSE — system health, debugging
  ['diagnose', [
    /\b(diagnose|debug|system\s+(health|status|check)|what'?s\s+wrong|why\s+isn'?t)\b/i,
    /\b(confidence|drift|telemetry|governance)\b/i,
  ], 2],

  // RECOVER — fixing problems
  ['recover', [
    /\b(recover|fix|reset|fallback|something\s+(broke|failed)|not\s+working)\b/i,
  ], 3],

  // ASK — queries, summaries, information
  ['ask', [
    /\b(what|who|when|where|how\s+many|how\s+much|show\s+me|tell\s+me|give\s+me)\b/i,
    /\b(status|summary|overview|pipeline|quota|deals?|tasks?|accounts?)\b/i,
    /\b(next|top|best|worst|biggest|closest)\b/i,
  ], 1],
];

// ── Context reference patterns ─────────────────────────────

const CONTEXT_REFS = [
  /\b(that|this|it|the same|this one|current|last)\b/i,
  /\b(practice\s+it|use\s+that|log\s+that|do\s+that|try\s+that)\b/i,
];

// ── Route mapping ──────────────────────────────────────────

const ROUTE_PATTERNS: [string, RegExp][] = [
  ['daily_game_plan', /\b(walk\s+me\s+through\s+my\s+day|daily\s+plan|game\s+plan|my\s+day)\b/i],
  ['primary_action', /\b(what\s+should\s+i\s+do|next\s+action|what'?s\s+next|primary\s+action)\b/i],
  ['prep_meeting', /\b(prep\s+(me|for)|meeting\s+prep|before\s+my\s+call)\b/i],
  ['start_roleplay', /\b(roleplay|practice|simulate|mock\s+call|role\s+play|let'?s\s+practice)\b/i],
  ['generate_content', /\b(draft|write|compose)\s+(follow.?up|email|message)\b/i],
  ['create_task', /\b(set\s+a?\s*reminder|create\s+a?\s*task|remind\s+me)\b/i],
  ['log_touch', /\b(log\s+(outcome|call|touch|activity|that)|debrief)\b/i],
  ['explain', /\b(explain\s+this\s+recommendation|why\s+this|reasoning)\b/i],
  ['operating_state', /\b(system\s+(health|status)|operating\s+state)\b/i],
  ['query_opportunities', /\b(deals?|opportunities|pipeline)\b/i],
  ['query_tasks', /\b(tasks?|to.?do|action\s+items)\b/i],
  ['momentum_check', /\b(momentum|velocity|how\s+am\s+i\s+doing)\b/i],
];

export function classifyVoiceIntent(input: string): ClassifiedIntent {
  // 1. Check meta-intent first
  let meta: VoiceMetaIntent = null;
  for (const [metaType, patterns] of META_PATTERNS) {
    if (patterns.some(p => p.test(input))) {
      meta = metaType;
      break;
    }
  }

  // If it's purely a meta command, return early
  if (meta && input.split(/\s+/).length <= 4) {
    return { intent: 'ask', meta, confidence: 90, suggestedRoute: null, usesContext: true };
  }

  // 2. Score primary intents
  const scores: Record<VoiceIntent, number> = {
    ask: 0, explain: 0, act: 0, diagnose: 0, recover: 0, 'confirm-required': 0,
  };

  for (const [intent, patterns, weight] of INTENT_PATTERNS) {
    for (const p of patterns) {
      if (p.test(input)) scores[intent] += weight;
    }
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const topIntent = (sorted[0][1] > 0 ? sorted[0][0] : 'ask') as VoiceIntent;
  const confidence = sorted[0][1] > 0
    ? Math.min(95, 50 + sorted[0][1] * 15)
    : 40;

  // 3. Route detection
  let suggestedRoute: string | null = null;
  for (const [route, pattern] of ROUTE_PATTERNS) {
    if (pattern.test(input)) { suggestedRoute = route; break; }
  }

  // 4. Context reference detection
  const usesContext = CONTEXT_REFS.some(p => p.test(input));

  return { intent: topIntent, meta, confidence, suggestedRoute, usesContext };
}
