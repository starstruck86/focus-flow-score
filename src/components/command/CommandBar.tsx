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
  account: 'bg-blue-500/10 border-blue-500/20',
  opportunity: 'bg-emerald-500/10 border-emerald-500/20',
  template: 'bg-amber-500/10 border-amber-500/20',
};

const TRIGGER_TEXT: Record<string, string> = {
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
  const prefillConsumedRef = useRef<string | null>(null);

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

    const cursor = e.target.selectionStart ?? val.length;
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

    // Replace existing token of same type
    setTokens(prev => {
      const filtered = prev.filter(t => t.type !== suggestion.type);
      return [...filtered, { type: suggestion.type, id: suggestion.id, name: suggestion.name }];
    });

    // Remove trigger + filter text from freeText cleanly
    if (activeTrigger) {
      setFreeText(prev => {
        const cursor = inputRef.current?.selectionStart ?? prev.length;
        for (let i = cursor - 1; i >= 0; i--) {
          if (prev[i] === activeTrigger && (i === 0 || prev[i - 1] === ' ')) {
            const before = prev.slice(0, i).trimEnd();
            const after = prev.slice(cursor).trimStart();
            return [before, after].filter(Boolean).join(' ');
          }
        }
        return prev;
      });
    }

    closeSuggestions();
    // Refocus without flicker
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [activeTrigger, onCreateAccount, onCreateOpportunity, closeSuggestions]);

  const removeToken = useCallback((type: CommandToken['type']) => {
    setTokens(prev => prev.filter(t => t.type !== type));
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, suggestions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); selectSuggestion(suggestions[selectedIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeSuggestions(); return; }
    }

    if (e.key === 'Backspace' && freeText === '' && tokens.length > 0) {
      e.preventDefault();
      setTokens(prev => prev.slice(0, -1));
      return;
    }

    if (e.key === 'Enter' && suggestions.length === 0 && !e.shiftKey) {
      e.preventDefault();
      handleExecute();
    }
  }, [suggestions, selectedIdx, selectSuggestion, closeSuggestions, freeText, tokens]);

  const handleExecute = useCallback(() => {
    if ((!freeText.trim() && tokens.length === 0) || isLoading) return;

    const account = tokens.find(t => t.type === 'account') || null;
    const opportunity = tokens.find(t => t.type === 'opportunity') || null;
    const template = tokens.find(t => t.type === 'template') || null;

    const rawParts: string[] = [];
    if (template) rawParts.push(`+${template.name}`);
    if (account) rawParts.push(`@${account.name}`);
    if (opportunity) rawParts.push(`$${opportunity.name}`);
    if (freeText.trim()) rawParts.push(freeText.trim());

    onExecute({ rawText: rawParts.join(' '), account, opportunity, template, freeText: freeText.trim() });

    if (!preserveAfterExecute) {
      setFreeText('');
      setTokens([]);
    }
  }, [freeText, tokens, onExecute, isLoading, preserveAfterExecute]);

  // Stable prefill — only consume each unique prefill once
  useEffect(() => {
    if (prefill && prefill !== prefillConsumedRef.current && !isTypingRef.current) {
      prefillConsumedRef.current = prefill;
      const newTokens: CommandToken[] = [];
      let remaining = prefill;

      // Extract +Template
      const templateMatch = remaining.match(/\+([^@$]+?)(?=\s[@$]|\s*$)/);
      if (templateMatch) {
        const name = templateMatch[1].trim();
        const t = templates.find(t => t.name.toLowerCase() === name.toLowerCase());
        if (t) newTokens.push({ type: 'template', id: t.id, name: t.name });
        else newTokens.push({ type: 'template', id: name, name });
        remaining = remaining.replace(templateMatch[0], '').trim();
      }

      setTokens(newTokens);
      setFreeText(remaining);
      onPrefillConsumed?.();

      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          const trimmed = remaining.trim();
          if (trimmed === '@' || trimmed === '$' || trimmed === '+') {
            openSuggestions(trimmed, '');
          }
        }
      });
    }
  }, [prefill, templates, openSuggestions, onPrefillConsumed]);

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
          'flex items-center gap-1.5 flex-wrap min-h-[52px] px-3 py-2 rounded-xl',
          'bg-card border border-border/60',
          'focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.08)]',
          'transition-all duration-150',
          isLoading && 'opacity-60 pointer-events-none'
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {/* Leading icon */}
        <div className="shrink-0 ml-0.5">
          {isLoading ? (
            <Loader2 className="h-4 w-4 text-primary animate-spin" />
          ) : (
            <Zap className="h-4 w-4 text-muted-foreground/60" />
          )}
        </div>

        {/* Inline token chips */}
        {tokens.map(token => {
          const Icon = TRIGGER_ICONS[token.type];
          const colors = TRIGGER_COLORS[token.type];
          const textColor = TRIGGER_TEXT[token.type];
          return (
            <span
              key={token.type}
              className={cn(
                'inline-flex items-center gap-1 text-[11px] font-semibold pl-1.5 pr-0.5 py-0.5 rounded-md border shrink-0',
                'transition-all duration-100',
                colors
              )}
            >
              <Icon className={cn('h-2.5 w-2.5', textColor)} />
              <span className={cn(textColor, 'truncate max-w-[140px]')}>{token.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); removeToken(token.type); }}
                className={cn('rounded-sm hover:bg-foreground/10 p-0.5 transition-colors', textColor)}
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
          placeholder={tokens.length > 0 ? 'Add context or press ↵' : (placeholder || '+template  @account  $opportunity  or just type…')}
          className={cn(
            'flex-1 min-w-[120px] bg-transparent border-none outline-none',
            'text-sm text-foreground placeholder:text-muted-foreground/40',
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
        <div className="flex items-center gap-4 mt-1.5 px-1">
          {[
            { key: '+', label: 'template' },
            { key: '@', label: 'account' },
            { key: '$', label: 'opportunity' },
          ].map(h => (
            <span key={h.key} className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
              <kbd className="px-1 py-px rounded bg-muted/60 text-[10px] font-mono leading-none">{h.key}</kbd>
              {h.label}
            </span>
          ))}
        </div>
      )}

      {/* Autocomplete dropdown */}
      {suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 rounded-xl border border-border/60 bg-popover shadow-lg overflow-hidden backdrop-blur-sm"
        >
          {suggestions.map((s, i) => {
            const Icon = s.is_create ? PlusCircle : TRIGGER_ICONS[s.type];
            const color = TRIGGER_TEXT[s.type];
            return (
              <button
                key={`${s.type}-${s.id}`}
                onClick={() => selectSuggestion(s)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3.5 py-2 text-left transition-colors',
                  i === selectedIdx ? 'bg-accent' : 'hover:bg-accent/50'
                )}
              >
                <Icon className={cn('h-3.5 w-3.5 shrink-0', color)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate">
                    {s.is_create ? `Create "${s.name}"` : s.name}
                  </p>
                  {s.subtitle && !s.is_create && (
                    <p className="text-[11px] text-muted-foreground truncate">{s.subtitle}</p>
                  )}
                </div>
                {s.is_pinned && (
                  <span className="text-[10px] text-muted-foreground/60">📌</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
