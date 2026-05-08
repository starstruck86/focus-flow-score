import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWarRooms } from '@/hooks/useWarRooms';
import { CreateWarRoomDialog } from '@/components/warroom/CreateWarRoomDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Target } from 'lucide-react';

const VERDICT_COLORS: Record<string, string> = {
  Pursuing: 'bg-blue-500/20 text-blue-400',
  Interested: 'bg-green-500/20 text-green-400',
  Cooling: 'bg-yellow-500/20 text-yellow-400',
  Declined: 'bg-red-500/20 text-red-400',
  Offer: 'bg-purple-500/20 text-purple-400',
  Accepted: 'bg-emerald-500/20 text-emerald-400',
  Ghosted: 'bg-muted text-muted-foreground',
};

export default function WarRooms() {
  const { data: rooms = [], isLoading } = useWarRooms();
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();

  // Sort: next interview soonest first, then by updated_at
  const sorted = [...rooms].sort((a, b) => {
    const aNext = (a.next_interview_json as any)?.when;
    const bNext = (b.next_interview_json as any)?.when;
    if (aNext && !bNext) return -1;
    if (!aNext && bNext) return 1;
    if (aNext && bNext) return aNext.localeCompare(bNext);
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">War Rooms</h1>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1"><Plus className="h-4 w-4" /> New</Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <p className="text-muted-foreground">No War Rooms yet.</p>
          <Button onClick={() => setCreateOpen(true)}>Create your first War Room</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(r => {
            const next = (r.next_interview_json as any);
            return (
              <button
                key={r.id}
                onClick={() => navigate(`/warrooms/${r.id}`)}
                className="w-full text-left p-4 rounded-lg border border-border/50 bg-card/50 hover:bg-card transition-colors flex items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm truncate">{r.account_name ?? r.name}</span>
                    {r.role_title && <span className="text-xs text-muted-foreground">— {r.role_title}</span>}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {r.process_stage && <Badge variant="secondary" className="text-[10px]">{r.process_stage}</Badge>}
                    {r.verdict && <Badge className={VERDICT_COLORS[r.verdict] ?? 'bg-muted text-muted-foreground'}>{r.verdict}</Badge>}
                    {r.work_model && <span className="text-[10px] text-muted-foreground">{r.work_model}</span>}
                  </div>
                </div>
                {next?.when && (
                  <div className="text-right shrink-0">
                    <span className="text-[10px] uppercase text-muted-foreground">Next</span>
                    <div className="text-xs font-medium">{next.when}</div>
                    {next.who && <div className="text-[10px] text-muted-foreground">{next.who}</div>}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      <CreateWarRoomDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
