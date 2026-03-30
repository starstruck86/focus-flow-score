/**
 * Prep Command Center — the main Prep experience.
 * Three modes: Adapt Template | Prep Deal | Outbound
 * Phase 1: Only Prep Deal is fully implemented.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { FileEdit, Target, Send } from 'lucide-react';
import { PrepDealMode } from './PrepDealMode';

const MODES = [
  { id: 'adapt', label: 'Adapt Template', icon: FileEdit, stub: true },
  { id: 'prep-deal', label: 'Prep Deal', icon: Target, stub: false },
  { id: 'outbound', label: 'Outbound', icon: Send, stub: true },
] as const;

type ModeId = (typeof MODES)[number]['id'];

export function PrepCommandCenter() {
  const [mode, setMode] = useState<ModeId>('prep-deal');

  return (
    <div className="space-y-4">
      {/* Mode switcher */}
      <div className="flex gap-1 p-1 bg-muted/50 rounded-lg">
        {MODES.map(m => {
          const Icon = m.icon;
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all',
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{m.label}</span>
            </button>
          );
        })}
      </div>

      {/* Mode content */}
      {mode === 'prep-deal' && <PrepDealMode />}
      {mode === 'adapt' && (
        <div className="text-center py-16 text-muted-foreground">
          <FileEdit className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">Adapt Template</p>
          <p className="text-xs mt-1">Coming soon — adapt existing templates for specific situations.</p>
        </div>
      )}
      {mode === 'outbound' && (
        <div className="text-center py-16 text-muted-foreground">
          <Send className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">Outbound</p>
          <p className="text-xs mt-1">Coming soon — generate cold outreach sequences.</p>
        </div>
      )}
    </div>
  );
}
