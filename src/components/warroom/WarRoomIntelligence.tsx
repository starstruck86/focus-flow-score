import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateWarRoom } from '@/hooks/useWarRooms';
import { useDebouncedCallback } from '@/hooks/useDebouncedUpdate';
import type { WarRoomRow } from '@/hooks/useWarRooms';

export function WarRoomIntelligence({ war }: { war: WarRoomRow }) {
  const { mutate: update } = useUpdateWarRoom();
  const [notes, setNotes] = useState(war.intelligence_notes ?? '');
  const flush = useDebouncedCallback((v: string) => update({ id: war.id, updates: { intelligence_notes: v } }), 800);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        PMF/GTM read, leadership quality, quota realism, inbound vs outbound, ACV, org structure, risks, RepVue/Glassdoor signals, evolving understanding.
      </p>
      <Textarea
        value={notes}
        onChange={(e) => { setNotes(e.target.value); flush(e.target.value); }}
        placeholder="Add company & role intelligence here..."
        className="min-h-[200px] text-sm"
      />
    </div>
  );
}
