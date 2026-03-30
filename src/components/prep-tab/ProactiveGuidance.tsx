/**
 * Proactive Guidance — "You may also need…" suggestions
 * based on persona, competitor, stage context.
 */

import { Sparkles } from 'lucide-react';

interface Suggestion {
  text: string;
  actionId?: string;
  targetStage?: string;
}

interface Props {
  stageId: string;
  persona: string;
  competitor: string;
  hasContext: boolean;
  onSelectAction: (actionId: string) => void;
  onChangeStage: (stageId: string) => void;
}

function getSuggestions(stageId: string, persona: string, competitor: string, hasContext: boolean): Suggestion[] {
  const p = persona.toLowerCase();
  const suggestions: Suggestion[] = [];

  // CFO / Finance persona signals
  if (p.includes('cfo') || p.includes('finance') || p.includes('vp finance')) {
    if (stageId !== 'pricing') {
      suggestions.push({ text: 'CFO involved → prepare ROI Summary', actionId: 'roi-summary', targetStage: 'pricing' });
    }
    suggestions.push({ text: 'Financial stakeholder → draft executive email', actionId: 'cfo-email' });
  }

  // Champion / multi-stakeholder signals
  if (p.includes('champion') || p.includes('vp') || p.includes('director')) {
    if (stageId !== 'champion') {
      suggestions.push({ text: 'Multi-stakeholder deal → align champion', targetStage: 'champion' });
    }
    suggestions.push({ text: 'Internal selling needed → build business case', actionId: 'business-case' });
  }

  // IT / Security signals
  if (p.includes('it') || p.includes('security') || p.includes('cto') || p.includes('ciso')) {
    if (stageId !== 'procurement') {
      suggestions.push({ text: 'Security review likely → prep procurement responses', targetStage: 'procurement' });
    }
  }

  // Competitor present
  if (competitor) {
    if (stageId === 'discovery' || stageId === 'demo') {
      suggestions.push({ text: `Competitor "${competitor}" → prepare competitive positioning`, actionId: 'pricing-call-prep' });
    }
  }

  // Stage-based proactive hints
  if (stageId === 'discovery' && !hasContext) {
    suggestions.push({ text: 'Add call notes or transcript for better output quality' });
  }
  if (stageId === 'demo') {
    suggestions.push({ text: 'After demo → send follow-up while it\'s fresh', actionId: 'demo-followup' });
  }
  if (stageId === 'pricing') {
    suggestions.push({ text: 'Prepare for procurement next', targetStage: 'procurement' });
  }
  if (stageId === 'closing') {
    suggestions.push({ text: 'Plan post-sale handoff now', targetStage: 'post-sale' });
  }

  return suggestions.slice(0, 3);
}

export function ProactiveGuidance({ stageId, persona, competitor, hasContext, onSelectAction, onChangeStage }: Props) {
  const suggestions = getSuggestions(stageId, persona, competitor, hasContext);
  if (suggestions.length === 0) return null;

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">You may also need…</span>
      </div>
      <div className="space-y-1">
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => {
              if (s.actionId) onSelectAction(s.actionId);
              else if (s.targetStage) onChangeStage(s.targetStage);
            }}
            disabled={!s.actionId && !s.targetStage}
            className="flex items-start gap-1.5 text-xs text-foreground/80 hover:text-primary transition-colors text-left disabled:cursor-default disabled:hover:text-foreground/80"
          >
            <span className="text-primary mt-0.5">→</span>
            <span>{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
