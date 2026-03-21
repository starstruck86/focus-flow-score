import { useState, useCallback, useEffect } from 'react';
import { Brain, Search, AlertTriangle, CheckCircle, Loader2, Zap, BookOpen, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface TopicCluster {
  topic: string;
  count: number;
  resources: string[];
}

interface KnowledgeGap {
  topic: string;
  severity: 'high' | 'medium' | 'low';
  avgScore: number;
  libraryResources: number;
  diagnosis: string;
  searchQuery: string;
}

interface LibraryStats {
  total: number;
  enriched: number;
  operationalized: number;
  placeholder: number;
}

export function ResourceIntelligenceDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [topics, setTopics] = useState<TopicCluster[]>([]);
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [gapSummary, setGapSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [findingGaps, setFindingGaps] = useState(false);
  const [bulkOperationalizing, setBulkOperationalizing] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    loadStats();
  }, [user?.id]);

  const loadStats = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    try {
      // Fetch resources and digests in parallel
      const [resourcesRes, digestsRes] = await Promise.all([
        supabase.from('resources').select('id, title, content_status').eq('user_id', user.id),
        supabase.from('resource_digests').select('resource_id, use_cases, takeaways').eq('user_id', user.id),
      ]);

      const resources = (resourcesRes.data || []) as any[];
      const digests = (digestsRes.data || []) as any[];
      const digestResourceIds = new Set(digests.map(d => d.resource_id));

      // Calculate stats
      const enriched = resources.filter(r => r.content_status === 'enriched').length;
      const placeholder = resources.filter(r => r.content_status === 'placeholder').length;

      setStats({
        total: resources.length,
        enriched,
        operationalized: digests.length,
        placeholder,
      });

      // Build topic clusters from use_cases
      const topicMap: Record<string, { count: number; resources: string[] }> = {};
      const TOPIC_KEYWORDS: Record<string, string[]> = {
        'Discovery': ['discovery', 'question', 'qualifying', 'pain', 'problem'],
        'Negotiation': ['negotiation', 'pricing', 'discount', 'terms', 'contract'],
        'Objection Handling': ['objection', 'overcome', 'pushback', 'concern', 'resistance'],
        'MEDDICC': ['meddicc', 'meddic', 'economic buyer', 'decision criteria', 'champion'],
        'Command of Message': ['cotm', 'command of the message', 'value driver', 'required capability'],
        'Closing': ['closing', 'close', 'commitment', 'decision', 'sign'],
        'Prospecting': ['prospecting', 'cold call', 'outbound', 'pipeline', 'outreach'],
        'Presentation': ['presentation', 'demo', 'pitch', 'executive', 'storytelling'],
        'Coaching': ['coaching', 'improvement', 'feedback', 'development', 'skill'],
        'Strategy': ['strategy', 'territory', 'planning', 'prioritize', 'account plan'],
      };

      for (const digest of digests) {
        const useCasesText = ((digest.use_cases || []) as string[]).join(' ').toLowerCase();
        const takeawaysText = ((digest.takeaways || []) as string[]).join(' ').toLowerCase();
        const combined = useCasesText + ' ' + takeawaysText;
        const resource = resources.find(r => r.id === digest.resource_id);
        const title = resource?.title || 'Unknown';

        for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
          if (keywords.some(kw => combined.includes(kw))) {
            if (!topicMap[topic]) topicMap[topic] = { count: 0, resources: [] };
            topicMap[topic].count++;
            topicMap[topic].resources.push(title);
          }
        }
      }

      const sortedTopics = Object.entries(topicMap)
        .map(([topic, data]) => ({ topic, ...data }))
        .sort((a, b) => b.count - a.count);

      setTopics(sortedTopics);
    } catch (err) {
      console.error('Failed to load library stats:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const handleFindGaps = useCallback(async () => {
    setFindingGaps(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const resp = await supabase.functions.invoke('detect-knowledge-gaps', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (resp.error) throw resp.error;
      const result = resp.data;

      setGaps(result.gaps || []);
      setGapSummary(result.summary || null);
      toast.success('Gap analysis complete', { description: `Found ${(result.gaps || []).length} knowledge gaps` });
    } catch (err: any) {
      toast.error('Gap analysis failed', { description: err.message });
    } finally {
      setFindingGaps(false);
    }
  }, []);

  const handleBulkOperationalize = useCallback(async () => {
    if (!user?.id) return;
    setBulkOperationalizing(true);

    try {
      // Find resources without digests
      const { data: resources } = await supabase
        .from('resources')
        .select('id, title')
        .eq('user_id', user.id)
        .in('content_status', ['enriched', 'manual', 'file']);

      const { data: digests } = await supabase
        .from('resource_digests')
        .select('resource_id')
        .eq('user_id', user.id);

      const digestIds = new Set((digests || []).map((d: any) => d.resource_id));
      const unoperationalized = (resources || []).filter((r: any) => !digestIds.has(r.id));

      if (!unoperationalized.length) {
        toast.info('All enriched resources are already operationalized');
        return;
      }

      let success = 0;
      for (const resource of unoperationalized.slice(0, 10)) {
        try {
          const { error } = await supabase.functions.invoke('operationalize-resource', {
            body: { resourceId: resource.id },
          });
          if (!error) success++;
        } catch {
          // Continue with next
        }
      }

      toast.success(`Operationalized ${success} resources`, {
        description: unoperationalized.length > 10 ? `${unoperationalized.length - 10} remaining` : undefined,
      });
      loadStats();
    } catch (err: any) {
      toast.error('Bulk operationalize failed', { description: err.message });
    } finally {
      setBulkOperationalizing(false);
    }
  }, [user?.id, loadStats]);

  if (loading) {
    return (
      <Card className="border-border/50 bg-card/80">
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!stats || stats.total === 0) return null;

  const opRate = stats.total > 0 ? Math.round((stats.operationalized / stats.total) * 100) : 0;
  const enrichRate = stats.total > 0 ? Math.round((stats.enriched / stats.total) * 100) : 0;

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-display flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            Library Intelligence
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={handleFindGaps}
              disabled={findingGaps}
            >
              {findingGaps ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Search className="h-3 w-3 mr-1" />}
              Find Gaps
            </Button>
            {stats.operationalized < stats.enriched && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={handleBulkOperationalize}
                disabled={bulkOperationalizing}
              >
                {bulkOperationalizing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
                Bulk Operationalize
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="text-lg font-bold text-foreground">{stats.total}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Resources</div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1">
              <span className="text-lg font-bold text-foreground">{stats.operationalized}</span>
              <span className="text-xs text-muted-foreground">/ {stats.total}</span>
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Operationalized</div>
            <Progress value={opRate} className="h-1 mt-1" />
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1">
              <span className="text-lg font-bold text-foreground">{stats.enriched}</span>
              <span className="text-xs text-muted-foreground">/ {stats.total}</span>
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Enriched</div>
            <Progress value={enrichRate} className="h-1 mt-1" />
          </div>
        </div>

        {/* Topic coverage map */}
        {topics.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Topic Coverage</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {topics.map(t => (
                <Badge
                  key={t.topic}
                  variant="outline"
                  className={cn(
                    'text-[10px]',
                    t.count >= 3 ? 'border-emerald-500/50 text-emerald-500' :
                    t.count >= 1 ? 'border-amber-500/50 text-amber-500' :
                    'border-destructive/50 text-destructive',
                  )}
                >
                  {t.topic} ({t.count})
                </Badge>
              ))}
              {/* Show missing topics */}
              {['Discovery', 'Negotiation', 'Objection Handling', 'MEDDICC', 'Closing', 'Prospecting']
                .filter(t => !topics.find(tc => tc.topic === t))
                .map(t => (
                  <Badge key={t} variant="outline" className="text-[10px] border-destructive/30 text-destructive/60">
                    {t} (0)
                  </Badge>
                ))
              }
            </div>
          </div>
        )}

        {/* Knowledge gaps */}
        {gaps.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Knowledge Gaps</span>
            </div>
            {gapSummary && (
              <p className="text-[11px] text-muted-foreground">{gapSummary}</p>
            )}
            <div className="space-y-1.5">
              {gaps.map((gap, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30 border border-border/30">
                  {gap.severity === 'high' ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                  ) : gap.severity === 'medium' ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">{gap.topic}</span>
                      {gap.avgScore > 0 && (
                        <span className="text-[10px] text-muted-foreground">Avg: {gap.avgScore}/100</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{gap.diagnosis}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Operationalization nudge */}
        {stats.operationalized < stats.enriched && (
          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <p className="text-[11px] text-amber-400">
              ⚡ {stats.enriched - stats.operationalized} enriched resources aren't operationalized yet. 
              You're leaving intelligence on the table.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
