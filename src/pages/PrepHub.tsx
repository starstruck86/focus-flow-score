import { useState, useCallback, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCopilot } from '@/contexts/CopilotContext';
import { useAuth } from '@/contexts/AuthContext';
import { 
  Crosshair, GraduationCap, Download, FileText,
} from 'lucide-react';
import { VoiceCommandButton } from '@/components/VoiceCommandButton';

// Execute tab components
import { ExecutionWorkbench } from '@/components/prep/ExecutionWorkbench';
import { ContentBuilder } from '@/components/prep/ContentBuilder';

// Learn tab components
import { SalesBrainDashboard } from '@/components/prep/SalesBrainDashboard';
import { PlaybooksPanel } from '@/components/prep/PlaybooksPanel';

// Ingest tab components
import { SourceRegistryManager } from '@/components/prep/SourceRegistryManager';
import { IncomingQueue } from '@/components/prep/IncomingQueue';
import { AudioTestHarness } from '@/components/prep/AudioTestHarness';

// Library tab component
import { ResourceManager } from '@/components/prep/ResourceManager';

// Governance (feature-flagged overlay)
import { GovernancePanel } from '@/components/governance/GovernancePanel';

export default function PrepHub() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('execute');

  // Listen for Dave navigation event
  useEffect(() => {
    const handler = () => setActiveTab('execute');
    window.addEventListener('dave-open-content-builder', handler);
    return () => window.removeEventListener('dave-open-content-builder', handler);
  }, []);

  return (
    <Layout>
      <div data-testid="prephub-page" className="p-4 space-y-4 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Sales Brain OS</h1>
            <p className="text-xs text-muted-foreground">Execute · Learn · Ingest · Library</p>
          </div>
          <div className="flex items-center gap-2">
            <VoiceCommandButton />
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="execute" className="text-xs gap-1.5">
              <Crosshair className="h-3.5 w-3.5" />
              Execute
            </TabsTrigger>
            <TabsTrigger value="learn" className="text-xs gap-1.5">
              <GraduationCap className="h-3.5 w-3.5" />
              Learn
            </TabsTrigger>
            <TabsTrigger value="ingest" className="text-xs gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Ingest
            </TabsTrigger>
            <TabsTrigger value="library" className="text-xs gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Library
            </TabsTrigger>
          </TabsList>

          {/* GOVERNANCE PANEL — collapsible, feature-flagged */}
          <GovernancePanel />

          {/* ═══ EXECUTE ═══ */}
          <TabsContent value="execute" className="mt-3 space-y-4">
            <ExecutionWorkbench />
            <ContentBuilder />
          </TabsContent>

          {/* ═══ LEARN ═══ */}
          <TabsContent value="learn" className="mt-3 space-y-4">
            <SalesBrainDashboard />
            <PlaybooksPanel />
          </TabsContent>

          {/* ═══ INGEST ═══ */}
          <TabsContent value="ingest" className="mt-3 space-y-4">
            <SourceRegistryManager />
            <IncomingQueue />
            <AudioTestHarness />
          </TabsContent>

          {/* ═══ LIBRARY ═══ */}
          <TabsContent value="library" className="mt-3">
            <ResourceManager />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
