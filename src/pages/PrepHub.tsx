import { useState, useEffect } from 'react';
import { PlaybookGeneratorCard } from '@/components/prep/PlaybookGeneratorCard';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Crosshair, Brain, Download, Shield } from 'lucide-react';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { VoiceCommandButton } from '@/components/VoiceCommandButton';
import { PodcastQueueIndicator } from '@/components/prep/PodcastQueueIndicator';

// Consolidated workspaces
import { PrepCommandCenter } from '@/components/prep-tab/PrepCommandCenter';
import { KnowledgeWorkspace } from '@/components/knowledge/KnowledgeWorkspace';
import { IngestWorkspace } from '@/components/ingest/IngestWorkspace';
import { KnowledgeControlPlane } from '@/components/control-plane/KnowledgeControlPlane';

// Governance (feature-flagged overlay)
import { GovernancePanel } from '@/components/governance/GovernancePanel';

export default function PrepHub() {
  const [activeTab, setActiveTab] = useState('control-plane');

  // Listen for Dave navigation event
  useEffect(() => {
    const handler = () => setActiveTab('prep');
    window.addEventListener('dave-open-content-builder', handler);
    return () => window.removeEventListener('dave-open-content-builder', handler);
  }, []);

  return (
    <Layout>
      <div data-testid="prephub-page" className="p-4 space-y-4 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Sales Brain OS</h1>
            <p className="text-xs text-muted-foreground">Control Plane · Prep · Knowledge · Ingest</p>
          </div>

          <div className="flex items-center gap-2">
            <PodcastQueueIndicator />
            <VoiceCommandButton />
          </div>
        </div>

        {/* Playbook Generation */}
        <PlaybookGeneratorCard />

        {/* Branch.io Intelligence Checklist */}
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-5 w-5 rounded bg-blue-600 flex items-center justify-center shrink-0">
                <span className="text-white text-[10px] font-bold">B</span>
              </div>
              <div>
                <p className="text-sm font-semibold">Branch.io Intelligence</p>
                <p className="text-xs text-muted-foreground">Ingest these before July to build your competitive edge</p>
              </div>
            </div>
            <div className="space-y-1.5">
              {[
                { label: 'Branch.io Product Overview / Sales Deck', priority: 'critical' },
                { label: 'Branch.io vs AppsFlyer Battle Card', priority: 'critical' },
                { label: 'Branch.io vs Adjust Battle Card', priority: 'critical' },
                { label: 'Branch.io vs Kochava Battle Card', priority: 'high' },
                { label: 'E-commerce Customer Case Study', priority: 'high' },
                { label: 'Gaming Customer Case Study', priority: 'high' },
                { label: 'Fintech Customer Case Study', priority: 'high' },
                { label: 'CMO Persona Guide', priority: 'medium' },
                { label: 'VP Growth / Mobile Persona Guide', priority: 'medium' },
                { label: 'ATT / SKAN Privacy FAQ', priority: 'medium' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2 text-xs">
                  <div className={cn(
                    'h-1.5 w-1.5 rounded-full shrink-0',
                    item.priority === 'critical' ? 'bg-red-500' :
                    item.priority === 'high' ? 'bg-amber-500' : 'bg-blue-400'
                  )} />
                  <span className="text-foreground">{item.label}</span>
                  <span className={cn(
                    'ml-auto shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded',
                    item.priority === 'critical' ? 'bg-red-500/15 text-red-600 dark:text-red-400' :
                    item.priority === 'high' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' :
                    'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                  )}>
                    {item.priority}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">
              Submit each through the Ingest tab below ↓
            </p>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className={SHELL.tabs.list}>
            <TabsTrigger value="control-plane" className={SHELL.tabs.triggerWithIcon}>
              <Shield className="h-3.5 w-3.5" />
              Control Plane
            </TabsTrigger>
            <TabsTrigger value="prep" className={SHELL.tabs.triggerWithIcon}>
              <Crosshair className="h-3.5 w-3.5" />
              Prep
            </TabsTrigger>
            <TabsTrigger value="knowledge" className={SHELL.tabs.triggerWithIcon}>
              <Brain className="h-3.5 w-3.5" />
              Knowledge
            </TabsTrigger>
            <TabsTrigger value="ingest" className={SHELL.tabs.triggerWithIcon}>
              <Download className="h-3.5 w-3.5" />
              Ingest
            </TabsTrigger>
          </TabsList>

          {/* GOVERNANCE PANEL — collapsible, feature-flagged */}
          <GovernancePanel />

          {/* ═══ CONTROL PLANE ═══ */}
          <TabsContent value="control-plane" className="mt-3">
            <KnowledgeControlPlane />
          </TabsContent>

          {/* ═══ PREP ═══ */}
          <TabsContent value="prep" className="mt-3">
            <PrepCommandCenter />
          </TabsContent>

          {/* ═══ KNOWLEDGE ═══ */}
          <TabsContent value="knowledge" className="mt-3">
            <KnowledgeWorkspace />
          </TabsContent>

          {/* ═══ INGEST ═══ */}
          <TabsContent value="ingest" className="mt-3">
            <IngestWorkspace />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
