import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { BookOpen, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  conceptId: string;
  markdown: string;
  userId?: string | null;
  defaultOpen?: boolean;
}

/**
 * Renders a collapsible lesson panel for a concept's long-form teach content.
 * Read state persists in localStorage per user + concept (v1 — server sync later).
 */
export function LessonPanel({ conceptId, markdown, userId, defaultOpen = true }: Props) {
  const storageKey = `train:lesson-read:${userId ?? 'anon'}:${conceptId}`;
  const [open, setOpen] = useState(defaultOpen);
  const [read, setRead] = useState<boolean>(false);

  useEffect(() => {
    try {
      setRead(localStorage.getItem(storageKey) === '1');
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  function markRead() {
    try { localStorage.setItem(storageKey, '1'); } catch { /* ignore */ }
    setRead(true);
  }

  if (!markdown || !markdown.trim()) return null;

  return (
    <div className={cn(
      'rounded-lg border mb-4',
      read ? 'border-border/60 bg-card/40' : 'border-primary/25 bg-primary/5',
    )}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <BookOpen className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">📖 Lesson</span>
        {read && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3" /> Read
          </span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{markdown}</ReactMarkdown>
          </div>
          {!read && (
            <div className="flex justify-end mt-3">
              <Button size="sm" variant="outline" onClick={markRead}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark as read
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
