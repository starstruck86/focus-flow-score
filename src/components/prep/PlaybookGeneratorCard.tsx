import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, BookMarked, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export function PlaybookGeneratorCard() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');

  const generate = async () => {
    setStatus('running');
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-playbooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Generation failed');

      setCount(data.count ?? 0);
      setStatus('done');
    } catch (e: any) {
      setError(e.message);
      setStatus('error');
    }
  };

  return (
    <Card className="border-primary/20">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <BookMarked className="h-4 w-4 text-primary shrink-0" />
              <p className="text-sm font-semibold">Generate Playbooks</p>
              <Badge variant="outline" className="text-[10px]">30MPC · 1,205 resources</Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Synthesizes your enriched resource library into 3-6 high-impact sales playbooks. Deduplicates patterns across sources. Replaces previous playbooks.
            </p>
          </div>
        </div>

        {status === 'done' && (
          <div className="flex items-center gap-2 mt-3 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>{count} playbook{count !== 1 ? 's' : ''} generated successfully</span>
          </div>
        )}

        {status === 'error' && (
          <p className="mt-3 text-xs text-red-500">{error}</p>
        )}

        <Button
          className="w-full mt-3"
          size="sm"
          disabled={status === 'running'}
          onClick={status === 'done' ? () => setStatus('idle') : generate}
        >
          {status === 'running' ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Generating (takes ~60s)…</>
          ) : status === 'done' ? (
            'Regenerate Playbooks'
          ) : (
            'Generate Playbooks'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
