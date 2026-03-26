/**
 * Playbook Roleplay Tool for Dave
 * 
 * Generates a buyer scenario from playbook + deal context and
 * manages a roleplay conversation loop with inline feedback.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ToolContext } from '../../toolTypes';
import type { Playbook } from '@/hooks/usePlaybooks';
import { selectPlaybook, type WorkflowContext } from '@/hooks/usePlaybookRecommendation';

/**
 * Build a buyer persona scenario prompt from playbook + context.
 * This is stored in localStorage so Dave can reference it mid-roleplay.
 */
function buildRoleplayScenario(playbook: Playbook, ctx: {
  accountName?: string;
  dealStage?: string;
  dealStatus?: string;
  personaFit?: string;
  industry?: string;
}): string {
  const persona = ctx.personaFit || playbook.persona_fit?.[0] || 'VP of Marketing';
  const industry = ctx.industry || 'DTC / Ecommerce';
  const stage = ctx.dealStage || 'Discovery';

  return `You are a REAL BUYER in a roleplay simulation. You are NOT an AI. You are NOT helpful. You are "${persona}" at a ${industry} company.

## SCENARIO: ${playbook.problem_type.toUpperCase()}
The rep needs to practice: "${playbook.title}"
Deal stage: ${stage}
${ctx.dealStatus === 'stalled' ? 'IMPORTANT: This deal has stalled. You went dark 2 weeks ago. The rep is trying to re-engage you.' : ''}

## YOUR HIDDEN STATE
- You have the exact problem this playbook solves, but you won't admit it easily
- Surface answer: "Things are fine, we're evaluating options"
- Hidden pain: ${playbook.why_it_matters || 'significant revenue impact you haven\'t quantified'}
- You need the rep to ${playbook.tactic_steps?.[0] || 'ask the right questions to uncover the real issue'}

## PRESSURE POINTS THE REP SHOULD HIT
${(playbook.pressure_tactics || []).map(p => `- ${p}`).join('\n') || '- Force clarity on timeline\n- Surface the cost of inaction'}

## WHAT GOOD LOOKS LIKE FROM THE REP
${(playbook.what_great_looks_like || []).map(w => `- ${w}`).join('\n') || '- Asks specific, uncomfortable questions\n- Creates urgency without being pushy'}

## COMMON MISTAKES TO EXPLOIT
${(playbook.common_mistakes || []).map(m => `- If the rep does this, push back harder: ${m}`).join('\n') || '- Being too generic\n- Not quantifying impact'}

## YOUR BEHAVIOR RULES
1. Keep responses to 2-4 sentences. Be realistic, not robotic.
2. Give surface answers to weak questions. Only reveal pain with strong follow-ups.
3. Challenge vague statements — say "Can you be more specific?" or "That sounds generic."
4. If the rep skips steps from the playbook, make it harder for them.
5. If the rep nails a tactic step, soften slightly — reward good selling.
6. NEVER break character. You are the buyer.
7. Occasionally redirect: "Before we go there, why should I care?"

## ANTI-PATTERNS TO PUNISH
${(playbook.anti_patterns || []).map(a => `- If the rep does this, respond skeptically: ${a}`).join('\n')}

## START
Respond as the buyer would at the opening of a ${stage} call. Be natural.`;
}

const ROLEPLAY_STATE_KEY = 'dave-playbook-roleplay';

interface RoleplayState {
  active: boolean;
  playbookId: string;
  playbookTitle: string;
  scenario: string;
  startedAt: number;
  messageCount: number;
}

function getState(): RoleplayState | null {
  try {
    const raw = localStorage.getItem(ROLEPLAY_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setState(state: RoleplayState | null) {
  if (state) {
    localStorage.setItem(ROLEPLAY_STATE_KEY, JSON.stringify(state));
  } else {
    localStorage.removeItem(ROLEPLAY_STATE_KEY);
  }
}

/**
 * Start a playbook roleplay session.
 * Infers the best playbook if none specified.
 */
export async function startPlaybookRoleplay(
  ctx: ToolContext,
  params: {
    playbookTitle?: string;
    accountName?: string;
    dealStage?: string;
    dealStatus?: string;
    objection?: string;
  },
) {
  // Check for existing active session
  const existing = getState();
  if (existing?.active) {
    return `🎭 You already have an active roleplay session: "${existing.playbookTitle}". Say "end roleplay" to finish it first, or "retry" to restart.`;
  }

  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated.';

  // Fetch playbooks
  const { data: rows, error } = await supabase
    .from('playbooks' as any)
    .select('*')
    .order('confidence_score', { ascending: false });

  if (error || !rows?.length) return 'No playbooks available. Generate playbooks from the Prep Hub first.';

  const playbooks = rows as unknown as Playbook[];
  let playbook: Playbook | undefined;

  // Find by title if specified
  if (params.playbookTitle) {
    const lower = params.playbookTitle.toLowerCase();
    playbook = playbooks.find(p => p.title.toLowerCase().includes(lower));
  }

  // Handle objection-specific requests
  if (!playbook && params.objection) {
    const objLower = params.objection.toLowerCase();
    playbook = playbooks.find(p =>
      p.problem_type.toLowerCase().includes(objLower) ||
      p.title.toLowerCase().includes(objLower) ||
      p.talk_tracks.some(t => t.toLowerCase().includes(objLower))
    );
  }

  // Auto-select from context if not specified
  if (!playbook) {
    const workflowCtx: WorkflowContext = {
      blockType: 'meeting',
      dealStage: params.dealStage,
      dealStatus: params.dealStatus,
    };
    const rec = selectPlaybook(playbooks, workflowCtx);
    if (rec) playbook = rec.playbook;
  }

  // Fallback to highest confidence
  if (!playbook) playbook = playbooks[0];

  // Look up account context if provided
  let industry: string | undefined;
  if (params.accountName) {
    const { data: acct } = await supabase
      .from('accounts')
      .select('industry')
      .ilike('name', `%${params.accountName}%`)
      .limit(1)
      .single();
    industry = acct?.industry ?? undefined;
  }

  const scenario = buildRoleplayScenario(playbook, {
    accountName: params.accountName,
    dealStage: params.dealStage,
    dealStatus: params.dealStatus,
    industry,
  });

  // Save state
  setState({
    active: true,
    playbookId: playbook.id,
    playbookTitle: playbook.title,
    scenario,
    startedAt: Date.now(),
    messageCount: 0,
  });

  // Dispatch event for UI to pick up
  window.dispatchEvent(new CustomEvent('dave-roleplay-started', {
    detail: { playbookTitle: playbook.title, problemType: playbook.problem_type },
  }));

  // Build the quick-reference cheat sheet
  const quickSteps = playbook.minimum_effective_version
    ? `\n**Quick version:** ${playbook.minimum_effective_version}`
    : playbook.tactic_steps.slice(0, 3).map((s, i) => `\n${i + 1}. ${s}`).join('');

  let output = `🎭 **Roleplay: ${playbook.title}**`;
  output += `\n\n**Problem you're solving:** ${playbook.problem_type}`;
  output += `\n**Your goal:** ${playbook.deal_impact || 'Drive movement on this deal'}`;
  output += `\n${quickSteps}`;
  output += `\n\n_I'm now the buyer. Open with your approach. Say "end roleplay" when done._`;
  output += `\n\n---`;
  output += `\n\n_[Buyer is on the line...]_`;

  return output;
}

/**
 * End the current roleplay and provide feedback.
 */
export async function endPlaybookRoleplay(ctx: ToolContext) {
  const state = getState();
  if (!state?.active) {
    return 'No active roleplay session to end.';
  }

  const duration = Math.round((Date.now() - state.startedAt) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;

  // Clear state
  setState(null);

  // Dispatch event for UI
  window.dispatchEvent(new CustomEvent('dave-roleplay-ended'));

  let output = `🏁 **Roleplay Complete: ${state.playbookTitle}**`;
  output += `\n\nDuration: ${minutes}m ${seconds}s | Exchanges: ${state.messageCount}`;
  output += `\n\n_I'm back as Dave now. Want to retry this scenario, or move on?_`;

  return output;
}

/**
 * Get the current roleplay state for Dave's context.
 */
export function getPlaybookRoleplayState(): RoleplayState | null {
  return getState();
}

/**
 * Increment message count in active roleplay.
 */
export function tickRoleplayMessage() {
  const state = getState();
  if (state?.active) {
    state.messageCount++;
    setState(state);
  }
}
