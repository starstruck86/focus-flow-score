import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, Target, FileText, CheckSquare, Sparkles, Loader2 } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useStore } from '@/store/useStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { useLinkedRecordContext } from '@/contexts/LinkedRecordContext';
import { cn } from '@/lib/utils';

interface SearchResult {
  id: string;
  type: 'account' | 'opportunity' | 'renewal' | 'contact';
  name: string;
  subtitle?: string;
  route: string;
  contextSnippet?: string;
}

interface SearchContext {
  type: string;
  snippet: string;
  [key: string]: any;
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [contexts, setContexts] = useState<Record<string, SearchContext>>({});
  const [loadingContext, setLoadingContext] = useState(false);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { setCurrentRecord } = useLinkedRecordContext();
  const contextAbort = useRef<AbortController | null>(null);

  // Keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === '/' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !e.metaKey && !e.ctrlKey)) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  // Search across tables
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      setContexts({});
      return;
    }

    const searchTimeout = setTimeout(async () => {
      const searchResults: SearchResult[] = [];
      const q = query.toLowerCase();

      // Search accounts
      const { data: accounts } = await supabase
        .from('accounts')
        .select('id, name, industry, outreach_status')
        .ilike('name', `%${q}%`)
        .limit(5);

      accounts?.forEach(a => searchResults.push({
        id: a.id, type: 'account', name: a.name,
        subtitle: [a.industry, a.outreach_status].filter(Boolean).join(' · '),
        route: '/outreach',
      }));

      // Search renewals
      const { data: renewals } = await supabase
        .from('renewals')
        .select('id, account_name, arr, renewal_stage')
        .ilike('account_name', `%${q}%`)
        .limit(5);

      renewals?.forEach(r => searchResults.push({
        id: r.id, type: 'renewal', name: r.account_name,
        subtitle: `$${(r.arr || 0).toLocaleString()} · ${r.renewal_stage || 'No stage'}`,
        route: '/renewals',
      }));

      // Search opportunities
      const { data: opps } = await supabase
        .from('opportunities')
        .select('id, name, stage, arr, deal_type')
        .ilike('name', `%${q}%`)
        .limit(5);

      opps?.forEach(o => {
        const isRenewalOpp = o.deal_type === 'renewal' || o.deal_type === 'expansion';
        searchResults.push({
          id: o.id, type: 'opportunity', name: o.name,
          subtitle: `$${(o.arr || 0).toLocaleString()} · ${o.stage || 'No stage'}`,
          route: isRenewalOpp ? '/renewals' : '/outreach',
        });
      });

      // Search contacts
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, name, title, email')
        .ilike('name', `%${q}%`)
        .limit(5);

      contacts?.forEach(c => searchResults.push({
        id: c.id, type: 'contact', name: c.name,
        subtitle: [c.title, c.email].filter(Boolean).join(' · '),
        route: '/outreach',
      }));

      setResults(searchResults);

      // Fetch AI context for results
      if (searchResults.length > 0) {
        fetchContexts(searchResults);
      }
    }, 200);

    return () => clearTimeout(searchTimeout);
  }, [query]);

  const fetchContexts = async (searchResults: SearchResult[]) => {
    // Cancel previous request
    if (contextAbort.current) contextAbort.current.abort();
    contextAbort.current = new AbortController();

    const accountIds = searchResults.filter(r => r.type === 'account').map(r => r.id);
    const opportunityIds = searchResults.filter(r => r.type === 'opportunity').map(r => r.id);
    const renewalIds = searchResults.filter(r => r.type === 'renewal').map(r => r.id);

    if (accountIds.length === 0 && opportunityIds.length === 0 && renewalIds.length === 0) return;

    setLoadingContext(true);
    try {
      const { data, error } = await supabase.functions.invoke('search-context', {
        body: { account_ids: accountIds, opportunity_ids: opportunityIds, renewal_ids: renewalIds },
      });
      if (!error && data?.contexts) {
        setContexts(data.contexts);
      }
    } catch {
      // Silently fail - context is enhancement only
    } finally {
      setLoadingContext(false);
    }
  };

  const getContext = (result: SearchResult): string | undefined => {
    const key = `${result.type}:${result.id}`;
    return contexts[key]?.snippet;
  };

  const iconForType = (type: string) => {
    switch (type) {
      case 'account': return <Users className="h-4 w-4 text-muted-foreground" />;
      case 'opportunity': return <Target className="h-4 w-4 text-muted-foreground" />;
      case 'renewal': return <FileText className="h-4 w-4 text-muted-foreground" />;
      case 'contact': return <CheckSquare className="h-4 w-4 text-muted-foreground" />;
      default: return <Search className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const handleSelect = (result: SearchResult) => {
    if (result.type === 'account') {
      setCurrentRecord({ type: 'account', id: result.id });
    } else if (result.type === 'opportunity') {
      setCurrentRecord({ type: 'opportunity', id: result.id });
    } else if (result.type === 'renewal') {
      setCurrentRecord({ type: 'renewal', id: result.id });
    }
    navigate(result.route);
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Search className="h-3.5 w-3.5" />
        {!isMobile && (
          <>
            Search
            <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100">
              /
            </kbd>
          </>
        )}
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search accounts, deals, contacts..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {query.length < 2 ? 'Type to search...' : 'No results found.'}
          </CommandEmpty>

          {results.length > 0 && (
            <>
              {['account', 'opportunity', 'renewal', 'contact'].map(type => {
                const typeResults = results.filter(r => r.type === type);
                if (typeResults.length === 0) return null;
                const label = type === 'account' ? 'Accounts' :
                              type === 'opportunity' ? 'Opportunities' :
                              type === 'renewal' ? 'Renewals' : 'Contacts';
                return (
                  <CommandGroup key={type} heading={label}>
                    {typeResults.map(result => {
                      const context = getContext(result);
                      return (
                        <CommandItem
                          key={result.id}
                          onSelect={() => handleSelect(result)}
                          className="flex items-start gap-3 py-2.5"
                        >
                          <span className="mt-0.5">{iconForType(result.type)}</span>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{result.name}</div>
                            {result.subtitle && (
                              <div className="text-xs text-muted-foreground truncate">{result.subtitle}</div>
                            )}
                            {context && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <Sparkles className="h-3 w-3 text-primary shrink-0" />
                                <span className="text-[11px] text-primary/80 truncate">{context}</span>
                              </div>
                            )}
                            {loadingContext && !context && type !== 'contact' && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <Loader2 className="h-3 w-3 text-muted-foreground animate-spin" />
                                <span className="text-[11px] text-muted-foreground">Loading context...</span>
                              </div>
                            )}
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                );
              })}
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
