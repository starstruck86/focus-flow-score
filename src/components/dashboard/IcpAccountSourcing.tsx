// ICP Account Sourcing — AI-powered prospect discovery with feedback loop
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Crosshair, Sparkles, ThumbsUp, ThumbsDown, ExternalLink, Plus, RefreshCw, Linkedin, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

export function IcpAccountSourcing() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState('');
  const [isSourcing, setIsSourcing] = useState(false);

  // Get latest batch
  const { data: latestBatch, isLoading } = useQuery({
    queryKey: ['icp-sourced-accounts', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('icp_sourced_accounts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const currentBatchId = latestBatch?.[0]?.batch_id;

  const sourceMutation = useMutation({
    mutationFn: async () => {
      setIsSourcing(true);
      const { data, error } = await supabase.functions.invoke('source-icp-accounts', {
        body: { feedback: feedback || null, previousBatchId: currentBatchId || null },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Sourcing failed');
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['icp-sourced-accounts'] });
      setFeedback('');
      toast.success('Found 5 new prospect accounts');
    },
    onError: (err: Error) => {
      toast.error('Account sourcing failed', { description: err.message });
    },
    onSettled: () => setIsSourcing(false),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, feedbackText }: { id: string; status: string; feedbackText?: string }) => {
      const { error } = await supabase
        .from('icp_sourced_accounts')
        .update({ status, feedback: feedbackText || null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['icp-sourced-accounts'] }),
  });

  const hasResults = (latestBatch?.length || 0) > 0;

  return (
    <Card className="metric-card border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-display flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-primary" />
            ICP Account Sourcing
          </CardTitle>
          <Button
            variant={hasResults ? 'ghost' : 'default'}
            size="sm"
            onClick={() => sourceMutation.mutate()}
            disabled={isSourcing}
            className={cn(!hasResults && 'gap-1.5')}
          >
            {isSourcing ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : !hasResults ? (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Find Prospects
              </>
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !hasResults ? (
          <div className="text-center py-8 text-muted-foreground">
            <Crosshair className="h-10 w-10 mx-auto mb-2 opacity-20" />
            <p className="text-sm">AI-powered prospect discovery</p>
            <p className="text-xs mt-1">Finds 5 ICP-matching accounts based on buying signals</p>
          </div>
        ) : (
          <>
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-2">
                {latestBatch!.map((account: any) => (
                  <div
                    key={account.id}
                    className={cn(
                      'p-3 rounded-lg border transition-all',
                      account.status === 'accepted' && 'border-primary/30 bg-primary/5',
                      account.status === 'rejected' && 'border-destructive/20 bg-muted/20 opacity-60',
                      account.status === 'new' && 'border-border bg-muted/30 hover:bg-muted/50',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-semibold">{account.company_name}</span>
                          <Badge variant="outline" className="text-[9px] px-1.5">ICP {account.fit_score}</Badge>
                          {account.website && (
                            <a href={account.website.startsWith('http') ? account.website : `https://${account.website}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        {account.industry && (
                          <p className="text-[11px] text-muted-foreground">{account.industry} {account.employee_count ? `• ${account.employee_count}` : ''}</p>
                        )}
                        <p className="text-xs mt-1">{account.icp_fit_reason}</p>
                        {account.trigger_signal && (
                          <div className="mt-1.5 flex items-start gap-1">
                            <Sparkles className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                            <span className="text-[11px] text-primary">{account.trigger_signal}</span>
                          </div>
                        )}
                        {/* Suggested contacts */}
                        {(account.suggested_contacts as any[])?.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Users className="h-2.5 w-2.5" /> Key contacts:
                            </div>
                            {(account.suggested_contacts as any[]).slice(0, 3).map((c: any, i: number) => (
                              <div key={i} className="flex items-center gap-1.5 text-[11px]">
                                <span className="font-medium">{c.name}</span>
                                <span className="text-muted-foreground">— {c.title}</span>
                                {c.linkedin_url && (
                                  <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-500">
                                    <Linkedin className="h-2.5 w-2.5" />
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {account.status === 'new' && (
                        <div className="flex flex-col gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-primary hover:text-primary"
                            onClick={() => updateStatus.mutate({ id: account.id, status: 'accepted' })}
                          >
                            <ThumbsUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              const reason = prompt('Why skip this account? (optional)');
                              updateStatus.mutate({ id: account.id, status: 'rejected', feedbackText: reason || undefined });
                            }}
                          >
                            <ThumbsDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                      {account.status === 'accepted' && (
                        <Badge variant="outline" className="text-[9px] bg-primary/10 text-primary border-primary/30">Added</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            {/* Feedback for next batch */}
            <div className="space-y-2 pt-2 border-t border-border/50">
              <Textarea
                placeholder="Feedback for next batch (e.g., 'more DTC brands' or 'focus on companies with 500+ employees')..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                className="min-h-[60px] text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5"
                onClick={() => sourceMutation.mutate()}
                disabled={isSourcing}
              >
                {isSourcing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Find 5 More {feedback ? '(with feedback)' : ''}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
