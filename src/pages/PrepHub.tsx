import { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Crosshair, Brain, Download } from 'lucide-react';
import { VoiceCommandButton } from '@/components/VoiceCommandButton';
import { PodcastQueueIndicator } from '@/components/prep/PodcastQueueIndicator';

// Consolidated workspaces
import { PrepCommandCenter } from '@/components/prep-tab/PrepCommandCenter';
import { KnowledgeWorkspace } from '@/components/knowledge/KnowledgeWorkspace';
import { IngestWorkspace } from '@/components/ingest/IngestWorkspace';

// Governance (feature-flagged overlay)
import { GovernancePanel } from '@/components/governance/GovernancePanel';

export default function PrepHub() {
  const [activeTab, setActiveTab] = useState('prep');

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
            <p className="text-xs text-muted-foreground">Prep · Knowledge · Ingest</p>
          </div>

          <div className="flex items-center gap-2">
            <PodcastQueueIndicator />
            <VoiceCommandButton />
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className={SHELL.tabs.list}>
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
