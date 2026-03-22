import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Lightbulb, Loader2, RefreshCw, ChevronRight, X, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { authenticatedFetch } from '@/lib/authenticatedFetch';

interface Suggestion {
  title: string;
  description: string;
  category: string;
  priority: string;
  example_text?: string;
}

interface SmartSuggestionsPanelProps {
  content: string;
  documentType: string;
  onApply: (text: string) => void;
  onClose: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  missing_section: 'text-destructive',
  improvement: 'text-primary',
  structure: 'text-accent-foreground',
  cta: 'text-[hsl(var(--strain))]',
  data: 'text-[hsl(var(--recovery))]',
};

export function SmartSuggestionsPanel({ content, documentType, onApply, onClose }: SmartSuggestionsPanelProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const fetchSuggestions = async () => {
    if (!content.trim()) { toast.error('Add content first'); return; }
    setLoading(true);
    try {
      const resp = await authenticatedFetch({
        functionName: 'build-resource',
        body: { type: 'suggest', content, documentType },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Error ${resp.status}`);
      }
      const data = await resp.json();
      setSuggestions(data.suggestions || []);
      setHasLoaded(true);
    } catch (e: any) {
      toast.error(e.message || 'Failed to get suggestions');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-72 border-l border-border bg-card flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium">Smart Suggestions</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchSuggestions} disabled={loading}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {!hasLoaded && !loading && (
            <div className="text-center py-8">
              <Lightbulb className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground mb-3">Analyze your content for improvement suggestions</p>
              <Button size="sm" variant="outline" className="text-xs" onClick={fetchSuggestions}>
                <Sparkles className="h-3 w-3 mr-1" /> Analyze Content
              </Button>
            </div>
          )}

          {loading && (
            <div className="text-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Analyzing...</p>
            </div>
          )}

          {hasLoaded && !loading && suggestions.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No suggestions — your content looks good! 🎉</p>
          )}

          {suggestions.map((s, i) => (
            <div key={i} className="rounded-lg border border-border p-2.5 space-y-1.5 hover:border-primary/30 transition-colors">
              <div className="flex items-start justify-between gap-1">
                <p className="text-xs font-medium leading-tight">{s.title}</p>
                <Badge variant="outline" className={cn("text-[8px] shrink-0", s.priority === 'high' ? 'border-destructive/50' : '')}>
                  {s.priority}
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">{s.description}</p>
              <div className="flex items-center justify-between">
                <span className={cn("text-[9px] capitalize", CATEGORY_COLORS[s.category] || 'text-muted-foreground')}>
                  {s.category.replace('_', ' ')}
                </span>
                {s.example_text && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[10px] px-1.5"
                    onClick={() => onApply(s.example_text!)}
                  >
                    Apply <ChevronRight className="h-2.5 w-2.5 ml-0.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

