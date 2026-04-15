/**
 * Command Bar — structured token-first composer.
 *
 * Tokens (+ template, @ account, $ opportunity) render as inline chips
 * INSIDE the input area. Free text is typed around them.
 * Backspace at chip boundary removes the token naturally.
 * Preserves fast keyboard flow: trigger → type → arrow/tab/enter → continue.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Zap, Building2, DollarSign, Plus, Loader2, X, PlusCircle } from 'lucide-react';
import type { ParsedCommand, CommandToken, TemplateMetadata } from '@/lib/commandTypes';

interface Suggestion {
  type: 'account' | 'opportunity' | 'template';
  id: string;
  name: string;
  subtitle?: string;
  is_pinned?: boolean;
  is_create?: boolean;
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
  preserveAfterExecute?: boolean;
  /** Expose current tokens for pre-run context strip */
  onTokensChange?: (tokens: CommandToken[]) => void;
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
  account: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  opportunity: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  template: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
};

const TRIGGER_CHIP_TEXT: Record<string, string> = {
  account: 'text-blue-400',
  opportunity: 'text-emerald-400',
  template: 'text-amber-400',
};

export function CommandBar({
  accounts, opportunities, templates, onExecute,
  onCreateAccount, onCreateOpportunity,
  isLoading, placeholder, prefill, onPrefillConsumed,
  preserveAfterExecute, onTokensChange,
}: Props) {
  const [freeText, setFreeText] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeTrigger, setActiveTrigger] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [tokens, setTokens] = useState<CommandToken[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isTypingRef = useRef(false);

  // Notify parent of token changes
  useEffect(() => {
    onTokensChange?.(tokens);
  }, [tokens, onTokensChange]);

  const openSuggestions = useCallback((triggerChar: string, filter: string) => {
    const type = TRIGGER_CHARS[triggerChar];
    let items: Suggestion[] = [];
    const lowerFilter = filter.toLowerCase();

    if (type === 'account') {
      items = accounts
        .filter(a => a.name.toLowerCase().includes(lowerFilter))
        .slice(0, 7)
        .map(a => ({ type: 'account', id: a.id, name: a.name }));
      if (lowerFilter.length > 1 && !items.some(i => i.name.toLowerCase() === lowerFilter)) {
        items.push({ type: 'account', id: '__create__', name: filter, is_create: true });
      }
    } else if (type === 'opportunity') {
      items = opportunities
        .filter(o => o.name.toLowerCase().includes(lowerFilter))
        .slice(0, 7)
        .map(o => ({ type: 'opportunity', id: o.id, name: o.name, subtitle: o.account_name }));
      if (lowerFilter.length > 1 && !items.some(i => i.name.toLowerCase() === lowerFilter)) {
        items.push({ type: 'opportunity', id: '__create__', name: filter, is_create: true });
      }
    } else if (type === 'template') {
      items = templates
        .filter(t => t.name.toLowerCase().includes(lowerFilter))
        .slice(0, 8)
        .map(t => ({ type: 'template', id: t.id, name: t.name, subtitle: t.description, is_pinned: t.is_pinned }));
    }

    setSuggestions(items);
    setActiveTrigger(triggerChar);
    setFilterText(filter);
    setSelectedIdx(0);
  }, [accounts, opportunities, templates]);

  const closeSuggestions = useCallback(() => {
    setSuggestions([]);
    setActiveTrigger(null);
    setFilterText('');
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    isTypingRef.current = true;
    const val = e.target.value;
    setFreeText(val);

    // Check if user just typed a trigger character
    const cursor = e.target.selectionStart ?? val.length;
    // Look backwards from cursor for a trigger
    let foundTrigger = false;
    for (let i = cursor - 1; i >= 0; i--) {
      const ch = val[i];
      if (ch === ' ' || ch === '\n') break;
      if (TRIGGER_CHARS[ch] && (i === 0 || val[i - 1] === ' ')) {
        const filter = val.slice(i + 1, cursor);
        openSuggestions(ch, filter);
        foundTrigger = true;
        break;
      }
    }
    if (!foundTrigger) closeSuggestions();

    setTimeout(() => { isTypingRef.current = false; }, 300);
  }, [openSuggestions, closeSuggestions]);

  const selectSuggestion = useCallback(async (suggestion: Suggestion) => {
    // Handle "Create new" flow
    if (suggestion.is_create) {
      let created: { id: string; name: string } | null = null;
      if (suggestion.type === 'account' && onCreateAccount) {
        created = await onCreateAccount(suggestion.name);
      } else if (suggestion.type === 'opportunity' && onCreateOpportunity) {
        created = await onCreateOpportunity(suggestion.name);
      }
      if (!created) { closeSuggestions(); return; }
      suggestion = { ...suggestion, id: created.id, name: created.name, is_create: false };
    }

    // Add token
    setTokens(prev => {
      const filtered = prev.filter(t => t.type !== suggestion.type);
      return [...filtered, { type: suggestion.type, id: suggestion.id, name: suggestion.name }];
    });

    // Remove the trigger + filter text from freeText
    if (activeTrigger) {
      setFreeText(prev => {
        // Find the trigger char + filter text and remove it
        const cursor = inputRef.current?.selectionStart ?? prev.length;
        for (let i = cursor - 1; i >= 0; i--) {
          if (prev[i] === activeTrigger && (i === 0 || prev[i - 1] === ' ')) {
            return (prev.slice(0, i) + prev.slice(cursor)).trim();
          }
        }
        return prev;
      });
    }

    closeSuggestions();
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [activeTrigger, onCreateAccount, onCreateOpportunity, closeSuggestions]);

  const removeToken = useCallback((type: CommandToken['type']) => {
    setTokens(prev => prev.filter(t => t.type !== type));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Suggestion navigation
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, suggestions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); selectSuggestion(suggestions[selectedIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeSuggestions(); return; }
    }

    // Backspace at start of empty input → remove last token
    if (e.key === 'Backspace' && freeText === '' && tokens.length > 0) {
      e.preventDefault();
      setTokens(prev => prev.slice(0, -1));
      return;
    }

    // Enter to execute
    if (e.key === 'Enter' && suggestions.length === 0) {
      e.preventDefault();
      handleExecute();
    }
  }, [suggestions, selectedIdx, selectSuggestion, closeSuggestions, freeText, tokens]);

  const handleExecute = useCallback(() => {
    if ((!freeText.trim() && tokens.length === 0) || isLoading) return;

    const account = tokens.find(t => t.type === 'account') || null;
    const opportunity = tokens.find(t => t.type === 'opportunity') || null;
    const template = tokens.find(t => t.type === 'template') || null;

    // Build rawText for display/history
    const rawParts: string[] = [];
    if (template) rawParts.push(`+${template.name}`);
    if (account) rawParts.push(`@${account.name}`);
    if (opportunity) rawParts.push(`$${opportunity.name}`);
    if (freeText.trim()) rawParts.push(freeText.trim());
    const rawText = rawParts.join(' ');

    onExecute({ rawText, account, opportunity, template, freeText: freeText.trim() });

    if (!preserveAfterExecute) {
      setFreeText('');
      setTokens([]);
    }
  }, [freeText, tokens, onExecute, isLoading, preserveAfterExecute]);

  // Prefill from starter commands
  useEffect(() => {
    if (prefill && !isTypingRef.current) {
      // Parse prefill into tokens + remaining text
      const newTokens: CommandToken[] = [];
      let remaining = prefill;

      // Extract +Template
      const templateMatch = remaining.match(/\+([^@$]+?)(?=\s[@$]|\s*$)/);
      if (templateMatch) {
        const name = templateMatch[1].trim();
        const t = templates.find(t => t.name.toLowerCase() === name.toLowerCase());
        if (t) {
          newTokens.push({ type: 'template', id: t.id, name: t.name });
        } else {
          newTokens.push({ type: 'template', id: name, name });
        }
        remaining = remaining.replace(templateMatch[0], '').trim();
      }

      // If remaining has just @ or $, open suggestions
      setTokens(newTokens);
      setFreeText(remaining);
      onPrefillConsumed?.();

      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          // Check if remaining ends with trigger char to open dropdown
          const trimmed = remaining.trim();
          if (trimmed === '@' || trimmed === '$' || trimmed === '+') {
            openSuggestions(trimmed, '');
          }
        }
      });
    }
  }, [prefill]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeSuggestions();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [closeSuggestions]);

  const hasContent = tokens.length > 0 || freeText.trim().length > 0;

  return (
    <div className="relative w-full">
      {/* Composer container */}
      <div
        className={cn(
          'flex items-center gap-1.5 flex-wrap min-h-[56px] px-3 py-2 rounded-xl',
          'bg-card border-2 border-border',
          'focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/30',
          'transition-all duration-200',
          isLoading && 'opacity-60'
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {/* Leading icon */}
        <div className="shrink-0 ml-0.5">
          {isLoading ? (
            <Loader2 className="h-4.5 w-4.5 text-primary animate-spin" />
          ) : (
            <Zap className="h-4.5 w-4.5 text-muted-foreground" />
          )}
        </div>

        {/* Inline token chips */}
        {tokens.map(token => {
          const Icon = TRIGGER_ICONS[token.type];
          const colors = TRIGGER_COLORS[token.type];
          const textColor = TRIGGER_CHIP_TEXT[token.type];
          return (
            <span
              key={token.type}
              className={cn(
                'inline-flex items-center gap-1 text-xs font-medium pl-1.5 pr-1 py-0.5 rounded-md border shrink-0',
                colors
              )}
            >
              <Icon className={cn('h-3 w-3', textColor)} />
              <span className={textColor}>{token.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); removeToken(token.type); }}
                className={cn('ml-0.5 rounded-sm hover:bg-foreground/10 p-0.5 transition-colors', textColor)}
                tabIndex={-1}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          );
        })}

        {/* Text input */}
        <input
          ref={inputRef}
          type="text"
          value={freeText}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          placeholder={tokens.length > 0 ? 'Add context or press ↵ to run…' : (placeholder || '+Template @Account $Opportunity')}
          className={cn(
            'flex-1 min-w-[120px] bg-transparent border-none outline-none',
            'text-sm font-medium text-foreground placeholder:text-muted-foreground/50',
            'disabled:cursor-not-allowed'
          )}
          autoFocus
        />

        {/* Run button */}
        {hasContent && !isLoading && (
          <button
            onClick={handleExecute}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
          >
            Run
          </button>
        )}
      </div>

      {/* Keyboard hints — only when completely empty */}
      {!hasContent && (
        <div className="flex items-center gap-4 mt-2 px-1">
          <span className="text-[11px] text-muted-foreground/50 flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">+</kbd> template
          </span>
          <span className="text-[11px] text-muted-foreground/50 flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">@</kbd> account
          </span>
          <span className="text-[11px] text-muted-foreground/50 flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">$</kbd> opportunity
          </span>
          <span className="text-[11px] text-muted-foreground/50 flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">⌫</kbd> remove
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
            const color = TRIGGER_CHIP_TEXT[s.type];
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
