/**
 * Work hub — P1c-REAL.
 *
 * Tabs (URL-driven via ?tab=): desk | pipeline | territory | strategy.
 *   - desk       → quick actions & metrics (thin composition)
 *   - pipeline   → <Deals embedded/> + <Renewals embedded/>
 *   - territory  → <WeeklyOutreach embedded/>
 *   - strategy   → link out to full /strategy workspace (Strategy has
 *                  path-coupled shell behavior and is not safe to embed
 *                  this wave — per skip-on-fail discipline)
 *
 * Chrome: single hub header, amber accent. Embedded children render
 * chromeless via <EmbeddedLayoutProvider>.
 */
import { Suspense, lazy, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Briefcase, ArrowRight } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { EmbeddedLayoutProvider } from '@/components/layout/EmbeddedContext';
import { DeskComposition } from '@/components/work/DeskComposition';
import { WhitespaceGrid } from '@/components/work/WhitespaceGrid';

const WeeklyOutreach = lazy(() => import('./WeeklyOutreach'));
const Deals = lazy(() => import('./Deals'));
const Renewals = lazy(() => import('./Renewals'));

const AMBER = 'hsl(38 92% 58%)';
const VALID_TABS = ['desk', 'pipeline', 'territory', 'strategy'] as const;
type Tab = typeof VALID_TABS[number];

function Loading({ label }: { label: string }) {
  return <div className="p-8 text-sm text-muted-foreground">Loading {label}…</div>;
}

function DeskTab() {
  return <DeskComposition />;
}

function PipelineTab() {
  return (
    <EmbeddedLayoutProvider>
      <div className="space-y-6">
        <section>
          <h3 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Deals</h3>
          <Suspense fallback={<Loading label="deals" />}><Deals /></Suspense>
        </section>
        <section>
          <h3 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Renewals</h3>
          <Suspense fallback={<Loading label="renewals" />}><Renewals /></Suspense>
        </section>
      </div>
    </EmbeddedLayoutProvider>
  );
}

function TerritoryTab() {
  return (
    <EmbeddedLayoutProvider>
      <div className="space-y-6">
        <section>
          <h3 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Whitespace</h3>
          <WhitespaceGrid />
        </section>
        <section>
          <h3 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Territory</h3>
          <Suspense fallback={<Loading label="territory" />}><WeeklyOutreach /></Suspense>
        </section>
      </div>
    </EmbeddedLayoutProvider>
  );
}

function StrategyTab() {
  return (
    <div className="p-6 max-w-lg mx-auto text-center space-y-4">
      <p className="text-sm text-muted-foreground">
        Strategy has its own full-viewport workspace. Open it in place.
      </p>
      <Button asChild>
        <Link to="/strategy">
          Open Strategy Workspace <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}

export default function Work() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') ?? 'desk';
  const tab: Tab = (VALID_TABS as readonly string[]).includes(raw) ? (raw as Tab) : 'desk';

  const setTab = (t: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next, { replace: false });
  };

  const headerStyle = useMemo(() => ({ borderBottomColor: `${AMBER}33` }), []);

  return (
    <Layout>
      <div className="w-full">
        <header
          className="flex items-center gap-2 px-4 py-3 border-b sticky top-0 z-30 bg-background/95 backdrop-blur"
          style={headerStyle}
        >
          <Briefcase className="h-5 w-5" style={{ color: AMBER }} />
          <h1 className="font-display text-base font-bold">Work</h1>
        </header>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <div className="px-3 pt-3">
            <TabsList className="grid w-full grid-cols-4 max-w-2xl mx-auto">
              <TabsTrigger value="desk">Desk</TabsTrigger>
              <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
              <TabsTrigger value="territory">Territory</TabsTrigger>
              <TabsTrigger value="strategy">Strategy</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="desk"><DeskTab /></TabsContent>
          <TabsContent value="pipeline"><PipelineTab /></TabsContent>
          <TabsContent value="territory"><TerritoryTab /></TabsContent>
          <TabsContent value="strategy"><StrategyTab /></TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
