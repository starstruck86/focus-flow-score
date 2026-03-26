/**
 * Dave tool: get_playbook_recommendation
 * 
 * Returns ONE contextually-matched playbook with guidance for Dave
 * to naturally reference during conversation.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ToolContext } from '../../toolTypes';
import { selectPlaybook, type WorkflowContext } from '@/hooks/usePlaybookRecommendation';
import type { Playbook } from '@/hooks/usePlaybooks';

export async function getPlaybookRecommendation(
  ctx: ToolContext,
  params: { blockType?: string; dealStage?: string; dealStatus?: string; accountName?: string },
) {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated.';

  // Fetch playbooks
  const { data: rows, error } = await supabase
    .from('playbooks' as any)
    .select('*')
    .order('confidence_score', { ascending: false });

  if (error || !rows?.length) return 'No playbooks available yet. Generate playbooks from the Prep Hub first.';

  const playbooks = rows as unknown as Playbook[];

  // Build context from params
  const workflowCtx: WorkflowContext = {
    blockType: params.blockType as any,
    dealStage: params.dealStage,
    dealStatus: params.dealStatus,
  };

  const rec = selectPlaybook(playbooks, workflowCtx);
  if (!rec) return 'No playbook recommendation meets the confidence threshold for this context. Need more signal (deal stage, stagnation, or active block type) to make a precise recommendation.';

  const p = rec.playbook;

  // Format for Dave's conversational use
  let output = `📒 **Recommended Playbook: ${p.title}**`;
  output += `\n\n**Why now:** ${rec.reason}`;
  output += `\n**Problem it solves:** ${p.problem_type}`;

  if (p.deal_impact) {
    output += `\n\n**Deal impact:** ${p.deal_impact}`;
  }

  output += `\n\n**Quick execution (${p.minimum_effective_version ? '1-2 min' : 'steps'}):**`;
  if (p.minimum_effective_version) {
    output += `\n${p.minimum_effective_version}`;
  } else {
    p.tactic_steps.slice(0, 3).forEach((s, i) => {
      output += `\n${i + 1}. ${s}`;
    });
  }

  if (p.talk_tracks.length > 0) {
    output += `\n\n**Say this:**`;
    p.talk_tracks.slice(0, 2).forEach(t => {
      output += `\n→ _"${t}"_`;
    });
  }

  if (p.key_questions.length > 0) {
    output += `\n\n**Ask:**`;
    p.key_questions.slice(0, 2).forEach(q => {
      output += `\n• ${q}`;
    });
  }

  if (p.pressure_tactics?.length > 0) {
    output += `\n\n**Apply pressure:**`;
    p.pressure_tactics.slice(0, 2).forEach(pt => {
      output += `\n⚡ ${pt}`;
    });
  }

  if (p.failure_consequences?.length > 0) {
    output += `\n\n**If you skip this:** ${p.failure_consequences[0]}`;
  }

  output += `\n\n_Confidence: ${rec.confidence}%_`;

  return output;
}
