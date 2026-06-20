import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const ALL_IDS = [
  '9f7f2021-3c77-4282-a51b-4a4c12397812','fdc1a605-e746-425d-8f7d-9e7d764242f9',
  'f6bedf81-a416-413c-b0d6-fdbd30eb388b','9aa66379-8f69-4738-8444-f3f066db83b0',
  '57ebfcd5-7467-4ee5-8ca0-b8be2e04eb84','e7332574-626d-4511-abaf-d64f950765dd',
  '6917fe97-45c9-4f19-af2b-230075bed0cb','1b82d033-3db4-4d78-b0eb-8ae53fa62ff7',
  '87c2e950-ff23-4bcb-9aa2-0b327720bcd5','344d675a-70af-45a0-a34d-24e5e950e08b',
  'b1388685-0b55-4d48-bb3e-bc2a31cf5736','379d32c2-4c70-476c-826f-7eb9125e77c1',
  '8d00e4b3-8bb2-4731-b3e6-de1d423cb28e','7fc15538-6e3f-4a73-b841-979fd087689f',
  '1368520f-90eb-415a-843d-b9c9937761b4','79642b64-418d-428f-8e33-8ee648f0a0a7',
  '9eb3ad98-e2cd-4fcb-bcc0-0b8c8c608dff','9f471815-e2b7-48e9-90e6-b2b6d8720ec8',
  '4e323b40-f082-408c-b405-8349de0dfd8d','fcf794f4-da40-4364-bdbc-4818e4f40411',
  'e7d00547-e1fe-4d9c-95d0-ef99e342f450','fbe93079-1528-4269-83cd-b12e0100035b',
  '3b7b137d-7006-4f14-950c-6d71e704e88e','5764c80b-fdb9-40c5-8961-d454b1ebd704',
];

interface Result {
  id: string;
  grade?: string;
  score?: number;
  status: 'pending' | 'running' | 'done' | 'error';
  error?: string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function BatchRegrade() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<Result[]>([]);
  const [started, setStarted] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [alreadyDone, setAlreadyDone] = useState(0);

  const addLog = (msg: string) => setLog(prev => [...prev, msg]);

  // On mount: fetch which IDs still need grading, build queue from only those
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await (supabase as any)
        .from('transcript_grades')
        .select('transcript_id')
        .in('transcript_id', ALL_IDS)
        .not('regraded_at', 'is', null);

      const doneIds = new Set((data || []).map((r: any) => r.transcript_id));
      const needed = ALL_IDS.filter(id => !doneIds.has(id));
      setAlreadyDone(doneIds.size);
      setQueue(needed.map(id => ({ id, status: 'pending' })));
      setLoading(false);
    })();
  }, [user]);

  const gradeOne = useCallback(async (id: string, token: string): Promise<{ grade: string; score: number } | null> => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/grade-transcript`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ transcript_id: id }),
        });
        if (res.status === 429) {
          addLog(`${id.slice(0, 8)} rate limited — waiting ${attempt * 10}s…`);
          await sleep(attempt * 10000);
          continue;
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          if (attempt < 3) { await sleep(5000); continue; }
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        return { grade: data.overall_grade, score: data.overall_score };
      } catch (e: any) {
        if (attempt < 3) { await sleep(5000); continue; }
        throw e;
      }
    }
    return null;
  }, []);

  // Start running once queue is loaded
  useEffect(() => {
    if (loading || started || queue.length === 0 || !user) return;
    setStarted(true);
    run();
  }, [loading, queue, user]);

  const run = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { addLog('No session'); return; }

    const ids = ALL_IDS.filter(id =>
      queue.some(r => r.id === id)
    );

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      setQueue(prev => prev.map(r => r.id === id ? { ...r, status: 'running' } : r));
      addLog(`[${i + 1}/${ids.length}] ${id.slice(0, 8)}…`);

      try {
        const result = await gradeOne(id, session.access_token);
        if (result) {
          await (supabase as any)
            .from('transcript_grades')
            .update({ regraded_at: new Date().toISOString() })
            .eq('transcript_id', id);

          setQueue(prev => prev.map(r =>
            r.id === id ? { ...r, status: 'done', grade: result.grade, score: result.score } : r
          ));
          addLog(`✓ ${id.slice(0, 8)} → ${result.grade} (${result.score})`);
        }
      } catch (e: any) {
        setQueue(prev => prev.map(r => r.id === id ? { ...r, status: 'error', error: e.message } : r));
        addLog(`✗ ${id.slice(0, 8)}: ${e.message}`);
      }

      if (i < ids.length - 1) await sleep(4000);
    }
    addLog('Done.');
  };

  const done = queue.filter(r => r.status === 'done').length;
  const errors = queue.filter(r => r.status === 'error').length;
  const processed = queue.filter(r => r.status === 'done' || r.status === 'error').length;
  const total = queue.length;
  const isComplete = !loading && (total === 0 || processed === total);

  return (
    <div className="min-h-screen bg-background px-4 py-8 space-y-5">
      <div className="max-w-md mx-auto space-y-2">
        <h1 className="text-lg font-bold">Re-grading Calls</h1>

        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking what needs to run…
          </p>
        ) : total === 0 ? (
          <p className="text-sm text-green-600">All {alreadyDone} calls already graded ✓</p>
        ) : isComplete ? (
          <p className="text-sm text-muted-foreground">Done — {done} graded, {errors} failed</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {alreadyDone > 0 && `${alreadyDone} already done · `}{processed}/{total} grading…
            </p>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: total > 0 ? `${(processed / total) * 100}%` : '0%' }}
              />
            </div>
          </>
        )}
      </div>

      {!loading && total > 0 && (
        <div className="max-w-md mx-auto space-y-1">
          {queue.map(r => (
            <div key={r.id} className={cn(
              'flex items-center justify-between px-3 py-2 rounded-lg text-sm',
              r.status === 'done' ? 'bg-green-500/5 border border-green-500/20' :
              r.status === 'error' ? 'bg-red-500/5 border border-red-500/20' :
              r.status === 'running' ? 'bg-primary/5 border border-primary/30' :
              'bg-muted/5 border border-border/10'
            )}>
              <span className="font-mono text-xs text-muted-foreground">{r.id.slice(0, 8)}…</span>
              <div className="flex items-center gap-2">
                {r.status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                {r.status === 'done' && <><span className="font-bold text-xs">{r.grade}</span><CheckCircle2 className="h-3.5 w-3.5 text-green-500" /></>}
                {r.status === 'error' && <><span className="text-xs text-red-500 truncate max-w-[120px]">{r.error}</span><AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" /></>}
                {r.status === 'pending' && <span className="text-xs text-muted-foreground/30">—</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {log.length > 0 && (
        <div className="max-w-md mx-auto bg-muted/20 rounded-lg p-3 max-h-28 overflow-y-auto">
          {log.map((l, i) => <p key={i} className="text-[11px] font-mono text-muted-foreground">{l}</p>)}
        </div>
      )}

      {isComplete && total > 0 && (
        <div className="max-w-md mx-auto">
          <button onClick={() => navigate('/coach')} className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
            View Grades in Coach →
          </button>
        </div>
      )}

      {isComplete && total === 0 && (
        <div className="max-w-md mx-auto">
          <button onClick={() => navigate('/coach')} className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
            Go to Coach →
          </button>
        </div>
      )}
    </div>
  );
}
