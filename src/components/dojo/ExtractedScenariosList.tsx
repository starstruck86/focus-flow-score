import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Target, Zap, ArrowRight, Quote } from 'lucide-react';
import type { ExtractedScenario } from '@/hooks/useExtractScenarios';

const SKILL_COLORS: Record<string, string> = {
  objection_handling: 'bg-red-500/10 text-red-700 border-red-200',
  discovery: 'bg-blue-500/10 text-blue-700 border-blue-200',
  executive_response: 'bg-purple-500/10 text-purple-700 border-purple-200',
  deal_control: 'bg-amber-500/10 text-amber-700 border-amber-200',
  qualification: 'bg-green-500/10 text-green-700 border-green-200',
};

const DIFFICULTY_LABELS: Record<string, string> = {
  foundational: '🟢 Foundational',
  intermediate: '🟡 Intermediate',
  advanced: '🔴 Advanced',
};

interface ExtractedScenariosListProps {
  scenarios: ExtractedScenario[];
  onPractice?: (scenario: ExtractedScenario) => void;
  onClose?: () => void;
}

export function ExtractedScenariosList({ scenarios, onPractice, onClose }: ExtractedScenariosListProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <Target className="h-4 w-4 text-primary" />
          Extracted Training Scenarios ({scenarios.length})
        </h4>
        {onClose && (
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onClose}>
            Dismiss
          </Button>
        )}
      </div>

      {scenarios.map((s, i) => (
        <Card key={i} className="border-border/60">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{s.title}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <Badge variant="outline" className={`text-[10px] ${SKILL_COLORS[s.skillFocus] || ''}`}>
                    {s.skillFocus.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {DIFFICULTY_LABELS[s.difficulty] || s.difficulty}
                  </span>
                </div>
              </div>
              {onPractice && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs shrink-0"
                  onClick={() => onPractice(s)}
                >
                  <Zap className="h-3 w-3 mr-1" />
                  Practice
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground">{s.context}</p>

            <div className="bg-muted/50 rounded-md p-2 border border-border/40">
              <p className="text-[10px] font-semibold text-muted-foreground mb-0.5 flex items-center gap-1">
                <ArrowRight className="h-3 w-3" /> Buyer says:
              </p>
              <p className="text-xs italic">"{s.objection}"</p>
            </div>

            {s.sourceExcerpt && (
              <div className="text-[10px] text-muted-foreground flex items-start gap-1">
                <Quote className="h-3 w-3 mt-0.5 shrink-0" />
                <span className="italic line-clamp-2">{s.sourceExcerpt}</span>
              </div>
            )}

            <p className="text-[10px] text-primary/80 font-medium">
              💡 {s.coachingHint}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
