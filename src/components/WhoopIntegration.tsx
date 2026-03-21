import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RefreshCw, Link2, Unlink, Activity, Moon, Zap, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';

interface WhoopConnection {
  id: string;
  whoop_user_id: string | null;
  updated_at: string;
}

interface WhoopMetric {
  id: string;
  date: string;
  recovery_score: number | null;
  sleep_score: number | null;
  strain_score: number | null;
}

export function WhoopIntegration() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [connection, setConnection] = useState<WhoopConnection | null>(null);
  const [metrics, setMetrics] = useState<WhoopMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  // Handle OAuth callback result
  useEffect(() => {
    const whoopStatus = searchParams.get('whoop');
    if (whoopStatus === 'success') {
      toast.success('WHOOP connected successfully!');
      searchParams.delete('whoop');
      setSearchParams(searchParams, { replace: true });
      loadData();
    } else if (whoopStatus === 'error') {
      toast.error('Failed to connect WHOOP. Please try again.');
      searchParams.delete('whoop');
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  async function loadData() {
    setLoading(true);
    try {
      const { data: conn } = await supabase
        .from('whoop_connections')
        .select('id, whoop_user_id, updated_at')
        .eq('user_id', user!.id)
        .maybeSingle();

      setConnection(conn);

      if (conn) {
        const { data: metricsData } = await supabase
          .from('whoop_daily_metrics')
          .select('id, date, recovery_score, sleep_score, strain_score')
          .eq('user_id', user!.id)
          .order('date', { ascending: false })
          .limit(7);
        setMetrics(metricsData || []);
      } else {
        setMetrics([]);
      }
    } catch (err) {
      console.error('Failed to load WHOOP data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    try {
      const response = await supabase.functions.invoke('whoop-auth', {
        body: { redirectUri: window.location.origin },
      });
      if (response.error) throw new Error(response.error.message);
      window.location.href = response.data.authUrl;
    } catch (err: any) {
      console.error('Connect error:', err);
      toast.error('Failed to start WHOOP connection');
      setConnecting(false);
    }
  }

  async function syncData() {
    setSyncing(true);
    try {
      const response = await supabase.functions.invoke('whoop-sync', {
        body: { action: 'sync' },
      });
      if (response.error) throw new Error(response.error.message);
      const { synced } = response.data;
      toast.success(`Synced ${synced} day(s) of WHOOP data`);
      await loadData();
    } catch (err: any) {
      console.error('Sync error:', err);
      toast.error(err.message || 'Failed to sync WHOOP data');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const response = await supabase.functions.invoke('whoop-sync', {
        body: { action: 'disconnect' },
      });
      if (response.error) throw new Error(response.error.message);
      setConnection(null);
      setMetrics([]);
      toast.success('WHOOP disconnected');
    } catch (err: any) {
      console.error('Disconnect error:', err);
      toast.error('Failed to disconnect WHOOP');
    } finally {
      setDisconnecting(false);
    }
  }

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

  const latestMetric = metrics[0];

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
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">WHOOP</h3>
              <p className="text-sm text-muted-foreground">Recovery, Sleep & Strain tracking</p>
            </div>
          </div>
          <Badge variant={connection ? 'default' : 'secondary'} className="gap-1">
            {connection ? (
              <><CheckCircle2 className="h-3 w-3" /> Connected</>
            ) : (
              <><XCircle className="h-3 w-3" /> Not Connected</>
            )}
          </Badge>
        </div>

        {!connection ? (
          <Button onClick={handleConnect} disabled={connecting} className="w-full gap-2">
            {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Connect WHOOP
          </Button>
        ) : (
          <div className="space-y-4">
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

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Last sync: {format(parseISO(connection.updated_at), 'MMM d, h:mm a')}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={syncData} disabled={syncing} className="gap-1.5">
                  {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Sync Now
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDisconnect} disabled={disconnecting} className="gap-1.5 text-destructive hover:text-destructive">
                  {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                  Disconnect
                </Button>
              </div>
            </div>

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

            {metrics.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">
                No metrics yet. Click "Sync Now" to pull your WHOOP data.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
