import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { bostonNow } from '@/lib/timeFormat';

/**
 * Live-updating Boston time clock using the canonical time pipeline.
 * Updates every 15 seconds for minimal overhead.
 */
export function BostonClock() {
  const [now, setNow] = useState(bostonNow);

  useEffect(() => {
    const id = setInterval(() => setNow(bostonNow()), 15_000);
    return () => clearInterval(id);
  }, []);

  const display = format(now, "EEEE, MMMM d • h:mm a");

  return (
    <span className="text-[10px] text-muted-foreground whitespace-nowrap" title="Boston time (ET)">
      {display} ET
    </span>
  );
}
