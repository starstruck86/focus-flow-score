import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { BookMarked, ChevronRight } from 'lucide-react';
import { spokeLabel, topicLabel, useTrainCatalog } from '@/lib/train/catalog';

export default function TrainSpoke() {
  const { spoke = '' } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useTrainCatalog();

  const entry = useMemo(
    () => (data ?? []).find((s) => s.spoke === spoke) ?? null,
    [data, spoke],
  );

  return (
    <Layout>
      <main className={cn('mx-auto max-w-2xl px-4 pt-4', SHELL.main.bottomPad)}>
        <header className="mb-4">
          <button
            onClick={() => navigate('/train')}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Train
          </button>
          <h1 className="text-2xl font-bold mt-2">{spokeLabel(spoke)}</h1>
          <p className="text-sm text-muted-foreground">
            {entry
              ? `${entry.topicCount} topic${entry.topicCount === 1 ? '' : 's'} · ${entry.conceptCount} concepts`
              : 'Pick a topic to enter the ladder.'}
          </p>
        </header>

        {isLoading && <p className="text-sm text-muted-foreground">Loading topics…</p>}
        {error && (
          <p className="text-sm text-destructive">
            Failed to load topics: {(error as Error).message}
          </p>
        )}
        {!isLoading && !error && !entry && (
          <p className="text-sm text-muted-foreground">No topics found for this spoke.</p>
        )}

        <div className="space-y-2">
          {entry?.topics.map((t) => (
            <Card key={t.topic} className="p-3 border-primary/30 bg-primary/5">
              <button
                onClick={() => navigate(`/train/${spoke}/${t.topic}`)}
                className="w-full flex items-center justify-between text-left"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <BookMarked className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-semibold truncate">{topicLabel(t.topic)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Curriculum ladder · Foundation → Expert · cold band gates · {t.conceptCount} concept
                    {t.conceptCount === 1 ? '' : 's'}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            </Card>
          ))}
        </div>
      </main>
    </Layout>
  );
}
