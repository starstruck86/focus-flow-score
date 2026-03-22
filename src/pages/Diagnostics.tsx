/**
 * /ops — Hidden diagnostics page for debugging failures.
 * Shows recent AppErrors with trace IDs, categories, and metadata.
 * Also shows current environment info and connection status.
 */

import { useState, useEffect, useSyncExternalStore } from 'react';
import { Layout } from '@/components/Layout';
import { getRecentErrors, subscribeErrors, clearErrors, type AppError } from '@/lib/appError';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Trash2, RefreshCw, Copy, ChevronDown, ChevronUp, Activity, Shield, Wifi, AlertTriangle, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

function useErrorStore() {
  return useSyncExternalStore(
    subscribeErrors,
    () => getRecentErrors(),
    () => getRecentErrors(),
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  AUTH_ERROR: 'bg-red-500/20 text-red-400 border-red-500/30',
  NETWORK_ERROR: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  FUNCTION_TIMEOUT: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  FUNCTION_404: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  FUNCTION_401: 'bg-red-500/20 text-red-400 border-red-500/30',
  DB_WRITE_FAILED: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  RATE_LIMITED: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  VALIDATION_ERROR: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  MODEL_RESPONSE_INVALID: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  UNKNOWN: 'bg-muted text-muted-foreground border-border',
};

function ErrorRow({ err, index }: { err: AppError; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const age = Date.now() - err.timestamp;
  const ageStr = age < 60_000 ? `${Math.round(age / 1000)}s ago` : age < 3_600_000 ? `${Math.round(age / 60_000)}m ago` : `${Math.round(age / 3_600_000)}h ago`;

  return (
    <div className={cn('border rounded-lg p-3 space-y-1.5', age < 30_000 ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn('text-[10px] font-mono', CATEGORY_COLORS[err.category] || CATEGORY_COLORS.UNKNOWN)}>
              {err.category}
            </Badge>
            {err.retryable && <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">retryable</Badge>}
            <span className="text-[10px] text-muted-foreground">{ageStr}</span>
          </div>
          <p className="text-sm text-foreground mt-1 break-words">{err.message}</p>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground font-mono">
            <span>trace: {err.traceId}</span>
            {err.functionName && <span>fn: {err.functionName}</span>}
            {err.componentName && <span>comp: {err.componentName}</span>}
            {err.route && <span>route: {err.route}</span>}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
            navigator.clipboard.writeText(JSON.stringify(err, null, 2));
            toast.success('Error copied to clipboard');
          }}>
            <Copy className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </div>
      </div>
      {expanded && (
        <pre className="text-[10px] text-muted-foreground bg-muted/50 rounded p-2 overflow-auto max-h-40 font-mono">
{JSON.stringify({ rawMessage: err.rawMessage, code: err.code, source: err.source, metadata: err.metadata }, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function Diagnostics() {
  const errors = useErrorStore();
  const { user, session } = useAuth();
  const [filter, setFilter] = useState<string>('all');
  const [, setTick] = useState(0);

  // Refresh timestamps every 10s
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 10_000);
    return () => clearInterval(iv);
  }, []);

  const categories = ['all', ...new Set(errors.map(e => e.category))];
  const filtered = filter === 'all' ? errors : errors.filter(e => e.category === filter);
  const sorted = [...filtered].reverse(); // newest first

  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto p-4 space-y-4 pb-24">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold text-foreground">Ops Diagnostics</h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => { clearErrors(); toast.success('Error log cleared'); }}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Clear
          </Button>
        </div>

        {/* Environment card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Environment
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div><span className="text-muted-foreground">User:</span> {user?.email ?? '—'}</div>
            <div><span className="text-muted-foreground">UID:</span> {user?.id?.slice(0, 8) ?? '—'}</div>
            <div><span className="text-muted-foreground">Route:</span> {window.location.pathname}</div>
            <div className="flex items-center gap-1.5">
              <Wifi className={cn('h-3 w-3', online ? 'text-emerald-400' : 'text-destructive')} />
              <span>{online ? 'Online' : 'Offline'}</span>
            </div>
            <div><span className="text-muted-foreground">Session:</span> {session ? 'Active' : 'None'}</div>
            <div><span className="text-muted-foreground">Env:</span> {import.meta.env.DEV ? 'Development' : 'Production'}</div>
          </CardContent>
        </Card>

        {/* Summary */}
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{errors.length} total error{errors.length !== 1 ? 's' : ''}</span>
          {errors.filter(e => e.retryable).length > 0 && (
            <span className="text-emerald-400">{errors.filter(e => e.retryable).length} retryable</span>
          )}
          {errors.filter(e => e.category === 'AUTH_ERROR').length > 0 && (
            <span className="text-red-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {errors.filter(e => e.category === 'AUTH_ERROR').length} auth errors
            </span>
          )}
        </div>

        {/* Category filter */}
        {categories.length > 1 && (
          <div className="flex gap-1.5 flex-wrap">
            {categories.map(cat => (
              <Button
                key={cat}
                variant={filter === cat ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setFilter(cat)}
              >
                {cat === 'all' ? 'All' : cat}
              </Button>
            ))}
          </div>
        )}

        {/* Error list */}
        <div className="space-y-2">
          {sorted.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No errors recorded. Errors from API calls, component crashes, and edge functions will appear here.
            </div>
          )}
          {sorted.map((err, i) => (
            <ErrorRow key={`${err.traceId}-${i}`} err={err} index={i} />
          ))}
        </div>
      </div>
    </Layout>
  );
}
