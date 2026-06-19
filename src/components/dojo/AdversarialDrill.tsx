import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface AdversarialKI {
  id: string;
  tactic_summary: string;
  when_not_to_use: string | null;
  example_usage: string | null;
  spider_dimension: string | null;
  chapter: string;
}

interface AdversarialDrillProps {
  ki: AdversarialKI;
  onResult: (score: number) => void;
}

export function AdversarialDrill({ ki, onResult }: AdversarialDrillProps) {
  const [kiTitle, setKiTitle] = useState('');
  const [response, setResponse] = useState('');
  const [, setSubmitted] = useState(false);
  const [phase, setPhase] = useState<'q1' | 'q2' | 'done'>('q1');
  const [q1Answer, setQ1Answer] = useState<boolean | null>(null);

  useEffect(() => {
    (supabase as any)
      .from('knowledge_items')
      .select('title')
      .eq('id', ki.id)
      .maybeSingle()
      .then(({ data }: any) => setKiTitle(data?.title ?? ''));
  }, [ki.id]);

  if (!ki.when_not_to_use) return null;

  const scenario = ki.when_not_to_use;
  const handleQ1 = (answer: boolean) => {
    setQ1Answer(answer);
    if (!answer) {
      setPhase('q2');
    } else {
      setPhase('done');
      setSubmitted(true);
      onResult(20);
    }
  };

  const handleQ2Submit = () => {
    if (!response.trim()) return;
    setPhase('done');
    setSubmitted(true);
    onResult(80);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] border-red-500/50 text-red-600 dark:text-red-400">
          <AlertTriangle className="h-2.5 w-2.5 mr-1" />
          Adversarial
        </Badge>
        <span className="text-[10px] text-muted-foreground">Spot the trap</span>
      </div>

      <Card className="border-red-500/20 bg-red-500/5">
        <CardContent className="p-4 space-y-2">
          <p className="text-[11px] text-red-600 dark:text-red-400 font-medium uppercase tracking-wide">
            A rep is about to use: {kiTitle || '…'}
          </p>
          <p className="text-sm leading-relaxed">{scenario}</p>
        </CardContent>
      </Card>

      {phase === 'q1' && (
        <div className="space-y-2">
          <p className="text-xs font-medium">Should the rep use this play here?</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleQ1(true)}
              className="p-3 rounded-lg border border-border hover:border-green-500/50 hover:bg-green-500/5 text-sm font-medium transition-all text-center"
            >
              ✓ Yes, use it
            </button>
            <button
              onClick={() => handleQ1(false)}
              className="p-3 rounded-lg border border-border hover:border-red-500/50 hover:bg-red-500/5 text-sm font-medium transition-all text-center"
            >
              ✗ No, it's a trap
            </button>
          </div>
        </div>
      )}

      {phase === 'q2' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 font-medium">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            Correct — it is a trap. What should the rep do instead?
          </div>
          <Textarea
            placeholder="Describe the better approach…"
            className="min-h-[96px] text-sm resize-none"
            value={response}
            onChange={e => setResponse(e.target.value)}
          />
          <Button className="w-full" size="sm" disabled={!response.trim()} onClick={handleQ2Submit}>
            Submit
          </Button>
        </div>
      )}

      {phase === 'done' && (
        <Card className={cn(
          'border',
          q1Answer === false ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'
        )}>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              {q1Answer === false
                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                : <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
              <p className="text-xs font-medium">
                {q1Answer === false
                  ? 'You spotted the anti-pattern'
                  : 'Missed the trap — this is a when-NOT-to-use case'}
              </p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-medium">Why this situation is a trap:</span>{' '}
              {ki.when_not_to_use}
            </p>
            {ki.tactic_summary && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-medium">What {kiTitle} actually does:</span>{' '}
                {ki.tactic_summary.substring(0, 150)}{ki.tactic_summary.length > 150 ? '…' : ''}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
