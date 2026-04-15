/**
 * Command Bar — single input with @, $, + autocomplete.
 * Entities are tracked as structured tokens with stable IDs.
 * Supports inline creation of missing accounts/opportunities.
 */
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Zap, Building2, DollarSign, Plus, Loader2, X, PlusCircle } from 'lucide-react';
import type { ParsedCommand, CommandToken, TemplateMetadata } from '@/lib/commandTypes';

interface Suggestion {
  type: 'account' | 'opportunity' | 'template';
  id: string;
  name: string;
  subtitle?: string;
  is_pinned?: boolean;
  is_create?: boolean; // "Create new" option
}

interface Props {
  accounts: { id: string; name: string }[];
  opportunities: { id: string; name: string; account_name?: string }[];
  templates: TemplateMetadata[];
  onExecute: (command: ParsedCommand) => void;
  onCreateAccount?: (name: string) => Promise<{ id: string; name: string } | null>;
  onCreateOpportunity?: (name: string) => Promise<{ id: string; name: string } | null>;
  isLoading?: boolean;
  placeholder?: string;
  prefill?: string;
  onPrefillConsumed?: () => void;
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

export function CommandBar({
  accounts, opportunities, templates, onExecute,
  onCreateAccount, onCreateOpportunity,
  isLoading, placeholder, prefill, onPrefillConsumed,
}: Props) {
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeTrigger, setActiveTrigger] = useState<string | null>(null);
  const [triggerStart, setTriggerStart] = useState<number>(-1);
  const [selectedIdx, setSelectedIdx] = useState(0);
  // Structured tokens — stable IDs, not just text
  const [tokens, setTokens] = useState<CommandToken[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const updateSuggestionsRef = useRef<((text: string, cursor: number) => void) | null>(null);

  const updateSuggestions = useCallback((text: string, cursor: number) => {
    let trigger: string | null = null;
    let start = -1;

    for (let i = cursor - 1; i >= 0; i--) {
      if (text[i] === ' ' || text[i] === '\n') break;
      if (TRIGGER_CHARS[text[i]]) {
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
        .slice(0, 7)
        .map(a => ({ type: 'account', id: a.id, name: a.name }));
      // Add "Create new" option if filter text and no exact match
      if (filterText.length > 1 && !items.some(i => i.name.toLowerCase() === filterText)) {
        items.push({ type: 'account', id: '__create__', name: filterText, is_create: true });
      }
    } else if (type === 'opportunity') {
      items = opportunities
        .filter(o => o.name.toLowerCase().includes(filterText))
        .slice(0, 7)
        .map(o => ({ type: 'opportunity', id: o.id, name: o.name, subtitle: o.account_name }));
      if (filterText.length > 1 && !items.some(i => i.name.toLowerCase() === filterText)) {
        items.push({ type: 'opportunity', id: '__create__', name: filterText, is_create: true });
      }
    } else if (type === 'template') {
      items = templates
        .filter(t => t.name.toLowerCase().includes(filterText))
        .slice(0, 8)
        .map(t => ({ type: 'template', id: t.id, name: t.name, subtitle: t.description, is_pinned: t.is_pinned }));
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

  const selectSuggestion = useCallback(async (suggestion: Suggestion) => {
    // Handle "Create new" flow
    if (suggestion.is_create) {
      let created: { id: string; name: string } | null = null;
      if (suggestion.type === 'account' && onCreateAccount) {
        created = await onCreateAccount(suggestion.name);
      } else if (suggestion.type === 'opportunity' && onCreateOpportunity) {
        created = await onCreateOpportunity(suggestion.name);
      }
      if (!created) {
        setSuggestions([]);
        return;
      }
      suggestion = { ...suggestion, id: created.id, name: created.name, is_create: false };
    }

    // Replace trigger+filter text with entity token in visible text
    const before = value.slice(0, triggerStart);
    const after = value.slice(inputRef.current?.selectionStart ?? value.length);
    const triggerChar = activeTrigger || '';
    const token = `${triggerChar}${suggestion.name} `;
    const newVal = before + token + after.trimStart();

    setValue(newVal);
    setSuggestions([]);
    setActiveTrigger(null);

    // Store structured token with stable ID
    setTokens(prev => {
      const filtered = prev.filter(t => t.type !== suggestion.type);
      return [...filtered, { type: suggestion.type, id: suggestion.id, name: suggestion.name }];
    });

    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const pos = before.length + token.length;
        inputRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  }, [value, triggerStart, activeTrigger, onCreateAccount, onCreateOpportunity]);

  const removeToken = useCallback((type: CommandToken['type']) => {
    const token = tokens.find(t => t.type === type);
    if (token) {
      const triggerChar = type === 'account' ? '@' : type === 'opportunity' ? '$' : '+';
      setValue(prev => prev.replace(`${triggerChar}${token.name} `, '').replace(`${triggerChar}${token.name}`, '').trim());
      setTokens(prev => prev.filter(t => t.type !== type));
    }
  }, [tokens]);

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

    const account = tokens.find(t => t.type === 'account') || null;
    const opportunity = tokens.find(t => t.type === 'opportunity') || null;
    const template = tokens.find(t => t.type === 'template') || null;

    // Extract free text by removing all token references
    let freeText = value;
    for (const token of tokens) {
      const triggerChar = token.type === 'account' ? '@' : token.type === 'opportunity' ? '$' : '+';
      freeText = freeText.replace(`${triggerChar}${token.name}`, '').trim();
    }

    onExecute({ rawText: value, account, opportunity, template, freeText });
  }, [value, tokens, onExecute, isLoading]);

  // Prefill from starter commands
  useEffect(() => {
    if (prefill) {
      setValue(prefill);
      onPrefillConsumed?.();
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(prefill.length, prefill.length);
          updateSuggestions(prefill, prefill.length);
        }
      });
    }
  }, [prefill]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSuggestions([]);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

      {/* Structured token chips — show linked entities with remove */}
      {tokens.length > 0 && (
        <div className="flex items-center gap-2 mt-2 px-1 flex-wrap">
          {tokens.map(token => {
            const Icon = TRIGGER_ICONS[token.type];
            const color = TRIGGER_COLORS[token.type];
            return (
              <span
                key={token.type}
                className={cn(
                  'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-muted/80',
                  color
                )}
              >
                <Icon className="h-3 w-3" />
                {token.name}
                <button
                  onClick={() => removeToken(token.type)}
                  className="ml-0.5 hover:text-foreground transition-colors"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Hint text */}
      {!value && tokens.length === 0 && (
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
            const Icon = s.is_create ? PlusCircle : TRIGGER_ICONS[s.type];
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
                  <p className="text-sm font-medium text-foreground truncate">
                    {s.is_create ? `Create "${s.name}"` : s.name}
                  </p>
                  {s.subtitle && !s.is_create && (
                    <p className="text-xs text-muted-foreground truncate">{s.subtitle}</p>
                  )}
                </div>
                {s.is_pinned && (
                  <span className="text-[10px] text-muted-foreground">📌</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
