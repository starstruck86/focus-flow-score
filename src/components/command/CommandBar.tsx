/**
 * Command Bar — single input with @, $, + autocomplete.
 * Feels like a command palette, not a form.
 */
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Zap, Building2, DollarSign, Plus, Loader2 } from 'lucide-react';

export interface CommandEntity {
  type: 'account' | 'opportunity' | 'template';
  id: string;
  name: string;
}

export interface ParsedCommand {
  rawText: string;
  account: CommandEntity | null;
  opportunity: CommandEntity | null;
  template: CommandEntity | null;
  freeText: string;
}

interface Suggestion {
  type: 'account' | 'opportunity' | 'template';
  id: string;
  name: string;
  subtitle?: string;
}

interface Props {
  accounts: { id: string; name: string }[];
  opportunities: { id: string; name: string; account_name?: string }[];
  templates: { id: string; name: string; description?: string }[];
  onExecute: (command: ParsedCommand) => void;
  isLoading?: boolean;
  placeholder?: string;
}

const TRIGGER_CHARS: Record<string, 'account' | 'opportunity' | 'template'> = {
  '@': 'account',
  '$': 'opportunity',
  '+': 'template',
};

const TRIGGER_ICONS: Record<string, React.ElementType> = {
  account: Building2,
  opportunity: DollarSign,
  template: Plus,
};

const TRIGGER_COLORS: Record<string, string> = {
  account: 'text-blue-400',
  opportunity: 'text-emerald-400',
  template: 'text-amber-400',
};

export function CommandBar({ accounts, opportunities, templates, onExecute, isLoading, placeholder }: Props) {
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeTrigger, setActiveTrigger] = useState<string | null>(null);
  const [triggerStart, setTriggerStart] = useState<number>(-1);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [selectedEntities, setSelectedEntities] = useState<CommandEntity[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Build suggestions based on trigger character and filter text
  const updateSuggestions = useCallback((text: string, cursor: number) => {
    // Find the active trigger by scanning backward from cursor
    let trigger: string | null = null;
    let start = -1;

    for (let i = cursor - 1; i >= 0; i--) {
      if (text[i] === ' ' || text[i] === '\n') break;
      if (TRIGGER_CHARS[text[i]]) {
        // Make sure it's at start of word (beginning of string or after space)
        if (i === 0 || text[i - 1] === ' ') {
          trigger = text[i];
          start = i;
          break;
        }
      }
    }

    if (!trigger) {
      setSuggestions([]);
      setActiveTrigger(null);
      setTriggerStart(-1);
      return;
    }

    const filterText = text.slice(start + 1, cursor).toLowerCase();
    const type = TRIGGER_CHARS[trigger];
    let items: Suggestion[] = [];

    if (type === 'account') {
      items = accounts
        .filter(a => a.name.toLowerCase().includes(filterText))
        .slice(0, 8)
        .map(a => ({ type: 'account', id: a.id, name: a.name }));
    } else if (type === 'opportunity') {
      items = opportunities
        .filter(o => o.name.toLowerCase().includes(filterText))
        .slice(0, 8)
        .map(o => ({ type: 'opportunity', id: o.id, name: o.name, subtitle: o.account_name }));
    } else if (type === 'template') {
      items = templates
        .filter(t => t.name.toLowerCase().includes(filterText))
        .slice(0, 8)
        .map(t => ({ type: 'template', id: t.id, name: t.name, subtitle: t.description }));
    }

    setSuggestions(items);
    setActiveTrigger(trigger);
    setTriggerStart(start);
    setSelectedIdx(0);
  }, [accounts, opportunities, templates]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setValue(newVal);
    const cursor = e.target.selectionStart ?? newVal.length;
    updateSuggestions(newVal, cursor);
  }, [updateSuggestions]);

  const selectSuggestion = useCallback((suggestion: Suggestion) => {
    // Replace the trigger+filter text with the entity token
    const before = value.slice(0, triggerStart);
    const after = value.slice(inputRef.current?.selectionStart ?? value.length);
    const triggerChar = activeTrigger || '';
    const token = `${triggerChar}${suggestion.name} `;
    const newVal = before + token + after.trimStart();

    setValue(newVal);
    setSuggestions([]);
    setActiveTrigger(null);

    // Track selected entity
    setSelectedEntities(prev => {
      const filtered = prev.filter(e => e.type !== suggestion.type);
      return [...filtered, { type: suggestion.type, id: suggestion.id, name: suggestion.name }];
    });

    // Focus back
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const pos = before.length + token.length;
        inputRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  }, [value, triggerStart, activeTrigger]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(i => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        selectSuggestion(suggestions[selectedIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSuggestions([]);
        return;
      }
    }

    if (e.key === 'Enter' && suggestions.length === 0) {
      e.preventDefault();
      handleExecute();
    }
  }, [suggestions, selectedIdx, selectSuggestion]);

  const handleExecute = useCallback(() => {
    if (!value.trim() || isLoading) return;

    const account = selectedEntities.find(e => e.type === 'account') || null;
    const opportunity = selectedEntities.find(e => e.type === 'opportunity') || null;
    const template = selectedEntities.find(e => e.type === 'template') || null;

    // Extract free text (remove entity tokens)
    let freeText = value;
    for (const entity of selectedEntities) {
      const triggerChar = entity.type === 'account' ? '@' : entity.type === 'opportunity' ? '$' : '+';
      freeText = freeText.replace(`${triggerChar}${entity.name}`, '').trim();
    }

    onExecute({ rawText: value, account, opportunity, template, freeText });
  }, [value, selectedEntities, onExecute, isLoading]);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSuggestions([]);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Entity chips display
  const entityChips = useMemo(() => selectedEntities.map(e => {
    const Icon = TRIGGER_ICONS[e.type];
    const color = TRIGGER_COLORS[e.type];
    return (
      <span key={e.type} className={cn('inline-flex items-center gap-1 text-xs font-medium', color)}>
        <Icon className="h-3 w-3" />
        {e.name}
      </span>
    );
  }), [selectedEntities]);

  return (
    <div className="relative w-full">
      {/* Main input */}
      <div className="relative group">
        <div className="absolute left-4 top-1/2 -translate-y-1/2">
          {isLoading ? (
            <Loader2 className="h-5 w-5 text-primary animate-spin" />
          ) : (
            <Zap className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          placeholder={placeholder || '+Discovery Prep @HubSpot $Q3 Renewal'}
          className={cn(
            'w-full h-14 pl-12 pr-4 rounded-xl text-base',
            'bg-card border-2 border-border',
            'text-foreground placeholder:text-muted-foreground/60',
            'focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30',
            'transition-all duration-200',
            'disabled:opacity-50',
            'font-medium'
          )}
          autoFocus
        />
        {value.trim() && !isLoading && (
          <button
            onClick={handleExecute}
            className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Run
          </button>
        )}
      </div>

      {/* Entity chips */}
      {entityChips.length > 0 && (
        <div className="flex items-center gap-3 mt-2 px-1">
          {entityChips}
        </div>
      )}

      {/* Hint text */}
      {!value && (
        <div className="flex items-center gap-4 mt-2.5 px-1">
          <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">+</kbd> template
          </span>
          <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">@</kbd> account
          </span>
          <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">$</kbd> opportunity
          </span>
          <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">↵</kbd> run
          </span>
        </div>
      )}

      {/* Autocomplete dropdown */}
      {suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 rounded-xl border border-border bg-popover shadow-lg overflow-hidden"
        >
          {suggestions.map((s, i) => {
            const Icon = TRIGGER_ICONS[s.type];
            const color = TRIGGER_COLORS[s.type];
            return (
              <button
                key={`${s.type}-${s.id}`}
                onClick={() => selectSuggestion(s)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                  i === selectedIdx ? 'bg-accent' : 'hover:bg-accent/50'
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', color)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                  {s.subtitle && (
                    <p className="text-xs text-muted-foreground truncate">{s.subtitle}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
