import { Button } from '@/components/ui/button';
import { Sparkles, Loader2, X } from 'lucide-react';
import type { PrepAction } from './ActionGrid';

interface Props {
  action: PrepAction;
  onGenerate: () => void;
  isGenerating: boolean;
  onClear: () => void;
}

export function ActionExecutionPanel({ action, onGenerate, isGenerating, onClear }: Props) {
  const Icon = action.icon;

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">{action.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
          </div>
        </div>
        <button onClick={onClear} className="text-muted-foreground hover:text-foreground transition-colors p-1">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <Button className="w-full" onClick={onGenerate} disabled={isGenerating}>
        {isGenerating ? (
          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
        ) : (
          <><Sparkles className="h-4 w-4 mr-2" /> Generate</>
        )}
      </Button>
    </div>
  );
}
