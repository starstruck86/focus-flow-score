/**
 * Strategy Workspace — Phase 1 redesign.
 * Shell-only file. All composition lives in StrategyShell.
 *
 * Backend guarantees preserved: trust gates, promotion pipeline, provenance,
 * quarantine, account/opportunity parent-child enforcement, clone-first
 * contamination handling — all flow through unchanged hooks.
 */
import { useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { StrategyShell } from '@/components/strategy/v2/StrategyShell';

export default function Strategy() {
  // Make Layout's <main> a flex container so the shell fills it without
  // its own scroll context fighting the canvas.
  useEffect(() => {
    const main = document.querySelector('main[data-testid="main-content"]');
    if (!main) return;
    main.classList.add('!overflow-hidden', '!flex', '!flex-col', '!p-0');
    return () => {
      main.classList.remove('!overflow-hidden', '!flex', '!flex-col', '!p-0');
    };
  }, []);

  return (
    <Layout hideFloatingFab>
      <StrategyShell />
    </Layout>
  );
}
