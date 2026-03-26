import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useGroupDrift } from '@/hooks/useGroupDrift';
import { driftErrorMessage } from '@/lib/functionGroupDrift';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RefreshCw, Link2, Unlink, Activity, Moon, Zap, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';

// ── Connection state model ─────────────────────────────────────
type WhoopConnectionState =
  | 'not_connected'
  | 'connected_healthy'
  | 'token_expired'
  | 'syncing'
  | 'sync_failed'
  | 'connected_no_data';

interface WhoopConnection {
  id: string;
  whoop_user_id: string | null;
  updated_at: string;
  token_expires_at: string;
}

interface WhoopMetric {
  id: string;
  date: string;
  recovery_score: number | null;
  sleep_score: number | null;
  strain_score: number | null;
}

interface SyncFamilyResult {
  name: 'cycles' | 'recovery' | 'sleep';
  ok: boolean;
  count: number;
  valueCount?: number;
  reason?: 'missing_scope' | 'endpoint_error' | 'parse_error' | 'empty_response' | 'auth_error';
  error?: string;
  httpStatus?: number;
}

function deriveConnectionState(
  connection: WhoopConnection | null,
  metrics: WhoopMetric[],
  syncError: string | null,
  isSyncing: boolean,
): WhoopConnectionState {
  if (!connection) return 'not_connected';
  if (isSyncing) return 'syncing';

  // Check token expiry client-side (with 5min buffer)
  const expiresAt = new Date(connection.token_expires_at).getTime();
  const now = Date.now();
  if (expiresAt < now + 5 * 60 * 1000) return 'token_expired';

  if (syncError) return 'sync_failed';
  if (metrics.length === 0) return 'connected_no_data';
  return 'connected_healthy';
}

// ── Status badge ───────────────────────────────────────────────
function StatusBadge({ state }: { state: WhoopConnectionState }) {
  switch (state) {
    case 'connected_healthy':
      return <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Healthy</Badge>;
    case 'token_expired':
      return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Token Expired</Badge>;
    case 'syncing':
      return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Syncing</Badge>;
    case 'sync_failed':
      return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Sync Failed</Badge>;
    case 'connected_no_data':
      return <Badge variant="secondary" className="gap-1"><Activity className="h-3 w-3" /> No Data</Badge>;
    default:
      return <Badge variant="secondary" className="gap-1"><XCircle className="h-3 w-3" /> Not Connected</Badge>;
  }
}

// ── Score color helper ─────────────────────────────────────────
function scoreColor(score: number | null, type: 'recovery' | 'sleep' | 'strain') {
  if (score == null) return 'text-muted-foreground';
  if (type === 'strain') {
    if (score >= 18) return 'text-destructive';
    if (score >= 14) return 'text-yellow-500';
    return 'text-green-500';
  }
  if (score >= 67) return 'text-green-500';
  if (score >= 34) return 'text-yellow-500';
  return 'text-destructive';
}

function shouldReconnect(syncError: string | null, connectionState: WhoopConnectionState) {
  if (connectionState === 'token_expired') return true;
  if (!syncError) return false;
  return /auth_error|missing_scope|missing_offline_scope/i.test(syncError);
}

// ── Main component ─────────────────────────────────────────────
export function WhoopIntegration() {
  const { user } = useAuth();
  const whoopDrift = useGroupDrift('whoop');
  const [searchParams, setSearchParams] = useSearchParams();
  const [connection, setConnection] = useState<WhoopConnection | null>(null);
  const [metrics, setMetrics] = useState<WhoopMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const connectionState = deriveConnectionState(connection, metrics, syncError, syncing);
  const reconnectRequired = shouldReconnect(syncError, connectionState);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: conn } = await supabase
        .from('whoop_connections')
        .select('id, whoop_user_id, updated_at, token_expires_at')
        .eq('user_id', user.id)
        .maybeSingle();

      setConnection(conn);

      if (conn) {
        const { data: metricsData } = await supabase
          .from('whoop_daily_metrics')
          .select('id, date, recovery_score, sleep_score, strain_score')
          .eq('user_id', user.id)
          .order('date', { ascending: false })
          .limit(7);
        setMetrics(metricsData || []);
      } else {
        setMetrics([]);
        setSyncError(null);
      }
    } catch (err) {
      console.error('Failed to load WHOOP data:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Handle OAuth callback
  useEffect(() => {
    const whoopStatus = searchParams.get('whoop');
    if (whoopStatus === 'success') {
      toast.success('WHOOP connected successfully!');
      // Clear ALL stale state before reloading fresh data
      setSyncError(null);
      setConnection(null);
      setMetrics([]);
      searchParams.delete('whoop');
      setSearchParams(searchParams, { replace: true });
      // Reload to pick up fresh connection + optionally trigger sync
      loadData().then(() => {
        // Auto-sync after reconnect
        syncData();
      });
    } else if (whoopStatus === 'error') {
      toast.error('Failed to connect WHOOP. Please try again.');
      searchParams.delete('whoop');
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  useEffect(() => {
    if (user) loadData();
  }, [user, loadData]);

  async function handleConnect() {
    setConnecting(true);
    // Clear any stale local state before starting OAuth
    setSyncError(null);
    setConnection(null);
    setMetrics([]);
    try {
      // Use authenticatedFetch (raw fetch) instead of trackedInvoke (SDK invoke)
      // to bypass the Lovable preview fetch proxy that interferes with POST requests.
      const resp = await authenticatedFetch({
        functionName: 'whoop-auth',
        body: { redirectUri: window.location.origin },
        componentName: 'WhoopIntegration',
        retry: false, // OAuth initiation should not retry
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        const msg = errBody.error || errBody.detail || `HTTP ${resp.status}`;
        console.error('WHOOP auth error:', msg, errBody);
        if (/drift|mismatch/i.test(msg)) {
          toast.error('WHOOP functions have a version mismatch', { description: msg, duration: 8000 });
        } else if (/WHOOP_CLIENT_ID|not configured/i.test(msg)) {
          toast.error('WHOOP integration not configured', { description: 'WHOOP API credentials are missing. Add WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET in settings.', duration: 8000 });
        } else if (/Unauthorized|auth|session/i.test(msg)) {
          toast.error('Session expired', { description: 'Sign in again and retry WHOOP connection.', duration: 6000 });
        } else {
          toast.error('Failed to start WHOOP connection', { description: msg, duration: 6000 });
        }
        setConnecting(false);
        return;
      }

      const data = await resp.json();
      if (!data?.authUrl) {
        console.error('WHOOP auth response missing authUrl:', data);
        toast.error('WHOOP connection failed', { description: 'No authorization URL returned. Check WHOOP API credentials.', duration: 6000 });
        setConnecting(false);
        return;
      }
      console.log('[WHOOP] Redirecting to OAuth URL');
      window.location.href = data.authUrl;
    } catch (err: any) {
      console.error('Connect error:', err);
      toast.error('Failed to start WHOOP connection', { description: err?.message || 'Network error', duration: 6000 });
      setConnecting(false);
    }
  }

  async function syncData() {
    setSyncing(true);
    setSyncError(null);
    try {
      const response = await trackedInvoke<any>('whoop-sync', {
        body: { action: 'sync' },
      });
      if (response.error) throw new Error(response.error.message);

      const data = response.data;
      if (data?.needsReconnect) {
        const reconnectMessage = data.scopeDiagnostics?.refreshCapability === 'missing_offline_scope'
          ? 'offline scope missing — reconnect required'
          : (data.errorDetail || 'token_expired');
        setSyncError(reconnectMessage);
        toast.error(data.error || 'WHOOP token expired — please reconnect');
        await loadData();
        return;
      }

      const families: SyncFamilyResult[] = data.families || [];
      const failedFamilies = families.filter((family) => !family.ok);
      const failureSummary = failedFamilies
        .map((family) => `${family.name}: ${family.reason ?? 'unknown'}${family.httpStatus ? ` (${family.httpStatus})` : ''}${family.error ? ` — ${family.error}` : ''}`)
        .join(' · ');

      if (failedFamilies.length > 0) {
        setSyncError(failureSummary || 'sync_failed');
        toast.warning(`Synced ${data.synced} day(s), but ${failureSummary}`);
      } else {
        setSyncError(null);
        toast.success(`Synced ${data.synced} day(s) of WHOOP data`);
      }

      await loadData();
    } catch (err: any) {
      console.error('Sync error:', err);
      setSyncError(err.message || 'sync_failed');
      toast.error(err.message || 'Failed to sync WHOOP data');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const response = await trackedInvoke<any>('whoop-sync', {
        body: { action: 'disconnect' },
      });
      if (response.error) throw new Error(response.error.message);
      setConnection(null);
      setMetrics([]);
      setSyncError(null);
      toast.success('WHOOP disconnected');
    } catch (err: any) {
      console.error('Disconnect error:', err);
      toast.error('Failed to disconnect WHOOP');
    } finally {
      setDisconnecting(false);
    }
  }

  const latestMetric = metrics[0];

  // ── Fail-fast: block WHOOP UI when deployment drift detected ──
  if (whoopDrift) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="font-semibold text-destructive">WHOOP Integration Unavailable</p>
            <p className="text-muted-foreground">
              A deployment version mismatch was detected between WHOOP backend functions.
            </p>
            <div className="rounded bg-muted/50 p-3 font-mono text-xs space-y-1">
              <p><span className="text-muted-foreground">Expected:</span> <span className="font-bold">{whoopDrift.expected}</span> <span className="text-muted-foreground">({whoopDrift.firstFunction})</span></p>
              <p><span className="text-muted-foreground">Actual:</span> <span className="font-bold text-destructive">{whoopDrift.actual}</span> <span className="text-muted-foreground">({whoopDrift.conflictingFunction})</span></p>
            </div>
            <p className="text-muted-foreground text-xs">
              Redeploy all WHOOP functions together (whoop-auth, whoop-callback, whoop-sync) to resolve this issue.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="metric-card">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading WHOOP status...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="metric-card">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">WHOOP</h3>
              <p className="text-sm text-muted-foreground">Recovery, Sleep & Strain</p>
            </div>
          </div>
          <StatusBadge state={connectionState} />
        </div>

        {/* Not connected */}
        {connectionState === 'not_connected' && (
          <Button onClick={handleConnect} disabled={connecting} className="w-full gap-2">
            {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Connect WHOOP
          </Button>
        )}

        {/* Connected states */}
        {connectionState !== 'not_connected' && (
          <div className="space-y-4">
            {/* Token expired banner */}
            {reconnectRequired && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                <p className="text-sm font-medium text-destructive">
                  {connectionState === 'token_expired'
                    ? 'Your WHOOP token has expired. Reconnect to resume syncing.'
                    : `Reconnect required: ${syncError || 'Missing WHOOP authorization scope.'}`}
                </p>
                <Button onClick={handleConnect} disabled={connecting} size="sm" className="gap-1.5">
                  {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                  Reconnect WHOOP
                </Button>
              </div>
            )}

            {/* Non-auth sync failure banner */}
            {!reconnectRequired && connectionState === 'sync_failed' && syncError && (
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-sm font-medium">Partial sync issue</p>
                <p className="mt-1 text-sm text-muted-foreground break-words">{syncError}</p>
              </div>
            )}

            {/* Latest scores */}
            {latestMetric && (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border bg-card p-3 text-center">
                  <Activity className="h-4 w-4 mx-auto mb-1 text-green-500" />
                  <div className={`text-2xl font-bold ${scoreColor(latestMetric.recovery_score, 'recovery')}`}>
                    {latestMetric.recovery_score != null ? `${Math.round(latestMetric.recovery_score)}%` : '—'}
                  </div>
                  <div className="text-xs text-muted-foreground">Recovery</div>
                </div>
                <div className="rounded-lg border bg-card p-3 text-center">
                  <Moon className="h-4 w-4 mx-auto mb-1 text-blue-500" />
                  <div className={`text-2xl font-bold ${scoreColor(latestMetric.sleep_score, 'sleep')}`}>
                    {latestMetric.sleep_score != null ? `${Math.round(latestMetric.sleep_score)}%` : '—'}
                  </div>
                  <div className="text-xs text-muted-foreground">Sleep</div>
                </div>
                <div className="rounded-lg border bg-card p-3 text-center">
                  <Zap className="h-4 w-4 mx-auto mb-1 text-yellow-500" />
                  <div className={`text-2xl font-bold ${scoreColor(latestMetric.strain_score, 'strain')}`}>
                    {latestMetric.strain_score != null ? latestMetric.strain_score.toFixed(1) : '—'}
                  </div>
                  <div className="text-xs text-muted-foreground">Strain</div>
                </div>
              </div>
            )}

            {/* Footer actions */}
            {!reconnectRequired && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Last sync: {connection ? format(parseISO(connection.updated_at), 'MMM d, h:mm a') : '—'}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={syncData} disabled={syncing} className="gap-1.5">
                    {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Sync
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleDisconnect} disabled={disconnecting} className="gap-1.5 text-destructive hover:text-destructive">
                    {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            )}

            {/* Disconnect available even in reconnect state */}
            {reconnectRequired && (
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={handleDisconnect} disabled={disconnecting} className="gap-1.5 text-destructive hover:text-destructive">
                  {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                  Disconnect
                </Button>
              </div>
            )}

            {/* History table */}
            {metrics.length > 0 && (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs text-center">Recovery</TableHead>
                      <TableHead className="text-xs text-center">Sleep</TableHead>
                      <TableHead className="text-xs text-center">Strain</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metrics.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs font-medium">
                          {format(parseISO(m.date), 'EEE, MMM d')}
                        </TableCell>
                        <TableCell className={`text-xs text-center font-semibold ${scoreColor(m.recovery_score, 'recovery')}`}>
                          {m.recovery_score != null ? `${Math.round(m.recovery_score)}%` : '—'}
                        </TableCell>
                        <TableCell className={`text-xs text-center font-semibold ${scoreColor(m.sleep_score, 'sleep')}`}>
                          {m.sleep_score != null ? `${Math.round(m.sleep_score)}%` : '—'}
                        </TableCell>
                        <TableCell className={`text-xs text-center font-semibold ${scoreColor(m.strain_score, 'strain')}`}>
                          {m.strain_score != null ? m.strain_score.toFixed(1) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {metrics.length === 0 && connectionState === 'connected_no_data' && (
              <p className="text-sm text-muted-foreground text-center py-2">
                No metrics yet. Click "Sync" to pull your WHOOP data.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
