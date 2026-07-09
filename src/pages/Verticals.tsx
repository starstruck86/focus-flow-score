import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Compass, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingState, EmptyState, ErrorState } from '@/components/StateComponents';
import { useVerticals } from '@/hooks/useVerticals';

function truncate(text: string, max = 220): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 100 ? lastSpace : max)}…`;
}

export default function Verticals() {
  const navigate = useNavigate();
  const { data, loading, error } = useVerticals();

  return (
    <div className="min-h-screen bg-background pt-[env(safe-area-inset-top)] pb-[calc(var(--shell-nav-height,101px)+16px)]">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <header className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
            <Compass className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Verticals</h1>
            <p className="text-xs text-muted-foreground">
              One narrative per market. Every account in the book maps to one of these.
            </p>
          </div>
        </header>

        {loading && <LoadingState message="Loading verticals…" />}
        {error && <ErrorState error={error} />}
        {!loading && !error && data.length === 0 && (
          <EmptyState title="No verticals yet" description="Nothing has been synthesized." />
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {data.map((v) => (
            <Card
              key={v.id}
              onClick={() => navigate(`/verticals/${v.id}`)}
              className="p-5 cursor-pointer hover:border-primary/40 transition-colors group"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                    {v.name}
                  </h2>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {v.account_count} account{v.account_count === 1 ? '' : 's'}
                    </span>
                    {v.refreshed_at && (
                      <>
                        <span className="opacity-40">•</span>
                        <span>updated {formatDistanceToNow(new Date(v.refreshed_at), { addSuffix: true })}</span>
                      </>
                    )}
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {v.structural_forces.length} forces
                </Badge>
              </div>
              {v.thesis ? (
                <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                  {truncate(v.thesis)}
                </p>
              ) : (
                <p className="text-xs italic text-muted-foreground">Not yet synthesized</p>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
