// Comprehensive Company Monitoring — Never miss a signal
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Radar, RefreshCw, ExternalLink, Eye, Briefcase, UserPlus, Newspaper, Cpu, Podcast, Target } from 'lucide-react';
import { cn } from '@/lib/utils';

const CATEGORY_ICONS: Record<string, any> = {
  executive_hire: UserPlus,
  job_posting: Briefcase,
  company_news: Newspaper,
  tech_change: Cpu,
  podcast: Podcast,
  leadership_change: UserPlus,
  company_goal: Target,
};

const CATEGORY_COLORS: Record<string, string> = {
  executive_hire: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  job_posting: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  company_news: 'bg-primary/10 text-primary border-primary/30',
  tech_change: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
  podcast: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/30',
  leadership_change: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  company_goal: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
};

export function CompanyMonitorCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [isScanning, setIsScanning] = useState(false);

  const { data: digestItems, isLoading } = useQuery({
    queryKey: ['company-monitor', user?.id],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      // Get last 7 days of digest items
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const { data, error } = await supabase
        .from('daily_digest_items')
        .select('*')
        .gte('digest_date', weekAgo.toISOString().split('T')[0])
        .order('relevance_score', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const scanNow = useMutation({
    mutationFn: async () => {
      setIsScanning(true);
      const { data, error } = await supabase.functions.invoke('daily-digest', {
        body: { userId: user!.id },
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['company-monitor'] });
      qc.invalidateQueries({ queryKey: ['daily-digest'] });
      toast.success(`Found ${data?.itemsCreated || 0} signals across ${data?.accountsUpdated || 0} accounts`);
    },
    onError: (err: Error) => toast.error('Scan failed', { description: err.message }),
    onSettled: () => setIsScanning(false),
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('daily_digest_items').update({ is_read: true }).eq('id', id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company-monitor'] }),
  });

  const unread = (digestItems || []).filter((d: any) => !d.is_read);
  const actionable = (digestItems || []).filter((d: any) => d.is_actionable);

  return (
    <Card className="metric-card border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-display flex items-center gap-2">
            <Radar className="h-4 w-4 text-primary" />
            Company Intel Monitor
            {unread.length > 0 && (
              <Badge variant="destructive" className="text-[9px] px-1.5 h-4">{unread.length} new</Badge>
            )}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => scanNow.mutate()} disabled={isScanning}>
            {isScanning ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-1 text-xs">{isScanning ? 'Scanning...' : 'Scan Now'}</span>
          </Button>
        </div>
        {actionable.length > 0 && (
          <p className="text-[11px] text-primary mt-1">{actionable.length} actionable signals detected</p>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (digestItems || []).length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Radar className="h-10 w-10 mx-auto mb-2 opacity-20" />
            <p className="text-sm">No signals detected yet</p>
            <p className="text-xs mt-1">Hit "Scan Now" to check for company developments</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2">
              {(digestItems || []).map((item: any) => {
                const Icon = CATEGORY_ICONS[item.category] || Newspaper;
                const colorClass = CATEGORY_COLORS[item.category] || 'bg-muted text-muted-foreground';
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'p-3 rounded-lg border transition-all',
                      item.is_read ? 'bg-muted/10 opacity-70' : 'bg-muted/30 hover:bg-muted/50',
                      item.is_actionable && !item.is_read && 'border-primary/30',
                    )}
                    onClick={() => !item.is_read && markRead.mutate(item.id)}
                  >
                    <div className="flex items-start gap-2">
                      <div className={cn("rounded-md p-1.5 mt-0.5 shrink-0 border", colorClass)}>
                        <Icon className="h-3 w-3" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                          <span className="text-sm font-semibold">{item.account_name}</span>
                          <Badge variant="outline" className={cn("text-[9px] px-1.5", colorClass)}>
                            {item.category?.replace(/_/g, ' ')}
                          </Badge>
                          {item.is_actionable && !item.is_read && (
                            <Badge variant="default" className="text-[9px] px-1.5 h-4 bg-primary">Action</Badge>
                          )}
                        </div>
                        <p className="text-xs font-medium">{item.headline}</p>
                        {item.summary && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{item.summary}</p>}
                        {item.suggested_action && (
                          <p className="text-[11px] text-primary mt-1 italic">→ {item.suggested_action}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] text-muted-foreground">{item.digest_date}</span>
                          {item.source_url && (
                            <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                              Source <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                        </div>
                      </div>
                      {!item.is_read && <Eye className="h-3 w-3 text-muted-foreground shrink-0 mt-1" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
