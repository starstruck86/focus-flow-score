import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const TRANSCRIPT_IDS = [
  '9f7f2021-3c77-4282-a51b-4a4c12397812',
  'fdc1a605-e746-425d-8f7d-9e7d764242f9',
  'f6bedf81-a416-413c-b0d6-fdbd30eb388b',
  '9aa66379-8f69-4738-8444-f3f066db83b0',
  '57ebfcd5-7467-4ee5-8ca0-b8be2e04eb84',
  'e7332574-626d-4511-abaf-d64f950765dd',
  '6917fe97-45c9-4f19-af2b-230075bed0cb',
  '1b82d033-3db4-4d78-b0eb-8ae53fa62ff7',
  '87c2e950-ff23-4bcb-9aa2-0b327720bcd5',
  '344d675a-70af-45a0-a34d-24e5e950e08b',
  'b1388685-0b55-4d48-bb3e-bc2a31cf5736',
  '379d32c2-4c70-476c-826f-7eb9125e77c1',
  '8d00e4b3-8bb2-4731-b3e6-de1d423cb28e',
  '7fc15538-6e3f-4a73-b841-979fd087689f',
  '1368520f-90eb-415a-843d-b9c9937761b4',
  '79642b64-418d-428f-8e33-8ee648f0a0a7',
  '9eb3ad98-e2cd-4fcb-bcc0-0b8c8c608dff',
  '9f471815-e2b7-48e9-90e6-b2b6d8720ec8',
  '4e323b40-f082-408c-b405-8349de0dfd8d',
  'fcf794f4-da40-4364-bdbc-4818e4f40411',
  'e7d00547-e1fe-4d9c-95d0-ef99e342f450',
  'fbe93079-1528-4269-83cd-b12e0100035b',
  '3b7b137d-7006-4f14-950c-6d71e704e88e',
  '5764c80b-fdb9-40c5-8961-d454b1ebd704',
];

interface Result {
  id: string;
  grade?: string;
  score?: number;
  status: 'pending' | 'running' | 'done' | 'error';
  error?: string;
}

export default function BatchRegrade() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [results, setResults] = useState<Result[]>(
    TRANSCRIPT_IDS.map(id => ({ id, status: 'pending' }))
  );
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!user || started) return;
    setStarted(true);
    run();
  }, [user]);

  const run = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    for (let i = 0; i < TRANSCRIPT_IDS.length; i++) {
      const id = TRANSCRIPT_IDS[i];

      // Mark as running
      setResults(prev => prev.map(r => r.id === id ? { ...r, status: 'running' } : r));

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/grade-transcript`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ transcript_id: id }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          setResults(prev => prev.map(r =>
            r.id === id ? { ...r, status: 'error', error: err.error || 'Failed' } : r
          ));
        } else {
          const data = await res.json();
          setResults(prev => prev.map(r =>
            r.id === id ? { ...r, status: 'done', grade: data.overall_grade, score: data.overall_score } : r
          ));
        }
      } catch (e: any) {
        setResults(prev => prev.map(r =>
          r.id === id ? { ...r, status: 'error', error: e.message } : r
        ));
      }

      // Brief pause between calls to avoid rate limits
      if (i < TRANSCRIPT_IDS.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
  };

  const done = results.filter(r => r.status === 'done').length;
  const errors = results.filter(r => r.status === 'error').length;
  const total = results.length;
  const isComplete = done + errors === total;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-start px-4 py-8 space-y-6">
      <div className="w-full max-w-md space-y-2">
        <h1 className="text-lg font-bold">Re-grading Calls</h1>
        <p className="text-sm text-muted-foreground">
          {isComplete
            ? `Done — ${done} graded, ${errors} failed`
            : `${done}/${total} complete…`}
        </p>

        {/* Progress bar */}
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${((done + errors) / total) * 100}%` }}
          />
        </div>
      </div>

      {/* Results list */}
      <div className="w-full max-w-md space-y-1.5">
        {results.map(r => (
          <div
            key={r.id}
            className={cn(
              'flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all',
              r.status === 'done' ? 'bg-green-500/5 border border-green-500/20' :
              r.status === 'error' ? 'bg-red-500/5 border border-red-500/20' :
              r.status === 'running' ? 'bg-primary/5 border border-primary/20' :
              'bg-muted/30 border border-border/40'
            )}
          >
            <span className="font-mono text-xs text-muted-foreground">{r.id.slice(0, 8)}…</span>
            <div className="flex items-center gap-2">
              {r.status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
              {r.status === 'done' && (
                <>
                  <span className="font-bold text-xs">{r.grade}</span>
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                </>
              )}
              {r.status === 'error' && (
                <>
                  <span className="text-xs text-red-500">{r.error?.slice(0, 20)}</span>
                  <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                </>
              )}
              {r.status === 'pending' && <span className="text-xs text-muted-foreground/40">—</span>}
            </div>
          </div>
        ))}
      </div>

      {isComplete && (
        <button
          onClick={() => navigate('/coach')}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
        >
          View Grades in Coach →
        </button>
      )}
    </div>
  );
}
