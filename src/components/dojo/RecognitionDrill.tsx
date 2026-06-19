import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface RecognitionKI {
  id: string;
  tactic_summary: string;
  example_usage: string;
  spider_dimension: string;
}

interface RecognitionDrillProps {
  ki: RecognitionKI;
  onResult: (correct: boolean, score: number) => void;
}

export function RecognitionDrill({ ki, onResult }: RecognitionDrillProps) {
  const [correctTitle, setCorrectTitle] = useState<string | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: self } = await (supabase as any)
        .from('knowledge_items')
        .select('title')
        .eq('id', ki.id)
        .maybeSingle();
      if (cancelled || !self?.title) return;

      const { data: peers } = await (supabase as any)
        .from('knowledge_items')
        .select('title')
        .eq('spider_dimension', ki.spider_dimension)
        .eq('is_core_ae', true)
        .eq('active', true)
        .neq('id', ki.id)
        .order('confidence_score', { ascending: false })
        .limit(20);

      if (cancelled) return;
      const pool: { title: string }[] = peers ?? [];
      const distractors = [...pool].sort(() => Math.random() - 0.5).slice(0, 3).map(d => d.title);
      const all = [self.title, ...distractors].sort(() => Math.random() - 0.5);
      setCorrectTitle(self.title);
      setOptions(all);
    })();
    return () => { cancelled = true; };
  }, [ki.id, ki.spider_dimension]);

  const select = useCallback((opt: string) => {
    if (revealed || !correctTitle) return;
    setSelected(opt);
    setRevealed(true);
    const correct = opt === correctTitle;
    onResult(correct, correct ? 100 : 0);
  }, [revealed, correctTitle, onResult]);

  if (options.length === 0 || !correctTitle) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Loading options…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">Recognition</Badge>
            <span className="text-[10px] text-muted-foreground">Which play applies?</span>
          </div>
          <p className="text-sm leading-relaxed">
            {ki.example_usage || ki.tactic_summary}
          </p>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {options.map((opt) => {
          const isSelected = selected === opt;
          const isCorrect = opt === correctTitle;
          const showResult = revealed;

          return (
            <button
              key={opt}
              disabled={revealed}
              onClick={() => select(opt)}
              className={cn(
                'w-full text-left p-3 rounded-lg border text-xs transition-all',
                !showResult && 'border-border hover:border-primary/50 hover:bg-primary/5',
                showResult && isCorrect && 'border-green-500 bg-green-500/10',
                showResult && isSelected && !isCorrect && 'border-red-500 bg-red-500/10',
                showResult && !isSelected && !isCorrect && 'border-border opacity-40',
              )}
            >
              <div className="flex items-start gap-2">
                <div className="shrink-0 mt-0.5">
                  {showResult && isCorrect && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                  {showResult && isSelected && !isCorrect && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                  {(!showResult || (!isCorrect && !isSelected)) && (
                    <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground" />
                  )}
                </div>
                <span className={cn(
                  showResult && isCorrect && 'text-green-700 dark:text-green-300 font-medium',
                  showResult && isSelected && !isCorrect && 'text-red-700 dark:text-red-300',
                )}>
                  {opt}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {revealed && (
        <Card className={cn(
          'border',
          selected === correctTitle ? 'border-green-500/30 bg-green-500/5' : 'border-amber-500/30 bg-amber-500/5'
        )}>
          <CardContent className="p-3">
            <p className="text-xs font-medium mb-1">
              {selected === correctTitle ? '✓ Correct' : `✗ The play was: ${correctTitle}`}
            </p>
            <p className="text-xs text-muted-foreground">{ki.tactic_summary}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
