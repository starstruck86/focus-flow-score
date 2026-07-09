/**
 * DeferredStartupTasks — coordinates non-critical app-shell mounts.
 *
 * - DurableJobRehydrator mounts IMMEDIATELY after user.id exists — it bridges
 *   durable job state and must be timely (not deferred).
 * - installPendingWriteSync() runs on idle after auth — no auto side-effect
 *   at module load anymore.
 * - BackgroundJobIndicator, BackgroundJobDrawer, SystemHealthBadge mount only
 *   after the browser is idle, behind Suspense (lazy imports).
 *
 * Explicitly does NOT touch DataSyncProvider / useDataSync — that idle gate
 * would break routes that depend on synchronous hydration.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DurableJobRehydrator } from '@/components/jobs/DurableJobRehydrator';
import { installPendingWriteSync } from '@/lib/pendingWriteSync';

const BackgroundJobIndicator = lazy(() =>
  import('@/components/jobs/BackgroundJobIndicator').then(m => ({ default: m.BackgroundJobIndicator })),
);
const BackgroundJobDrawer = lazy(() =>
  import('@/components/jobs/BackgroundJobDrawer').then(m => ({ default: m.BackgroundJobDrawer })),
);
const SystemHealthBadge = lazy(() =>
  import('@/components/SystemHealthBadge').then(m => ({ default: m.SystemHealthBadge })),
);

type IdleCallbackHandle = number;
interface IdleWindow extends Window {
  requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => IdleCallbackHandle;
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
}

export function DeferredStartupTasks() {
  const { user } = useAuth();
  const [idleReady, setIdleReady] = useState(false);

  // Install pending-write sync + flip idleReady once the browser is idle,
  // but only after we know who the user is.
  useEffect(() => {
    if (!user?.id) return;

    let cleanupInstaller: (() => void) | null = null;
    const w = window as IdleWindow;

    let idleHandle: IdleCallbackHandle | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const run = () => {
      cleanupInstaller = installPendingWriteSync();
      setIdleReady(true);
    };

    if (typeof w.requestIdleCallback === 'function') {
      idleHandle = w.requestIdleCallback(run, { timeout: 2500 });
    } else {
      fallbackTimer = setTimeout(run, 1200);
    }

    return () => {
      if (idleHandle != null && typeof w.cancelIdleCallback === 'function') {
        w.cancelIdleCallback(idleHandle);
      }
      if (fallbackTimer) clearTimeout(fallbackTimer);
      cleanupInstaller?.();
    };
  }, [user?.id]);

  return (
    <>
      {/* Durable job rehydrator is timing-sensitive — mount immediately once authed. */}
      {user?.id && <DurableJobRehydrator />}

      {idleReady && (
        <Suspense fallback={null}>
          <BackgroundJobIndicator />
          <BackgroundJobDrawer />
          <SystemHealthBadge />
        </Suspense>
      )}
    </>
  );
}
