/**
 * Knowledge Workspace — merges Learn + Library into one place.
 * 
 * 5 internal sub-tabs: Overview, Resources, Knowledge Items, Review, Audit
 */

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, FileText, Brain, Shield, ClipboardCheck } from 'lucide-react';

// Sub-tab content
import { KnowledgeOverview } from './KnowledgeOverview';
import { ResourceManager } from '@/components/prep/ResourceManager';
import { PlaybookEngine } from '@/components/prep/PlaybookEngine';
import { ResourceReadinessSheet } from '@/components/prep/ResourceReadinessSheet';
import { ResourceUpsideQueue } from './ResourceUpsideQueue';
import { LowYieldReviewQueue } from './LowYieldReviewQueue';
import { DuplicateReviewQueue } from './DuplicateReviewQueue';

export function KnowledgeWorkspace() {
  const [subTab, setSubTab] = useState('overview');
  const [readinessOpen, setReadinessOpen] = useState(false);

  return (
    <div className="space-y-3">
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="flex w-full overflow-x-auto">
          <TabsTrigger value="overview" className="text-xs gap-1 flex-shrink-0">
            <BarChart3 className="h-3 w-3" />
            <span className="hidden sm:inline">Overview</span>
            <span className="sm:hidden">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="resources" className="text-xs gap-1 flex-shrink-0">
            <FileText className="h-3 w-3" />
            <span>Resources</span>
          </TabsTrigger>
          <TabsTrigger value="items" className="text-xs gap-1 flex-shrink-0">
            <Brain className="h-3 w-3" />
            <span className="hidden sm:inline">Knowledge Items</span>
            <span className="sm:hidden">Items</span>
          </TabsTrigger>
          <TabsTrigger value="review" className="text-xs gap-1 flex-shrink-0">
            <ClipboardCheck className="h-3 w-3" />
            <span>Review</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="text-xs gap-1 flex-shrink-0">
            <Shield className="h-3 w-3" />
            <span>Audit</span>
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

        <TabsContent value="review" className="mt-3">
          <div className="space-y-4">
            <LowYieldReviewQueue />
            <DuplicateReviewQueue />
          </div>
        </TabsContent>

        <TabsContent value="audit" className="mt-3">
          <div className="space-y-4">
            {/* Resource Upside Queue — primary curation surface */}
            <ResourceUpsideQueue />

            {/* Deep audit access */}
            <div className="flex items-center justify-between border border-border rounded-lg bg-card p-3">
              <div>
                <p className="text-xs font-medium text-foreground">Deep Audit & Diagnostics</p>
                <p className="text-[10px] text-muted-foreground">
                  Pipeline funnels, invariant checks, and remediation tools
                </p>
              </div>
              <button
                onClick={() => setReadinessOpen(true)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
              >
                Open Console
              </button>
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