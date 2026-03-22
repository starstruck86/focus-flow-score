// Comprehensive Company Monitoring — Never miss a signal, auto-create tasks + generate outreach
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Radar, RefreshCw, ExternalLink, Eye, Briefcase, UserPlus, Newspaper, Cpu, Podcast, Target, Zap, Mail, Copy, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSignalTriggeredTasks } from '@/hooks/useSignalTriggeredTasks';

const CATEGORY_ICONS: Record<string, any> = {
  executive_hire: UserPlus,
  job_posting: Briefcase,
  company_news: Newspaper,
  tech_change: Cpu,
  podcast: Podcast,
  leadership_change: UserPlus,
  company_goal: Target,
  competitive_displacement: Zap,
};

const CATEGORY_COLORS: Record<string, string> = {
  executive_hire: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  job_posting: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  company_news: 'bg-primary/10 text-primary border-primary/30',
  tech_change: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
  podcast: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/30',
  leadership_change: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  company_goal: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  competitive_displacement: 'bg-destructive/10 text-destructive border-destructive/30',
};

interface CompanyMonitorCardProps {
  motionFilter?: 'new-logo' | 'renewal';
}

export function CompanyMonitorCard({ motionFilter }: CompanyMonitorCardProps = {}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [isScanning, setIsScanning] = useState(false);
  const [outreachModal, setOutreachModal] = useState<{ open: boolean; item: any | null; draft: string; loading: boolean }>({ open: false, item: null, draft: '', loading: false });
  const { createTasksFromSignals } = useSignalTriggeredTasks();

  const { data: digestItems, isLoading } = useQuery({
    queryKey: ['company-monitor', user?.id, motionFilter],
    queryFn: async () => {
      if (!user) return [];
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const { data, error } = await supabase
        .from('daily_digest_items')
        .select('*')
        .eq('user_id', user.id)
        .gte('digest_date', weekAgo.toISOString().split('T')[0])
        .order('relevance_score', { ascending: false })
        .limit(50);
      if (error) throw error;
      let items = data || [];
      
      // Filter by account motion if specified
      if (motionFilter && items.length > 0) {
        const accountIds = items.map(i => i.account_id).filter(Boolean);
        if (accountIds.length > 0) {
          const { data: accounts } = await supabase
            .from('accounts')
            .select('id, motion')
            .eq('user_id', user.id)
            .in('id', accountIds as string[]);
          const validIds = new Set((accounts || []).filter(a => a.motion === motionFilter).map(a => a.id));
          items = items.filter(i => i.account_id && validIds.has(i.account_id));
        }
      }
      
      return items.slice(0, 20);
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const scanNow = useMutation({
    mutationFn: async () => {
      setIsScanning(true);
      const { data, error } = await trackedInvoke<{ itemsCreated: number; accountsUpdated: number }>('daily-digest', {
        body: { userId: user!.id },
        componentName: 'CompanyMonitorCard',
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async (data) => {
      qc.invalidateQueries({ queryKey: ['company-monitor'] });
      qc.invalidateQueries({ queryKey: ['daily-digest'] });
      toast.success(`Found ${data?.itemsCreated || 0} signals across ${data?.accountsUpdated || 0} accounts`);

      // Auto-create tasks from actionable signals
      if (data?.itemsCreated > 0) {
        // Re-fetch to get the new items with account_ids
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const { data: newItems } = await supabase
          .from('daily_digest_items')
          .select('*')
          .eq('user_id', user!.id)
          .eq('digest_date', new Date().toISOString().split('T')[0])
          .eq('is_actionable', true);

        if (newItems?.length) {
          // Group by account
          const byAccount = new Map<string, any[]>();
          for (const item of newItems) {
            if (!item.account_id) continue;
            const list = byAccount.get(item.account_id) || [];
            list.push({ type: item.category, headline: item.headline, source: item.source_url || 'daily_digest', date: item.digest_date });
            byAccount.set(item.account_id, list);
          }
          for (const [accountId, triggers] of byAccount) {
            const accountName = newItems.find(i => i.account_id === accountId)?.account_name || '';
            await createTasksFromSignals(accountId, accountName, triggers);
          }
        }
      }
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

  // Generate outreach draft from a signal
  const generateOutreach = async (item: any) => {
    setOutreachModal({ open: true, item, draft: '', loading: true });
    try {
      const { data, error } = await trackedInvoke<any>('search-context', {
        body: {
          query: `Generate a short, personalized cold outreach email (3-4 sentences max) for a sales rep selling lifecycle marketing / CRM software. Reference this specific signal about the company "${item.account_name}": "${item.headline}". ${item.summary || ''}. The tone should be consultative, not salesy. Include a specific call-to-action. Do NOT use generic templates.`,
          mode: 'quick',
        },
      });
      if (error) throw error;
      setOutreachModal(prev => ({ ...prev, draft: data?.answer || 'Could not generate outreach.', loading: false }));
    } catch {
      setOutreachModal(prev => ({ ...prev, draft: 'Failed to generate outreach. Try again.', loading: false }));
    }
  };

  const copyOutreach = () => {
    navigator.clipboard.writeText(outreachModal.draft);
    toast.success('Copied to clipboard');
  };

  const unread = (digestItems || []).filter((d: any) => !d.is_read);
  const actionable = (digestItems || []).filter((d: any) => d.is_actionable);

  return (
    <>
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
            <p className="text-[11px] text-primary mt-1">
              {actionable.length} actionable signals — tasks auto-created
            </p>
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
                              <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                                Source <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            )}
                            {item.is_actionable && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 text-[10px] px-1.5 gap-0.5 text-primary hover:text-primary"
                                onClick={(e) => { e.stopPropagation(); generateOutreach(item); }}
                              >
                                <Mail className="h-2.5 w-2.5" />Draft Outreach
                              </Button>
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

      {/* Outreach Draft Modal */}
      <Dialog open={outreachModal.open} onOpenChange={(open) => setOutreachModal(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4 text-primary" />
              Signal-Based Outreach
            </DialogTitle>
          </DialogHeader>
          {outreachModal.item && (
            <div className="space-y-3">
              <div className="p-2 rounded bg-muted/30 border text-xs">
                <span className="font-semibold">{outreachModal.item.account_name}</span>: {outreachModal.item.headline}
              </div>
              {outreachModal.loading ? (
                <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Generating personalized outreach...</span>
                </div>
              ) : (
                <>
                  <div className="p-3 rounded-lg border bg-background whitespace-pre-wrap text-sm leading-relaxed">
                    {outreachModal.draft}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="default" className="gap-1.5" onClick={copyOutreach}>
                      <Copy className="h-3.5 w-3.5" />Copy
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => generateOutreach(outreachModal.item)}>
                      <RefreshCw className="h-3.5 w-3.5" />Regenerate
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
