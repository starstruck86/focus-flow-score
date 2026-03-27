import { useState, useCallback, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useCopilot } from '@/contexts/CopilotContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { 
  FileText, Sparkles, Mail, 
  MessageSquare, Wand2, BookOpen
} from 'lucide-react';
import { VoiceCommandButton } from '@/components/VoiceCommandButton';
import { ResourceManager } from '@/components/prep/ResourceManager';
import { TemplateManager } from '@/components/prep/TemplateManager';
import { ContentBuilder } from '@/components/prep/ContentBuilder';
import { CustomPromptsManager } from '@/components/prep/CustomPromptsManager';
import { PlaybooksPanel } from '@/components/prep/PlaybooksPanel';
import { ExecutionWorkbench } from '@/components/prep/ExecutionWorkbench';

const PREP_PROMPTS = [
  { label: 'Pre-Call Research Brief', prompt: 'Research and prep me for my upcoming call with {{account}}. Include company background, recent news, key stakeholders, potential pain points, and suggested discovery questions.', mode: 'meeting' as const },
  { label: 'Stakeholder Map', prompt: 'Map out the likely buying committee for {{account}}. Who are the economic buyer, champion, technical evaluator, and coach? What do I need from each?', mode: 'deal-strategy' as const },
  { label: 'Objection Prep', prompt: 'What are the top 5 objections I should expect from {{account}} given their industry, size, and current tech stack? Give me rebuttals for each.', mode: 'deal-strategy' as const },
  { label: 'Competitive Positioning', prompt: 'How should I position against {{competitor}} when talking to {{account}}? What are our key differentiators and where do we need to be careful?', mode: 'deal-strategy' as const },
  { label: 'MEDDICC Gap Analysis', prompt: 'Run a MEDDICC analysis on my deal with {{account}}. Where are the gaps? What questions should I ask to fill them?', mode: 'deal-strategy' as const },
  { label: 'Recap Email Draft', prompt: 'Draft a professional follow-up email after my call with {{account}}. Include key discussion points, agreed next steps, and relevant resources.', mode: 'recap-email' as const },
  { label: 'QBR Prep', prompt: 'Help me prepare for a QBR with {{account}}. What metrics should I highlight? What expansion opportunities exist? What risks should I address proactively?', mode: 'meeting' as const },
  { label: 'Executive Email', prompt: 'Draft an executive-level email to the VP/C-suite at {{account}} that positions our value at a strategic level, not feature-level.', mode: 'recap-email' as const },
];

export default function PrepHub() {
  const { ask: askCopilot } = useCopilot();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('content-builder');
  const [promptAccount, setPromptAccount] = useState('');

  // Listen for Dave navigation event
  useEffect(() => {
    const handler = () => setActiveTab('content-builder');
    window.addEventListener('dave-open-content-builder', handler);
    return () => window.removeEventListener('dave-open-content-builder', handler);
  }, []);

  const handleRunPrompt = useCallback((prompt: string, mode: string) => {
    const filled = promptAccount ? prompt.replace(/\{\{account\}\}/g, promptAccount).replace(/\{\{competitor\}\}/g, 'the competitor') : prompt;
    askCopilot(filled, mode as any);
  }, [askCopilot, promptAccount]);

  return (
    <Layout>
      <div data-testid="prephub-page" className="p-4 space-y-4 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Prep Hub</h1>
            <p className="text-xs text-muted-foreground">Content engine, call prep & AI-powered templates</p>
          </div>
          <div className="flex items-center gap-2">
            <VoiceCommandButton />
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-6">
            <TabsTrigger value="content-builder" className="text-xs">
              <Wand2 className="h-3.5 w-3.5 mr-1" />
              Build
            </TabsTrigger>
            <TabsTrigger value="resources" className="text-xs">
              <FileText className="h-3.5 w-3.5 mr-1" />
              Library
            </TabsTrigger>
            <TabsTrigger value="playbooks" className="text-xs">
              <BookOpen className="h-3.5 w-3.5 mr-1" />
              Playbooks
            </TabsTrigger>
            <TabsTrigger value="prep" className="text-xs">
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              AI Prep
            </TabsTrigger>
            <TabsTrigger value="templates" className="text-xs">
              <Mail className="h-3.5 w-3.5 mr-1" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="prompts" className="text-xs">
              <MessageSquare className="h-3.5 w-3.5 mr-1" />
              Prompts
            </TabsTrigger>
          </TabsList>

          {/* CONTENT BUILDER TAB */}
          <TabsContent value="content-builder" className="mt-3">
            <ContentBuilder />
          </TabsContent>

          {/* RESOURCES TAB */}
          <TabsContent value="resources" className="mt-3">
            <ResourceManager />
          </TabsContent>

          {/* PLAYBOOKS TAB */}
          <TabsContent value="playbooks" className="mt-3">
            <PlaybooksPanel />
          </TabsContent>

          {/* AI PREP TAB */}
          <TabsContent value="prep" className="space-y-3 mt-3">
            <div className="flex items-center gap-1.5 bg-muted/50 rounded-lg px-2 py-1 w-fit">
              <span className="text-xs text-muted-foreground">Account:</span>
              <Input
                value={promptAccount}
                onChange={e => setPromptAccount(e.target.value)}
                placeholder="e.g. Acme Corp"
                className="h-7 w-36 text-xs bg-transparent border-0 p-0 focus-visible:ring-0"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PREP_PROMPTS.map((p, i) => (
                <Card key={i} className="cursor-pointer hover:border-primary/40 transition-colors group" onClick={() => handleRunPrompt(p.prompt, p.mode)}>
                  <CardContent className="p-3 flex items-start gap-2">
                    <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{p.label}</p>
                      <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{p.prompt.replace(/\{\{account\}\}/g, promptAccount || '___')}</p>
                    </div>
                    <Badge variant="secondary" className="text-[10px] shrink-0">{p.mode}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* TEMPLATES TAB */}
          <TabsContent value="templates" className="space-y-3 mt-3">
            <TemplateManager />
          </TabsContent>

          {/* MY PROMPTS TAB */}
          <TabsContent value="prompts" className="space-y-3 mt-3">
            <CustomPromptsManager />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
