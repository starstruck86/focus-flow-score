import { useParams, useNavigate, Link } from 'react-router-dom';
import { useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ChevronLeft, Compass, ChevronRight, Download } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingState, EmptyState, ErrorState } from '@/components/StateComponents';
import { GapScorePill } from '@/components/account-room/GapScorePill';
import { useAccountGapScores } from '@/hooks/useAccountGapScores';
import { useVerticalDetail } from '@/hooks/useVerticalDetail';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function CalloutBlock({ tone = 'primary', children }: { tone?: 'primary' | 'amber'; children: React.ReactNode }) {
  const cls =
    tone === 'amber'
      ? 'border-status-yellow/40 bg-status-yellow/5'
      : 'border-status-green/40 bg-status-green/5';
  return (
    <div className={`rounded-lg border-l-4 ${cls} px-4 py-3`}>{children}</div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function VerticalDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, loading, error } = useVerticalDetail(id);

  const accountIds = useMemo(() => (data?.accounts ?? []).map((a) => a.id), [data]);
  const gapScores = useAccountGapScores(accountIds);

  return (
    <div className="min-h-screen bg-background pt-[env(safe-area-inset-top)] pb-[calc(var(--shell-nav-height,101px)+16px)]">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-8">
        <button
          onClick={() => navigate('/verticals')}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" /> All verticals
        </button>

        {loading && <LoadingState message="Loading vertical…" />}
        {error && <ErrorState error={error} />}
        {!loading && !error && !data && <EmptyState title="Vertical not found" />}

        {data && (
          <>
            {/* Header */}
            <header className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
                  <Compass className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
                  {data.refreshed_at && (
                    <p className="text-xs text-muted-foreground">
                      Updated {formatDistanceToNow(new Date(data.refreshed_at), { addSuffix: true })}
                    </p>
                  )}
                </div>
              </div>
              {data.thesis ? (
                <CalloutBlock tone="primary">
                  <p className="text-xs font-semibold text-status-green uppercase tracking-wide mb-1">Thesis</p>
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{data.thesis}</p>
                </CalloutBlock>
              ) : (
                <EmptyState title="Not yet synthesized" description="This vertical has no thesis yet." />
              )}
            </header>

            {/* Three Structural Forces */}
            {data.structural_forces.length > 0 && (
              <Section title="Three Structural Forces">
                <div className="space-y-3">
                  {data.structural_forces.map((f, idx) => (
                    <Card key={idx} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-semibold text-foreground">{f.name}</h3>
                        {f.class && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {f.class}
                          </Badge>
                        )}
                      </div>
                      {f.evidence && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                            Evidence
                          </p>
                          <p className="text-sm text-foreground leading-relaxed">{f.evidence}</p>
                        </div>
                      )}
                      {f.mechanism && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                            Mechanism
                          </p>
                          <p className="text-sm text-muted-foreground leading-relaxed">{f.mechanism}</p>
                        </div>
                      )}
                      {f.so_what && (
                        <CalloutBlock tone="amber">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-status-yellow mb-1">
                            So What
                          </p>
                          <p className="text-sm text-foreground leading-relaxed">{f.so_what}</p>
                        </CalloutBlock>
                      )}
                    </Card>
                  ))}
                </div>
              </Section>
            )}

            {/* Cross-Account Map */}
            <Section title={`Cross-Account Map (${data.accounts.length})`}>
              {data.accounts.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No accounts mapped to this vertical.</p>
              ) : (
                <Card className="divide-y divide-border/60">
                  {data.accounts.map((a) => (
                    <Link
                      key={a.id}
                      to={`/accounts/${a.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{a.name}</p>
                        {a.tier && (
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{a.tier}</p>
                        )}
                      </div>
                      <GapScorePill gap={gapScores[a.id]} />
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </Link>
                  ))}
                </Card>
              )}
            </Section>

            {/* Teaching Narrative */}
            {data.teaching_narrative && (
              <Section title="Teaching Narrative">
                <Card className="p-4">
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
                    {data.teaching_narrative}
                  </p>
                </Card>
              </Section>
            )}

            {/* Full Brief (only if is_current row exists) */}
            {data.brief && data.brief.content_md && (
              <Section title={`Full Brief (v${data.brief.version})`}>
                <Card className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {data.brief.rendered_at
                        ? `Rendered ${formatDistanceToNow(new Date(data.brief.rendered_at), { addSuffix: true })}`
                        : ''}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        downloadMarkdown(
                          `${data.name.toLowerCase().replace(/\W+/g, '-')}-brief-v${data.brief!.version}.md`,
                          data.brief!.content_md ?? '',
                        )
                      }
                    >
                      <Download className="h-3 w-3 mr-1" />
                      Download
                    </Button>
                  </div>
                  <pre className="text-xs text-foreground whitespace-pre-wrap font-sans leading-relaxed max-h-96 overflow-y-auto">
                    {data.brief.content_md}
                  </pre>
                </Card>
              </Section>
            )}

            {/* Branch Relevance Map */}
            {data.branch_relevance_map && (
              <Section title="Branch Relevance Map">
                <Card className="p-4">
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
                    {data.branch_relevance_map}
                  </p>
                </Card>
              </Section>
            )}

            {/* Vocabulary */}
            {data.vocabulary.length > 0 && (
              <Section title="Vocabulary">
                <div className="flex flex-wrap gap-2">
                  {data.vocabulary.map((term, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs font-normal">
                      {String(term)}
                    </Badge>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  Metric dictionary — the language buyers in this vertical use natively.
                </p>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
