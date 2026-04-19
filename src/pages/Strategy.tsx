/**
 * Strategy Workspace — Phase 1 redesign.
 *
 * Strategy renders INSIDE the global <Layout> shell so it inherits the shared
 * mobile header, safe-area handling, and bottom-nav clearance. Layout already
 * hides its KPI/breadcrumb chrome on /strategy and shows a compact sticky
 * header (see src/components/Layout.tsx). This page fills the available
 * <main> height with its own two-region (canvas + composer) layout.
 *
 * Backend guarantees preserved: trust gates, promotion pipeline, provenance,
 * quarantine, account/opportunity parent-child enforcement, clone-first
 * contamination handling — all flow through unchanged hooks.
 */
import { StrategyShell } from '@/components/strategy/v2/StrategyShell';

export default function Strategy() {
  return (
    <div
      className="flex flex-col h-full min-h-0"
      style={{ background: 'hsl(40 12% 98%)' }}
      data-testid="main-content"
    >
      <StrategyShell />
    </div>
  );
}
