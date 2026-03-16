import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Briefcase, UserPlus, Newspaper, Cpu, RefreshCw, CheckCheck,
  ExternalLink, ChevronRight, Sparkles, Eye, Calendar as CalendarIcon,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useDailyDigest, type DigestItem } from '@/hooks/useDailyDigest';
import { format, subDays } from 'date-fns';

const categoryConfig: Record<string, { icon: typeof Briefcase; label: string; color: string }> = {
  executive_hire: { icon: UserPlus, label: 'Executive Hire', color: 'text-emerald-500 bg-emerald-500/10' },
  job_posting: { icon: Briefcase, label: 'Job Posting', color: 'text-blue-500 bg-blue-500/10' },
  company_news: { icon: Newspaper, label: 'Company News', color: 'text-amber-500 bg-amber-500/10' },
  tech_change: { icon: Cpu, label: 'Tech Change', color: 'text-purple-500 bg-purple-500/10' },
  news: { icon: Newspaper, label: 'News', color: 'text-muted-foreground bg-muted' },
};

function DigestItemCard({ item, onMarkRead }: { item: DigestItem; onMarkRead: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const config = categoryConfig[item.category] || categoryConfig.news;
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "border rounded-lg p-3 transition-colors cursor-pointer",
        item.isRead ? "bg-muted/30 border-border/50" : "bg-card border-border hover:border-primary/30"
      )}
      onClick={() => {
        setExpanded(!expanded);
        if (!item.isRead) onMarkRead(item.id);
      }}
    >
      <div className="flex items-start gap-3">
        <div className={cn("p-1.5 rounded-md shrink-0 mt-0.5", config.color)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-muted-foreground">{item.accountName}</span>
            {item.isActionable && (
              <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">
                <Sparkles className="h-2.5 w-2.5 mr-0.5" />
                Actionable
              </Badge>
            )}
            {!item.isRead && (
              <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
            )}
          </div>
          <p className={cn("text-sm leading-snug", item.isRead ? "text-muted-foreground" : "text-foreground font-medium")}>
            {item.headline}
          </p>
          
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                {item.summary && (
                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                    {item.summary}
                  </p>
                )}
                {item.suggestedAction && (
                  <div className="mt-2 flex items-start gap-1.5 text-xs">
                    <ChevronRight className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                    <span className="text-primary font-medium">{item.suggestedAction}</span>
                  </div>
                )}
                <div className="flex items-center gap-3 mt-2">
                  {item.sourceUrl && (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Source
                    </a>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    Relevance: {item.relevanceScore}/100
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

export function DailyDigest() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const { items, isLoading, unreadCount, markRead, markAllRead, triggerDigest, isGenerating } = useDailyDigest(selectedDate);

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = subDays(new Date(), 1).toISOString().slice(0, 10);

  const actionableItems = items.filter(i => i.isActionable);
  const regularItems = items.filter(i => !i.isActionable);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-display">Daily Digest</CardTitle>
            {unreadCount > 0 && (
              <Badge variant="default" className="text-xs">
                {unreadCount} new
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center border rounded-md overflow-hidden text-xs">
              <button
                onClick={() => setSelectedDate(yesterday)}
                className={cn(
                  "px-2 py-1 transition-colors",
                  selectedDate === yesterday ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                )}
              >
                Yesterday
              </button>
              <button
                onClick={() => setSelectedDate(today)}
                className={cn(
                  "px-2 py-1 transition-colors",
                  selectedDate === today ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                )}
              >
                Today
              </button>
            </div>
            {unreadCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => markAllRead()}>
                    <CheckCheck className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Mark all read</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => triggerDigest()}
                  disabled={isGenerating}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", isGenerating && "animate-spin")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh digest</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-8">
            <Eye className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-1">
              {selectedDate === today ? "No digest yet for today" : "No updates found for this date"}
            </p>
            {selectedDate === today && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => triggerDigest()}
                disabled={isGenerating}
              >
                <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isGenerating && "animate-spin")} />
                {isGenerating ? "Scanning accounts..." : "Generate Now"}
              </Button>
            )}
          </div>
        ) : (
          <>
            {actionableItems.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  <AlertTriangle className="h-3 w-3" />
                  Actionable ({actionableItems.length})
                </div>
                {actionableItems.map(item => (
                  <DigestItemCard key={item.id} item={item} onMarkRead={markRead} />
                ))}
              </div>
            )}
            {regularItems.length > 0 && (
              <div className="space-y-2">
                {actionableItems.length > 0 && (
                  <div className="text-xs font-medium text-muted-foreground mt-2">
                    Other Updates ({regularItems.length})
                  </div>
                )}
                {regularItems.map(item => (
                  <DigestItemCard key={item.id} item={item} onMarkRead={markRead} />
                ))}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground text-center pt-2">
              {format(new Date(selectedDate), 'EEEE, MMMM d')} • {items.length} update{items.length !== 1 ? 's' : ''} across {new Set(items.map(i => i.accountName)).size} accounts
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
