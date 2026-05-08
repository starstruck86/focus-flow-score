import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWarRoom, useUpdateWarRoom } from '@/hooks/useWarRooms';
import { WarRoomSnapshot } from '@/components/warroom/WarRoomSnapshot';
import { WarRoomIntelligence } from '@/components/warroom/WarRoomIntelligence';
import { WarRoomTimeline } from '@/components/warroom/WarRoomTimeline';
import { WarRoomLogistics } from '@/components/warroom/WarRoomLogistics';
import { CollapsibleSection } from '@/components/detail/CollapsibleSection';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Crosshair, Brain, Clock, MapPin, MessageSquare } from 'lucide-react';
import { useDebouncedCallback } from '@/hooks/useDebouncedUpdate';

export default function WarRoomDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: war, isLoading } = useWarRoom(id);
  const { mutate: update } = useUpdateWarRoom();

  const [roleTitle, setRoleTitle] = useState('');
  const flushTitle = useDebouncedCallback((v: string) => { if (id) update({ id, updates: { role_title: v } }); }, 600);

  // Sync local state when data loads
  if (war && roleTitle === '' && war.role_title) {
    setRoleTitle(war.role_title);
  }

  if (isLoading) return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Loading War Room...</p></div>;
  if (!war) return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">War Room not found.</p></div>;

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/warrooms')} className="shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold truncate">{war.account_name ?? war.name}</h1>
          <Input
            value={roleTitle || war.role_title || ''}
            onChange={(e) => { setRoleTitle(e.target.value); flushTitle(e.target.value); }}
            placeholder="Role title..."
            className="h-7 text-sm bg-transparent border-transparent hover:border-border focus:border-border mt-0.5 px-0 font-medium text-muted-foreground"
          />
        </div>
      </div>

      {/* Section 1: Snapshot (always open) */}
      <div className="rounded-xl border border-border/50 bg-card/30 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Crosshair className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Snapshot</span>
        </div>
        <WarRoomSnapshot war={war} />
      </div>

      {/* Section 2: Company & Role Intelligence */}
      <CollapsibleSection title="Company & Role Intelligence" icon={Brain} defaultOpen={false}>
        <WarRoomIntelligence war={war} />
      </CollapsibleSection>

      {/* Section 3: Interview Timeline */}
      <CollapsibleSection title="Interview Timeline" icon={Clock} defaultOpen={false}>
        <WarRoomTimeline accountId={war.account_id} />
      </CollapsibleSection>

      {/* Section 4: Logistics */}
      <CollapsibleSection title="Logistics & Practical Reality" icon={MapPin} defaultOpen={false}>
        <WarRoomLogistics war={war} />
      </CollapsibleSection>

      {/* Section 5: Placeholder for Strategy thread (V2.1B) */}
      <div className="rounded-xl border border-dashed border-border/30 bg-card/10 p-6 text-center">
        <MessageSquare className="h-5 w-5 text-muted-foreground mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Strategy thread will be embedded here in V2.1B</p>
      </div>
    </div>
  );
}
