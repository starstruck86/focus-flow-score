import { useState } from 'react';
import { useSystemHealth } from '@/hooks/useSystemHealth';
import { useNavigate } from 'react-router-dom';
import { Activity, CheckCircle2, AlertTriangle, XCircle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SystemHealthBadge() {
  const { health, isLoading } = useSystemHealth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  if (isLoading || !health) return null;

  const color = health.status === 'ok'
    ? 'text-green-400'
    : health.status === 'partial_failure'
      ? 'text-yellow-400'
      : 'text-red-400';

  const bgColor = health.status === 'ok'
    ? 'bg-green-500/20 border-green-500/30'
    : health.status === 'partial_failure'
      ? 'bg-yellow-500/20 border-yellow-500/30'
      : 'bg-red-500/20 border-red-500/30';

  const label = health.status === 'ok' ? 'Healthy' : health.status === 'partial_failure' ? 'Degraded' : 'Failed';
  const ago = getTimeAgo(health.created_at);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* Badge button */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium shadow-lg backdrop-blur-sm transition-all hover:scale-105',
          bgColor, color,
        )}
        title="AI System Health"
      >
        <Activity className="size-3.5" />
        <span className="hidden sm:inline">{label}</span>
      </button>

      {/* Detail panel */}
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-72 rounded-lg border border-border bg-popover p-4 shadow-xl text-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">AI System Health</span>
            <span className={cn('text-xs font-medium', color)}>{label}</span>
          </div>

          <div className="text-xs text-muted-foreground">Last run: {ago}</div>

          {/* Provider health */}
          <div className="flex gap-2 flex-wrap">
            {Object.entries(health.provider_health).map(([p, ok]) => (
              <span key={p} className={cn('px-2 py-0.5 rounded text-xs border', ok ? 'border-green-600/30 text-green-400' : 'border-red-600/30 text-red-400')}>
                {p}: {ok ? '✓' : '✗'}
              </span>
            ))}
          </div>

          {/* Counts */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>Infra: <span className="text-green-400">{health.infra_passed}✓</span> <span className="text-red-400">{health.infra_failed}✗</span></div>
            <div>E2E: <span className="text-green-400">{health.e2e_passed}✓</span> <span className="text-red-400">{health.e2e_failed}✗</span></div>
          </div>

          {/* Failed tests */}
          {health.failed_tests.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-red-400">Failing:</div>
              {health.failed_tests.slice(0, 5).map((t, i) => (
                <div key={i} className="text-xs text-muted-foreground truncate">
                  {t.test}{t.error ? `: ${t.error}` : ''}
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => { setOpen(false); navigate('/smoke-test'); }}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="size-3" /> Open full dashboard
          </button>
        </div>
      )}
    </div>
  );
}

function getTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
