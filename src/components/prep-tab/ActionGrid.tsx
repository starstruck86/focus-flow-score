import { cn } from '@/lib/utils';
import { Search, MessageSquare, Phone, Mail, DollarSign, FileText, BarChart3 } from 'lucide-react';

export interface PrepAction {
  id: string;
  label: string;
  description: string;
  category: 'discovery' | 'pricing';
  icon: React.ElementType;
  systemPrompt: string;
}

const ACTIONS: PrepAction[] = [
  {
    id: 'discovery-plan',
    label: 'Build Discovery Plan',
    description: 'Structured plan with objectives, questions, and research for a discovery call.',
    category: 'discovery',
    icon: Search,
    systemPrompt: 'Create a comprehensive discovery plan. Include: call objectives, key questions organized by theme, research notes about the account, potential pain points to explore, and recommended next steps. Format with clear sections and bullet points.',
  },
  {
    id: 'discovery-questions',
    label: 'Generate Discovery Questions',
    description: 'Targeted questions based on persona, stage, and competitive landscape.',
    category: 'discovery',
    icon: MessageSquare,
    systemPrompt: 'Generate a set of high-quality discovery questions. Organize by theme (pain points, current state, decision process, timeline, budget). Prioritize open-ended questions that reveal business impact. Include follow-up probes for each main question.',
  },
  {
    id: 'prep-for-call',
    label: 'Prep for Call',
    description: 'Complete call prep with talking points, risks, and recommended approach.',
    category: 'discovery',
    icon: Phone,
    systemPrompt: 'Create a complete call preparation brief. Include: meeting objective, key talking points, potential objections and responses, competitive positioning, questions to ask, risks to watch for, and desired outcome. Keep it actionable and scannable.',
  },
  {
    id: 'recap-email',
    label: 'Create Recap Email',
    description: 'Professional recap email summarizing key points and next steps.',
    category: 'discovery',
    icon: Mail,
    systemPrompt: 'Write a professional recap email. Include: brief thank-you, summary of key discussion points, agreed-upon next steps with owners and dates, and any open questions. Tone should be executive-level, concise, and action-oriented. Start with "Subject: <subject line>" on the first line.',
  },
  {
    id: 'pricing-call-prep',
    label: 'Prep for Pricing Call',
    description: 'Pricing call playbook with objection handling and value framing.',
    category: 'pricing',
    icon: DollarSign,
    systemPrompt: 'Create a pricing call preparation playbook. Include: value narrative framework, pricing presentation strategy, anticipated objections with responses, ROI talking points, competitive price positioning, negotiation boundaries, and closing strategy. Focus on value-first framing.',
  },
  {
    id: 'cfo-email',
    label: 'Generate CFO Email',
    description: 'Executive-level email focused on ROI, risk mitigation, and business impact.',
    category: 'pricing',
    icon: Mail,
    systemPrompt: 'Write a CFO-facing email. Tone: executive, concise, data-driven. Include: ROI framing with specific metrics, risk mitigation points, business impact summary, and clear call to action. Avoid jargon. Focus on financial outcomes and strategic value. Start with "Subject: <subject line>" on the first line.',
  },
  {
    id: 'roi-summary',
    label: 'Build ROI Summary',
    description: 'Quantified ROI document with metrics, comparisons, and business case.',
    category: 'pricing',
    icon: BarChart3,
    systemPrompt: 'Create an ROI summary document. Include: executive summary, current cost analysis, projected savings/revenue impact, implementation timeline, risk factors, competitive comparison, and recommended next steps. Use quantified metrics wherever possible. Format as a professional business case.',
  },
];

interface Props {
  selectedAction: PrepAction | null;
  onSelectAction: (a: PrepAction) => void;
}

export function ActionGrid({ selectedAction, onSelectAction }: Props) {
  const discovery = ACTIONS.filter(a => a.category === 'discovery');
  const pricing = ACTIONS.filter(a => a.category === 'pricing');

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">What do you need?</h3>

      {/* Discovery */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium text-muted-foreground">Discovery</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {discovery.map(a => {
            const Icon = a.icon;
            const active = selectedAction?.id === a.id;
            return (
              <button
                key={a.id}
                onClick={() => onSelectAction(a)}
                className={cn(
                  'flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all',
                  active
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border hover:border-primary/40 hover:bg-accent/30'
                )}
              >
                <Icon className={cn('h-4 w-4', active ? 'text-primary' : 'text-muted-foreground')} />
                <span className="text-xs font-medium leading-tight">{a.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pricing */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium text-muted-foreground">Pricing</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {pricing.map(a => {
            const Icon = a.icon;
            const active = selectedAction?.id === a.id;
            return (
              <button
                key={a.id}
                onClick={() => onSelectAction(a)}
                className={cn(
                  'flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all',
                  active
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border hover:border-primary/40 hover:bg-accent/30'
                )}
              >
                <Icon className={cn('h-4 w-4', active ? 'text-primary' : 'text-muted-foreground')} />
                <span className="text-xs font-medium leading-tight">{a.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { ACTIONS };
