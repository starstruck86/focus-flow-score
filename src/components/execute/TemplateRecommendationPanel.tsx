import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Star, Pin, Sparkles, Eye } from 'lucide-react';
import { useExecutionTemplates } from '@/hooks/useExecutionTemplates';
import { scoreTemplates } from '@/lib/executionTemplateScoring';
import type { ExecutionTemplate, OutputType, TemplateRecommendation } from '@/lib/executionTemplateTypes';

interface Props {
  outputType: OutputType;
  stage?: string;
  persona?: string;
  competitor?: string;
  onSelect: (template: ExecutionTemplate) => void;
  onPreview: (template: ExecutionTemplate) => void;
}

export function TemplateRecommendationPanel({ outputType, stage, persona, competitor, onSelect, onPreview }: Props) {
  const { data: templates = [] } = useExecutionTemplates();

  const recommendations = useMemo<TemplateRecommendation[]>(() => {
    if (!templates.length) return [];
    return scoreTemplates(templates, { outputType, stage, persona, competitor }).slice(0, 6);
  }, [templates, outputType, stage, persona, competitor]);

  if (!recommendations.length) {
    return (
      <Card>
        <CardContent className="p-4 text-center text-sm text-muted-foreground">
          No templates yet. Upload or save your first one to see recommendations here.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Recommended Templates
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-2">
        {recommendations.map(({ template: t, score, reasons }) => (
          <div
            key={t.id}
            className="flex items-start gap-2 p-2.5 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors group"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                {t.is_pinned && <Pin className="h-3 w-3 text-primary shrink-0" />}
                {t.is_favorite && <Star className="h-3 w-3 text-amber-500 shrink-0 fill-amber-500" />}
                <span className="text-xs font-medium truncate">{t.title}</span>
                <Badge variant="secondary" className="text-[9px] shrink-0">{score}pt</Badge>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                {reasons.slice(0, 3).join(' · ')}
              </p>
              {t.times_used > 0 && (
                <span className="text-[9px] text-muted-foreground">Used {t.times_used}x</span>
              )}
            </div>
            <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => onPreview(t)}>
                <Eye className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="default" className="h-6 text-[10px] px-2" onClick={() => onSelect(t)}>
                Use
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
