/**
 * Knowledge Workspace — merges Learn + Library into one place.
 * 
 * 4 internal sub-tabs: Overview, Resources, Knowledge Items, Audit
 */

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, FileText, Brain, Shield } from 'lucide-react';

// Sub-tab content
import { KnowledgeOverview } from './KnowledgeOverview';
import { ResourceManager } from '@/components/prep/ResourceManager';
import { PlaybookEngine } from '@/components/prep/PlaybookEngine';
import { ResourceReadinessSheet } from '@/components/prep/ResourceReadinessSheet';
import { ResourceUpsideQueue } from './ResourceUpsideQueue';

export function KnowledgeWorkspace() {
  const [subTab, setSubTab] = useState('overview');
  const [readinessOpen, setReadinessOpen] = useState(false);

  return (
    <div className="space-y-3">
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview" className="text-xs gap-1">
            <BarChart3 className="h-3 w-3" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="resources" className="text-xs gap-1">
            <FileText className="h-3 w-3" />
            Resources
          </TabsTrigger>
          <TabsTrigger value="items" className="text-xs gap-1">
            <Brain className="h-3 w-3" />
            Knowledge Items
          </TabsTrigger>
          <TabsTrigger value="audit" className="text-xs gap-1">
            <Shield className="h-3 w-3" />
            Audit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-3">
          <KnowledgeOverview
            onNavigateToResources={() => setSubTab('resources')}
            onNavigateToKnowledgeItems={() => setSubTab('items')}
            onNavigateToAudit={() => setSubTab('audit')}
          />
        </TabsContent>

        <TabsContent value="resources" className="mt-3">
          <ResourceManager />
        </TabsContent>

        <TabsContent value="items" className="mt-3">
          <PlaybookEngine />
        </TabsContent>

        <TabsContent value="audit" className="mt-3">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Deep Audit & Diagnostics</p>
                <p className="text-[10px] text-muted-foreground">
                  Technical diagnostics, invariant checks, pipeline funnels, and remediation tools
                </p>
              </div>
              <button
                onClick={() => setReadinessOpen(true)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
              >
                Open Audit Console
              </button>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
              <Shield className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                Click "Open Audit Console" to access detailed resource readiness, pipeline validation,
                knowledge remediation, and system health checks.
              </p>
            </div>
          </div>
          <ResourceReadinessSheet
            open={readinessOpen}
            onOpenChange={setReadinessOpen}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
