/**
 * FromStrategyPanel
 *
 * Consumer-side surface for Strategy-promoted intelligence. Renders on Account
 * and Opportunity detail pages and shows four rails of items that were
 * explicitly promoted out of Strategy via the proposal pipeline:
 *
 *   1. Resources       — `resources` rows where source='strategy'
 *   2. Intelligence    — `account_strategy_memory` / `opportunity_strategy_memory`
 *                        rows that carry a `source_thread_id`
 *   3. Contacts        — `contacts` rows where source='strategy' (account scope only)
 *   4. Transcripts     — `call_transcripts` rows where source='strategy'
 *
 * Each row links back to its source thread so provenance is visible on the
 * receiving surface — proving Strategy is no longer an island. The legacy
 * "Resources & Links" panel reads the `resource_links` table (a different
 * table) and therefore does NOT surface Strategy-promoted assets, which is
 * exactly why this parallel panel exists.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, FileText, Brain, UserCircle2, Mic,
  ExternalLink, Loader2, Download,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { CollapsibleSection } from '@/components/detail';
import { format } from 'date-fns';

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
  content: string | null;
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
interface TranscriptRow {
  id: string;
  title: string;
  call_date: string | null;
  summary: string | null;
  source_strategy_thread_id: string | null;
  promoted_at: string | null;
}

export function FromStrategyPanel({ scope, recordId }: Props) {
  const [loading, setLoading] = useState(true);
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [memory, setMemory] = useState<MemoryRow[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const idCol = scope === 'account' ? 'account_id' : 'opportunity_id';
      const memTable = scope === 'account' ? 'account_strategy_memory' : 'opportunity_strategy_memory';

      const [resR, memR, conR, txR] = await Promise.all([
        // Resources promoted from Strategy artifacts/uploads.
        // Quarantine filter: hide rows whose source thread was later flagged as
        // identity-conflicted (per trust gate doctrine). The DB row stays for
        // audit; the consumer surface treats it as not-truth.
        (supabase as any).from('resources')
          .select('id, title, resource_type, promotion_scope, source_strategy_thread_id, promoted_at, is_template, content')
          .eq(idCol, recordId).eq('source', 'strategy')
          .is('quarantined_at', null)
          .order('promoted_at', { ascending: false }).limit(20),
        // Memory items that originated in a Strategy thread.
        // Skip rows marked is_irrelevant — these are contaminated rows neutralized
        // after the source thread was flagged as identity-conflicted.
        (supabase as any).from(memTable)
          .select('id, memory_type, content, source_thread_id, created_at')
          .eq(idCol, recordId)
          .eq('is_irrelevant', false)
          .not('source_thread_id', 'is', null)
          .order('created_at', { ascending: false }).limit(20),
        // Contacts only exist at account scope
        scope === 'account'
          ? (supabase as any).from('contacts')
              .select('id, name, title, source_strategy_thread_id, promoted_at')
              .eq('account_id', recordId).eq('source', 'strategy')
              .order('promoted_at', { ascending: false }).limit(20)
          : Promise.resolve({ data: [] }),
        // Transcripts promoted from Strategy uploads
        (supabase as any).from('call_transcripts')
          .select('id, title, call_date, summary, source_strategy_thread_id, promoted_at')
          .eq(idCol, recordId).eq('source', 'strategy')
          .order('promoted_at', { ascending: false }).limit(20),
      ]);

      if (cancelled) return;
      setResources((resR.data ?? []) as ResourceRow[]);
      setMemory((memR.data ?? []) as MemoryRow[]);
      setContacts((conR.data ?? []) as ContactRow[]);
      setTranscripts((txR.data ?? []) as TranscriptRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [scope, recordId]);

  const total = resources.length + memory.length + contacts.length + transcripts.length;

  const downloadResource = (r: ResourceRow) => {
    const text = r.content ?? '';
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${r.title.replace(/[^a-z0-9-_ ]/gi, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <CollapsibleSection title="From Strategy" icon={Sparkles} count={total} defaultOpen={total > 0}>
      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : total === 0 ? (
        <p className="text-xs text-muted-foreground py-3">
          Nothing promoted from Strategy yet. Open a Strategy thread, classify a proposal as Shared Intel or CRM Contact, and it will appear here with provenance.
        </p>
      ) : (
        <div className="space-y-3 py-2">
          {resources.length > 0 && (
            <Section icon={FileText} label="Resources">
              {resources.map(r => (
                <Row key={r.id}
                  primary={r.title}
                  meta={[
                    r.resource_type,
                    r.promotion_scope,
                    r.is_template ? 'reusable' : null,
                    r.promoted_at ? format(new Date(r.promoted_at), 'MMM d') : null,
                  ].filter(Boolean).join(' · ')}
                  threadId={r.source_strategy_thread_id}
                  extraAction={r.content ? (
                    <button
                      type="button"
                      onClick={() => downloadResource(r)}
                      className="text-muted-foreground hover:text-primary"
                      title="Download as markdown"
                    >
                      <Download className="h-3 w-3" />
                    </button>
                  ) : null}
                />
              ))}
            </Section>
          )}
          {memory.length > 0 && (
            <Section icon={Brain} label="Intelligence">
              {memory.map(m => (
                <Row key={m.id}
                  primary={m.content}
                  meta={`${m.memory_type.replace(/_/g, ' ')} · ${format(new Date(m.created_at), 'MMM d')}`}
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
          {transcripts.length > 0 && (
            <Section icon={Mic} label="Transcripts">
              {transcripts.map(t => (
                <Row key={t.id}
                  primary={t.title}
                  meta={[
                    t.call_date ? format(new Date(t.call_date), 'MMM d') : null,
                    t.summary,
                  ].filter(Boolean).join(' · ').slice(0, 140)}
                  threadId={t.source_strategy_thread_id}
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

function Row({
  primary, meta, threadId, extraAction,
}: {
  primary: string;
  meta: string;
  threadId: string | null;
  extraAction?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 p-2 rounded-md border border-border/30 bg-muted/10">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium line-clamp-2">{primary}</p>
        {meta && <p className="text-[10px] text-muted-foreground mt-0.5">{meta}</p>}
      </div>
      <Badge variant="outline" className="text-[8px] shrink-0">strategy</Badge>
      {extraAction}
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
