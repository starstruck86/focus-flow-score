/**
 * Strategy Workspace — renders inside the global <Layout> shell so it
 * inherits the shared mobile safe-area, sticky header conditional, and
 * BottomNav contract. Layout already hides its KPI/breadcrumb chrome on
 * /strategy and applies the proper main-area padding for nav clearance
 * (see src/components/Layout.tsx).
 *
 * Backend guarantees preserved: trust gates, promotion pipeline,
 * provenance, quarantine, account/opportunity parent-child enforcement,
 * clone-first contamination handling — all flow through unchanged hooks.
 */
import { Layout } from '@/components/Layout';
import { StrategyShell } from '@/components/strategy/v2/StrategyShell';

export default function Strategy() {
  return (
    <Layout>
      <StrategyShell />
    </Layout>
  );
}
