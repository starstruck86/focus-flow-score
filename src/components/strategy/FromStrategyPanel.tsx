/**
 * FromStrategyPanel
 *
 * Consumer-side surfacing for Strategy-promoted intelligence. Drops onto an
 * Account or Opportunity detail page and shows three rails:
 *   1. Promoted resources (from `resources` where source='strategy')
 *   2. Strategy memory (from `account_strategy_memory` / `opportunity_strategy_memory`)
 *   3. Strategy-sourced contacts (from `contacts` where source='strategy')
 *
 * Each row links back to its source thread / proposal so provenance is visible
 * on the receiving surface — proving Strategy is no longer an island.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, FileText, Brain, UserCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { CollapsibleSection } from '@/components/detail';

interface Props {
  scope: 'account' | 'opportunity';
  recordId: string;
}

interface ResourceRow {
  id: string;
  title: string;
  resource_type: string;
  promotion_scope: string | null;
  source_strategy_thread_id: string | null;
  promoted_at: string | null;
  is_template: boolean | null;
}
interface MemoryRow {
  id: string;
  memory_type: string;
  content: string;
  source_thread_id: string | null;
  created_at: string;
}
interface ContactRow {
  id: string;
  name: string;
  title: string | null;
  source_strategy_thread_id: string | null;
  promoted_at: string | null;
}

export function FromStrategyPanel({ scope, recordId }: Props) {
  const [loading, setLoading] = useState(true);
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [memory, setMemory] = useState<MemoryRow[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const idCol = scope === 'account' ? 'account_id' : 'opportunity_id';
      const memTable = scope === 'account' ? 'account_strategy_memory' : 'opportunity_strategy_memory';

      const [resR, memR, conR] = await Promise.all([
        (supabase as any).from('resources')
          .select('id, title, resource_type, promotion_scope, source_strategy_thread_id, promoted_at, is_template')
          .eq(idCol, recordId).eq('source', 'strategy')
          .order('promoted_at', { ascending: false }).limit(20),
        (supabase as any).from(memTable)
          .select('id, memory_type, content, source_thread_id, created_at')
          .eq(idCol, recordId)
          .not('source_thread_id', 'is', null)
          .order('created_at', { ascending: false }).limit(20),
        scope === 'account'
          ? (supabase as any).from('contacts')
              .select('id, name, title, source_strategy_thread_id, promoted_at')
              .eq('account_id', recordId).eq('source', 'strategy')
              .order('promoted_at', { ascending: false }).limit(20)
          : Promise.resolve({ data: [] }),
      ]);

      if (cancelled) return;
      setResources((resR.data ?? []) as ResourceRow[]);
      setMemory((memR.data ?? []) as MemoryRow[]);
      setContacts((conR.data ?? []) as ContactRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [scope, recordId]);

  const total = resources.length + memory.length + contacts.length;

  return (
    <CollapsibleSection title="From Strategy" icon={Sparkles} count={total} defaultOpen={total > 0}>
      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : total === 0 ? (
        <p className="text-xs text-muted-foreground py-3">
          Nothing promoted from Strategy yet. Open a Strategy thread, classify a proposal as Shared Intel or CRM Contact, and it will appear here.
        </p>
      ) : (
        <div className="space-y-3 py-2">
          {resources.length > 0 && (
            <Section icon={FileText} label="Resources">
              {resources.map(r => (
                <Row key={r.id}
                  primary={r.title}
                  meta={[r.resource_type, r.promotion_scope, r.is_template ? 'reusable' : null]
                    .filter(Boolean).join(' · ')}
                  threadId={r.source_strategy_thread_id}
                />
              ))}
            </Section>
          )}
          {memory.length > 0 && (
            <Section icon={Brain} label="Intelligence">
              {memory.map(m => (
                <Row key={m.id}
                  primary={m.content}
                  meta={m.memory_type.replace(/_/g, ' ')}
                  threadId={m.source_thread_id}
                />
              ))}
            </Section>
          )}
          {contacts.length > 0 && (
            <Section icon={UserCircle2} label="Contacts">
              {contacts.map(c => (
                <Row key={c.id}
                  primary={c.name}
                  meta={c.title ?? 'Strategy-confirmed contact'}
                  threadId={c.source_strategy_thread_id}
                />
              ))}
            </Section>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

function Section({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ primary, meta, threadId }: { primary: string; meta: string; threadId: string | null }) {
  return (
    <div className="flex items-start gap-2 p-2 rounded-md border border-border/30 bg-muted/10">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium line-clamp-2">{primary}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{meta}</p>
      </div>
      <Badge variant="outline" className="text-[8px] shrink-0">strategy</Badge>
      {threadId && (
        <Link to={`/strategy?thread=${threadId}`}
          className="text-muted-foreground hover:text-primary"
          title="Open source Strategy thread">
          <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
