import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateWarRoom } from '@/hooks/useWarRooms';
import { useDebouncedCallback } from '@/hooks/useDebouncedUpdate';
import type { WarRoomRow } from '@/hooks/useWarRooms';

export function WarRoomLogistics({ war }: { war: WarRoomRow }) {
  const { mutate: update } = useUpdateWarRoom();
  const [location, setLocation] = useState(war.office_location ?? '');
  const [notes, setNotes] = useState(war.logistics_notes ?? '');
  const flushLocation = useDebouncedCallback((v: string) => update({ id: war.id, updates: { office_location: v } }), 800);
  const flushNotes = useDebouncedCallback((v: string) => update({ id: war.id, updates: { logistics_notes: v } }), 800);

  return (
    <div className="space-y-3">
      <div>
        <label className="text-[10px] text-muted-foreground">Office Location</label>
        <Input value={location} onChange={(e) => { setLocation(e.target.value); flushLocation(e.target.value); }} placeholder="City, address..." className="h-8 text-sm" />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground">Logistics & Lifestyle Notes</label>
        <p className="text-xs text-muted-foreground mb-1">Commute, travel, hybrid expectations, schedule, family/lifestyle impact.</p>
        <Textarea value={notes} onChange={(e) => { setNotes(e.target.value); flushNotes(e.target.value); }} placeholder="Practical realities..." className="min-h-[120px] text-sm" />
      </div>
    </div>
  );
}
