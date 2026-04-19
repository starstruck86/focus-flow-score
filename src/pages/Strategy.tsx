/**
 * Strategy Workspace — Phase 1 redesign.
 *
 * Strategy is its own environment. The global app shell (header, BottomNav,
 * BackToToday, Dave FAB) is intentionally NOT rendered here. The only escape
 * hatch back to the rest of the app is ⌘K (Switcher).
 *
 * Backend guarantees preserved: trust gates, promotion pipeline, provenance,
 * quarantine, account/opportunity parent-child enforcement, clone-first
 * contamination handling — all flow through unchanged hooks.
 */
import { StrategyShell } from '@/components/strategy/v2/StrategyShell';

export default function Strategy() {
  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ background: 'hsl(40 12% 98%)' }}
      data-testid="main-content"
    >
      <StrategyShell />
    </div>
  );
}
