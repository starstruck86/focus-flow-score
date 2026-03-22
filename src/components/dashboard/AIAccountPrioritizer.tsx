// AI Account Prioritizer - Morning focus recommendations
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Target, Clock, ArrowRight, RefreshCw, AlertTriangle, Zap, Building2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useLinkedRecordContext } from '@/contexts/LinkedRecordContext';

interface Recommendation {
  account_id?: string;
  account_name: string;
  reason: string;
  action: string;
  urgency: 'critical' | 'high' | 'medium';
  arr_context?: string;
}

interface PrioritizeResult {
  recommendations: Recommendation[];
  morning_insight: string;
}

const URGENCY_STYLES = {
  critical: { bg: 'bg-status-red/10', border: 'border-l-status-red', badge: 'bg-status-red/15 text-status-red', label: 'NOW' },
  high: { bg: 'bg-status-yellow/10', border: 'border-l-status-yellow', badge: 'bg-status-yellow/15 text-status-yellow', label: 'TODAY' },
  medium: { bg: 'bg-primary/10', border: 'border-l-primary', badge: 'bg-primary/15 text-primary', label: 'THIS WEEK' },
};

export function AIAccountPrioritizer() {
  const [result, setResult] = useState<PrioritizeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const navigate = useNavigate();
  const { setCurrentRecord } = useLinkedRecordContext();

  const fetchPriorities = async () => {
    setLoading(true);
    try {
      const { data, error } = await trackedInvoke<PrioritizeResult>('prioritize-accounts', {
        componentName: 'AIAccountPrioritizer',
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      setResult(data);
      setHasLoaded(true);
    } catch (err: any) {
      toast.error('Failed to get AI recommendations', { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleAccountClick = (rec: Recommendation) => {
    if (rec.account_id) {
      setCurrentRecord({ type: 'account', id: rec.account_id });
    }
    navigate('/outreach');
  };

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">AI Focus Recommender</h3>
              <p className="text-[11px] text-muted-foreground">Top accounts to work today</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={fetchPriorities}
            disabled={loading}
          >
            {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            {hasLoaded ? 'Refresh' : 'Get Priorities'}
          </Button>
        </div>
      </div>

      <div className="p-3">
        {!hasLoaded && !loading && (
          <button
            onClick={fetchPriorities}
            className="w-full text-center py-6 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <Sparkles className="h-8 w-8 mx-auto mb-2 text-primary/40" />
            Click to get AI-powered account priorities for today
          </button>
        )}

        {loading && (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        )}

        <AnimatePresence mode="wait">
          {result && !loading && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-2"
            >
              {result.morning_insight && (
                <p className="text-xs text-muted-foreground italic px-1 pb-1 border-b border-border/30 mb-2">
                  💡 {result.morning_insight}
                </p>
              )}

              {result.recommendations.map((rec, i) => {
                const style = URGENCY_STYLES[rec.urgency] || URGENCY_STYLES.medium;
                return (
                  <motion.div
                    key={rec.account_name + i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.08 }}
                    onClick={() => handleAccountClick(rec)}
                    className={cn(
                      "group flex items-start gap-3 rounded-lg border-l-[3px] px-3 py-2.5 cursor-pointer transition-colors hover:bg-accent/30",
                      style.border, style.bg
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">{rec.account_name}</span>
                        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 shrink-0", style.badge)}>
                          {style.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1">{rec.reason}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <ArrowRight className="h-3 w-3 text-primary shrink-0" />
                        <span className="text-xs font-medium text-primary truncate">{rec.action}</span>
                      </div>
                      {rec.arr_context && (
                        <span className="text-[10px] text-muted-foreground">{rec.arr_context}</span>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}
