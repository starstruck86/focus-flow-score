import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Star, BookOpen, Eye, ArrowRight, RefreshCcw } from 'lucide-react';
import { useExecutionTemplates } from '@/hooks/useExecutionTemplates';
import { useExecutionOutputs } from '@/hooks/useExecutionOutputs';
import { scoreTemplates } from '@/lib/executionTemplateScoring';
import type { OutputType, ExecutionTemplate, ExecutionOutput } from '@/lib/executionTemplateTypes';

interface Props {
  outputType: OutputType;
  stage?: string;
  persona?: string;
  competitor?: string;
  onSelectTemplate: (t: ExecutionTemplate) => void;
  onSelectOutput: (o: ExecutionOutput) => void;
  onPreview: (body: string, title: string) => void;
}

interface RecommendationCard {
  id: string;
  title: string;
  role: 'Template' | 'Example' | 'Reference';
  reason: string;
  lastUsed: string | null;
  useCount: number;
  onUse: () => void;
  onPreview: () => void;
  body: string;
}

export function RecommendedStartingPoints({
  outputType, stage, persona, competitor,
  onSelectTemplate, onSelectOutput, onPreview,
}: Props) {
  const { data: templates = [] } = useExecutionTemplates();
  const { data: outputs = [] } = useExecutionOutputs(outputType);

  const cards = useMemo<RecommendationCard[]>(() => {
    const result: RecommendationCard[] = [];

    // Best template
    const scored = scoreTemplates(templates, { outputType, stage, persona, competitor });
    const bestTemplate = scored[0];
    if (bestTemplate) {
      const t = bestTemplate.template;
      result.push({
        id: t.id,
        title: t.title,
        role: 'Template',
        reason: bestTemplate.reasons.slice(0, 2).join(' · ') || 'Best match for this type',
        lastUsed: t.last_used_at,
        useCount: t.times_used,
        body: t.body,
        onUse: () => onSelectTemplate(t),
        onPreview: () => onPreview(t.body, t.title),
      });
    }

    // Best example (strong output)
    const strongOutputs = outputs
      .filter(o => o.is_strong_example)
      .sort((a, b) => b.times_reused - a.times_reused);
    const bestExample = strongOutputs[0];
    if (bestExample) {
      result.push({
        id: bestExample.id,
        title: bestExample.title,
        role: 'Example',
        reason: bestExample.times_reused > 0
          ? `Reused ${bestExample.times_reused}x · Marked as strong example`
          : 'Marked as strong example',
        lastUsed: bestExample.created_at,
        useCount: bestExample.times_reused,
        body: bestExample.content,
        onUse: () => onSelectOutput(bestExample),
        onPreview: () => onPreview(bestExample.content, bestExample.title),
      });
    }

    // Best reference (most recent output, not strong example)
    const recentOutput = outputs.find(o => !o.is_strong_example && o.id !== bestExample?.id);
    if (recentOutput) {
      result.push({
        id: recentOutput.id,
        title: recentOutput.title,
        role: 'Reference',
        reason: 'Most recent output for this type',
        lastUsed: recentOutput.created_at,
        useCount: recentOutput.times_reused,
        body: recentOutput.content,
        onUse: () => onSelectOutput(recentOutput),
        onPreview: () => onPreview(recentOutput.content, recentOutput.title),
      });
    }

    return result;
  }, [templates, outputs, outputType, stage, persona, competitor, onSelectTemplate, onSelectOutput, onPreview]);

  if (!cards.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <p className="text-xs text-muted-foreground">No templates or examples yet for this type.</p>
        <p className="text-[10px] text-muted-foreground mt-1">Generate your first draft, then save it as a template or example.</p>
      </div>
    );
  }

  const roleIcon = (role: string) => {
    if (role === 'Template') return <FileText className="h-3.5 w-3.5 text-primary" />;
    if (role === 'Example') return <Star className="h-3.5 w-3.5 text-amber-500" />;
    return <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  const roleBadgeVariant = (role: string) => {
    if (role === 'Template') return 'default' as const;
    if (role === 'Example') return 'secondary' as const;
    return 'outline' as const;
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recommended Starting Point</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {cards.map((card, i) => (
          <Card key={card.id} className={i === 0 ? 'border-primary/30 bg-primary/5' : ''}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-start gap-2">
                {roleIcon(card.role)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Badge variant={roleBadgeVariant(card.role)} className="text-[9px]">
                      {i === 0 ? '★ Best ' : ''}{card.role}
                    </Badge>
                  </div>
                  <p className="text-xs font-medium mt-1 truncate">{card.title}</p>
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground leading-relaxed">{card.reason}</p>

              <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                {card.useCount > 0 && <span>Used {card.useCount}x</span>}
                {card.lastUsed && (
                  <span>Last: {new Date(card.lastUsed).toLocaleDateString()}</span>
                )}
              </div>

              <div className="flex gap-1.5">
                <Button size="sm" className="h-6 text-[10px] flex-1" onClick={card.onUse}>
                  <ArrowRight className="h-3 w-3 mr-1" /> Use
                </Button>
                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={card.onPreview}>
                  <Eye className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={card.onPreview}>
                  <RefreshCcw className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
