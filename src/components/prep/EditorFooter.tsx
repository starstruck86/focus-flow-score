import { Check, Loader2 } from 'lucide-react';

interface EditorFooterProps {
  content: string;
  saveStatus: 'saved' | 'saving' | 'unsaved';
  lastSaved?: Date;
}

export function EditorFooter({ content, saveStatus, lastSaved }: EditorFooterProps) {
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const readingTime = Math.max(1, Math.ceil(words / 200));

  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground bg-muted/20">
      <div className="flex items-center gap-3">
        <span>{words.toLocaleString()} words</span>
        <span>{readingTime} min read</span>
      </div>
      <div className="flex items-center gap-1.5">
        {saveStatus === 'saving' && (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Saving...</span>
          </>
        )}
        {saveStatus === 'saved' && (
          <>
            <Check className="h-3 w-3 text-green-500" />
            <span>Saved{lastSaved ? ` ${lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
          </>
        )}
        {saveStatus === 'unsaved' && (
          <span className="text-[hsl(var(--status-orange))]">Unsaved changes</span>
        )}
      </div>
    </div>
  );
}
