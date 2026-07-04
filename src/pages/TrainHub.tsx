/**
 * Train hub — P1c-REAL.
 *
 * Tabs (URL-driven via ?tab=): study | skills | review.
 *   - study   → <Study embedded/>
 *   - skills  → <Dojo embedded/> (drills / skill practice)
 *   - review  → links to /review, /grade, /car-mode
 *
 * Chrome: single hub header, jade accent. Embedded children render
 * chromeless via <EmbeddedLayoutProvider>.
 */
import { Suspense, lazy, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Dumbbell, ArrowRight } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { EmbeddedLayoutProvider } from '@/components/layout/EmbeddedContext';
import { useSwipeTabs } from '@/lib/gestures/useSwipeTabs';

const Study = lazy(() => import('./Study'));
const Dojo = lazy(() => import('./Dojo'));
const GatesHub = lazy(() => import('./GatesHub'));

const JADE = 'hsl(var(--brand-train))';
const VALID_TABS = ['study', 'skills', 'review'] as const;
type Tab = typeof VALID_TABS[number];

function SwipeTabsZone({ tabs, active, onChange, children }: { tabs: readonly string[]; active: string; onChange: (t: string) => void; children: React.ReactNode }) {
  const handlers = useSwipeTabs({ tabs, active, onChange });
  return <div {...handlers} style={{ touchAction: 'pan-y' }}>{children}</div>;
}

function Loading({ label }: { label: string }) {
  return <div className="p-8 text-sm text-muted-foreground">Loading {label}…</div>;
}

function StudyTab() {
  return (
    <EmbeddedLayoutProvider>
      <Suspense fallback={<Loading label="study" />}><Study /></Suspense>
    </EmbeddedLayoutProvider>
  );
}

function SkillsTab() {
  return (
    <EmbeddedLayoutProvider>
      <Suspense fallback={<Loading label="gates" />}><GatesHub /></Suspense>
      <div className="mt-6 border-t border-border pt-2">
        <Suspense fallback={<Loading label="skills" />}><Dojo /></Suspense>
      </div>
    </EmbeddedLayoutProvider>
  );
}

function ReviewTab() {
  return (
    <div className="p-6 max-w-lg mx-auto space-y-3">
      <p className="text-sm text-muted-foreground">Review & reflection surfaces.</p>
      <div className="grid grid-cols-1 gap-2">
        <Button asChild variant="outline" className="justify-between"><Link to="/review">Weekly Review <ArrowRight className="h-4 w-4" /></Link></Button>
        <Button asChild variant="outline" className="justify-between"><Link to="/grade">Game film <ArrowRight className="h-4 w-4" /></Link></Button>
        <Button asChild variant="outline" className="justify-between"><Link to="/car-mode">Car Mode <ArrowRight className="h-4 w-4" /></Link></Button>
        <Button asChild variant="outline" className="justify-between"><Link to="/progress">Progress <ArrowRight className="h-4 w-4" /></Link></Button>
      </div>
    </div>
  );
}

export default function TrainHub() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') ?? 'study';
  const tab: Tab = (VALID_TABS as readonly string[]).includes(raw) ? (raw as Tab) : 'study';

  const setTab = (t: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next, { replace: false });
  };

  const headerStyle = useMemo(() => ({ borderBottomColor: `${JADE}33` }), []);

  return (
    <Layout>
      <div className="w-full">
        <header
          className="flex items-center gap-2 px-4 py-3 border-b sticky top-0 z-30 bg-background/95 backdrop-blur"
          style={headerStyle}
        >
          <Dumbbell className="h-5 w-5" style={{ color: JADE }} />
          <h1 className="font-display text-base font-bold">Train</h1>
        </header>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <div className="px-3 pt-3">
            <TabsList className="grid w-full grid-cols-3 max-w-md mx-auto">
              <TabsTrigger value="study">Study</TabsTrigger>
              <TabsTrigger value="skills">Skills</TabsTrigger>
              <TabsTrigger value="review">Review</TabsTrigger>
            </TabsList>
          </div>
          <SwipeTabsZone tabs={VALID_TABS} active={tab} onChange={setTab}>
            <TabsContent value="study"><StudyTab /></TabsContent>
            <TabsContent value="skills"><SkillsTab /></TabsContent>
            <TabsContent value="review"><ReviewTab /></TabsContent>
          </SwipeTabsZone>
        </Tabs>
      </div>
    </Layout>
  );
}
