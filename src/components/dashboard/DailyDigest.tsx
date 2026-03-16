import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Briefcase, UserPlus, Newspaper, Cpu, RefreshCw, CheckCheck,
  ExternalLink, ChevronRight, Sparkles, Eye,
  AlertTriangle, Zap, DollarSign, Info,
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

const categoryConfig: Record<string, { icon: typeof Briefcase; label: string; borderColor: string; bgColor: string; textColor: string }> = {
  executive_hire: { icon: UserPlus, label: 'Executive Hire', borderColor: 'border-emerald-500/20', bgColor: 'bg-emerald-500/5', textColor: 'text-emerald-500' },
  job_posting:    { icon: Briefcase, label: 'Job Posting', borderColor: 'border-primary/20', bgColor: 'bg-primary/5', textColor: 'text-primary' },
  company_news:   { icon: Newspaper, label: 'Company News', borderColor: 'border-status-yellow/20', bgColor: 'bg-status-yellow/5', textColor: 'text-status-yellow' },
  tech_change:    { icon: Cpu, label: 'Tech Change', borderColor: 'border-purple-500/20', bgColor: 'bg-purple-500/5', textColor: 'text-purple-500' },
  news:           { icon: Zap, label: 'News', borderColor: 'border-border/50', bgColor: 'bg-muted/50', textColor: 'text-muted-foreground' },
};

function DigestItemCard({ item, onMarkRead }: { item: DigestItem; onMarkRead: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const config = categoryConfig[item.category] || categoryConfig.news;
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "text-xs p-3 rounded-md border cursor-pointer transition-colors",
        config.bgColor,
        config.borderColor,
        item.isRead && "opacity-60"
      )}
      onClick={() => {
        setExpanded(!expanded);
        if (!item.isRead) onMarkRead(item.id);
      }}
    >
      {/* Header row: category label + account name */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Icon className={cn("h-3 w-3 shrink-0", config.textColor)} />
          <span className={cn("font-semibold text-[11px] uppercase tracking-wide", config.textColor)}>
            {config.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
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
      </div>

      {/* Account name */}
      <span className="text-[11px] font-medium text-muted-foreground">{item.accountName}</span>

      {/* Headline */}
      <p className={cn("text-foreground/80 leading-relaxed mt-1", item.isRead ? "text-muted-foreground" : "font-medium")}>
        {item.headline}
      </p>

      {/* Expandable details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {item.summary && (
              <p className="text-muted-foreground mt-2 leading-relaxed">
                {item.summary}
              </p>
            )}
            {item.suggestedAction && (
              <div className="mt-2 flex items-start gap-1.5">
                <ChevronRight className={cn("h-3 w-3 mt-0.5 shrink-0", config.textColor)} />
                <span className={cn("font-semibold", config.textColor)}>{item.suggestedAction}</span>
              </div>
            )}
            <div className="flex items-center gap-3 mt-2">
              {item.sourceUrl && (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1"
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
    </motion.div>
  );
}

export function DailyDigest() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const { items, isLoading, unreadCount, markRead, markAllRead, triggerDigest, isGenerating } = useDailyDigest(selectedDate);

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = subDays(new Date(), 1).toISOString().slice(0, 10);

  const sortedItems = [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const actionableItems = sortedItems.filter(i => i.isActionable);
  const regularItems = sortedItems.filter(i => !i.isActionable);

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
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-16 w-full rounded-md" />
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
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2 pr-3">
              {actionableItems.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary uppercase tracking-wide">
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
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mt-2">
                      Other Updates ({regularItems.length})
                    </div>
                  )}
                  {regularItems.map(item => (
                    <DigestItemCard key={item.id} item={item} onMarkRead={markRead} />
                  ))}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground text-center pt-2 pb-1">
                {format(new Date(selectedDate), 'EEEE, MMMM d')} • {items.length} update{items.length !== 1 ? 's' : ''} across {new Set(items.map(i => i.accountName)).size} accounts
              </p>
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
