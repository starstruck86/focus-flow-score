/**
 * Prep Workspace — template-first execution surface.
 * 
 * Absorbs Execute tab spirit. Driven by templates and prior work.
 * Meeting prep, draft generation, template recommendations.
 */

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Target, FileText, Sparkles, Layout } from 'lucide-react';

// Existing execute components
import { MeetingPrepEngine } from '@/components/prep/MeetingPrepEngine';
import { ContentBuilder } from '@/components/prep/ContentBuilder';
import { TemplateManager } from '@/components/prep/TemplateManager';

// Execution workspace components
import { ExecutionWorkbench } from '@/components/prep/ExecutionWorkbench';

export function PrepWorkspace() {
  const [subTab, setSubTab] = useState('create');

  return (
    <div className="space-y-3">
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="create" className="text-xs gap-1">
            <Sparkles className="h-3 w-3" />
            Create
          </TabsTrigger>
          <TabsTrigger value="meeting" className="text-xs gap-1">
            <Target className="h-3 w-3" />
            Meeting Prep
          </TabsTrigger>
          <TabsTrigger value="templates" className="text-xs gap-1">
            <Layout className="h-3 w-3" />
            Templates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="mt-3 space-y-4">
          <ExecutionWorkbench />
          <ContentBuilder />
        </TabsContent>

        <TabsContent value="meeting" className="mt-3 space-y-4">
          <MeetingPrepEngine />
        </TabsContent>

        <TabsContent value="templates" className="mt-3 space-y-4">
          <TemplateManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
