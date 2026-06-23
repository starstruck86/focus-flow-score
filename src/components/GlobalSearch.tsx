import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, Target, FileText, CheckSquare, Sparkles, Loader2, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fromActiveAccounts } from '@/data/accounts';
import { useStore } from '@/store/useStore';
import { useLinkedRecordContext } from '@/contexts/LinkedRecordContext';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface SearchResult {
  id: string;
  type: 'account' | 'opportunity' | 'renewal' | 'contact' | 'task';
  name: string;
  subtitle?: string;
  route: string;
}

export function GlobalSearch({ className }: { className?: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setCurrentRecord } = useLinkedRecordContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const runSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    const searchResults: SearchResult[] = [];
    const lower = q.toLowerCase();

    const accountsRes = await fromActiveAccounts()
      .select('id, name, industry, outreach_status')
      .ilike('name', `%${lower}%`)
      .limit(8);

    accountsRes.data?.forEach(a => searchResults.push({
      id: a.id, type: 'account', name: a.name,
      subtitle: [a.industry, a.outreach_status].filter(Boolean).join(' · '),
      route: `/accounts/${a.id}`,
    }));

    setResults(searchResults);
    setOpen(searchResults.length > 0);
    setLoading(false);
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), 200);
  };

  const handleSelect = (result: SearchResult) => {
    navigate(result.route);
    setOpen(false);
    setQuery('');
  };


  const iconForType = (type: string) => {
    switch (type) {
      case 'account': return <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
      case 'opportunity': return <Target className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
      case 'renewal': return <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
      case 'contact': return <CheckSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
      case 'task': return <CheckSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
      default: return <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    }
  };

  const groupedResults = (['account', 'opportunity', 'renewal', 'contact', 'task'] as const).map(type => ({
    type,
    label: type === 'account' ? 'Accounts' : type === 'opportunity' ? 'Opportunities' : type === 'renewal' ? 'Renewals' : type === 'contact' ? 'Contacts' : 'Tasks',
    items: results.filter(r => r.type === type),
  })).filter(g => g.items.length > 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className={cn("relative flex items-center", className)}>
          <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
          {loading && <Loader2 className="absolute right-3 h-3.5 w-3.5 text-muted-foreground animate-spin" />}
          {query && !loading && (
            <button className="absolute right-3 text-muted-foreground hover:text-foreground" onClick={() => { setQuery(''); setResults([]); setOpen(false); }}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={e => handleChange(e.target.value)}
            onFocus={() => { if (results.length > 0) setOpen(true); }}
            placeholder="Search…"
            className="w-full h-9 rounded-lg border border-border/40 bg-muted/30 pl-9 pr-9 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:bg-background transition-colors"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 max-h-[400px] overflow-y-auto"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={e => e.preventDefault()}
      >
        {groupedResults.map(group => (
          <div key={group.type}>
            <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">
              {group.label}
            </div>
            {group.items.map(result => (
              <button
                key={result.id}
                onClick={() => handleSelect(result)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
              >
                {iconForType(result.type)}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{result.name}</p>
                  {result.subtitle && <p className="text-[11px] text-muted-foreground truncate">{result.subtitle}</p>}
                </div>
              </button>
            ))}
          </div>
        ))}
        {results.length === 0 && query.length >= 2 && !loading && (
          <div className="px-3 py-4 text-sm text-muted-foreground text-center">No results found.</div>
        )}
      </PopoverContent>
    </Popover>
  );
}
