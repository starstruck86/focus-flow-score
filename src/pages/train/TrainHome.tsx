import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { BookMarked, ChevronRight } from 'lucide-react';
import { spokeLabel, useTrainCatalog } from '@/lib/train/catalog';

export default function TrainHome() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useTrainCatalog();

  return (
    <Layout>
      <main className={cn('mx-auto max-w-2xl px-4 pt-4', SHELL.main.bottomPad)}>
        <header className="mb-4">
          <button
            onClick={() => navigate('/dojo')}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Dojo
          </button>
          <h1 className="text-2xl font-bold mt-2">Train</h1>
          <p className="text-sm text-muted-foreground">
            Full curriculum · 10 spokes · Foundation → Expert with cold band gates.
          </p>
        </header>

        {isLoading && <p className="text-sm text-muted-foreground">Loading curriculum…</p>}
        {error && (
          <p className="text-sm text-destructive">
            Failed to load curriculum: {(error as Error).message}
          </p>
        )}

        <div className="space-y-2">
          {(data ?? []).map((s) => (
            <Card key={s.spoke} className="p-3 border-primary/30 bg-primary/5">
              <button
                onClick={() => navigate(`/train/${s.spoke}`)}
                className="w-full flex items-center justify-between text-left"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <BookMarked className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-semibold truncate">{spokeLabel(s.spoke)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {s.topicCount} topic{s.topicCount === 1 ? '' : 's'} · {s.conceptCount} concept
                    {s.conceptCount === 1 ? '' : 's'}
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
