import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateWarRoom } from '@/hooks/useWarRooms';
import { useDebouncedCallback } from '@/hooks/useDebouncedUpdate';
import type { WarRoomRow } from '@/hooks/useWarRooms';

/**
 * Account & Deal Intelligence — freeform evolving understanding of the deal,
 * account dynamics, competitive landscape, org structure, risks, and signals.
 * Reframed from interview-era "Company & Role Intelligence" to sales-native context.
 */
export function DealIntelligenceNotes({ war }: { war: WarRoomRow }) {
  const { mutate: update } = useUpdateWarRoom();
  const [notes, setNotes] = useState(war.intelligence_notes ?? '');
  const flush = useDebouncedCallback((v: string) => update({ id: war.id, updates: { intelligence_notes: v } }), 800);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        PMF/GTM read, competitive landscape, org structure, budget cycle, decision process, risks, champion strength, value drivers, political dynamics.
      </p>
      <Textarea
        value={notes}
        onChange={(e) => { setNotes(e.target.value); flush(e.target.value); }}
        placeholder="Add account & deal intelligence here..."
        className="min-h-[200px] text-sm"
      />
    </div>
  );
}

// Keep backward-compatible export
export { DealIntelligenceNotes as WarRoomIntelligence };
