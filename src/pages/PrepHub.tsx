import { useState, useCallback } from 'react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCopilot } from '@/contexts/CopilotContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { 
  FileText, Plus, Trash2, Copy, Sparkles, Phone, Mail, 
  MessageSquare, Edit3, Save, X, ChevronRight, Mic
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { VoiceCommandButton } from '@/components/VoiceCommandButton';
import { ResourceManager } from '@/components/prep/ResourceManager';

// ---------- Types ----------
interface EmailTemplate {
  id: string;
  name: string;
  category: string;
  subject: string;
  body: string;
  variables: string[];
  created_at: string;
}

const DEFAULT_TEMPLATES: Omit<EmailTemplate, 'id' | 'created_at'>[] = [
  {
    name: 'Post-Discovery Recap',
    category: 'follow-up',
    subject: 'Great connecting today — next steps for {{company}}',
    body: `Hi {{first_name}},

Thank you for taking the time to meet today. I really enjoyed learning more about {{company}}'s approach to {{topic_discussed}}.

Here's a quick recap of what we covered:
- {{key_point_1}}
- {{key_point_2}}
- {{key_point_3}}

As discussed, the next step is {{next_step}}. I'll have that ready by {{date}}.

In the meantime, I've attached {{resource}} that I think you'll find relevant given your focus on {{pain_point}}.

Looking forward to our next conversation!

Best,
{{your_name}}`,
    variables: ['first_name', 'company', 'topic_discussed', 'key_point_1', 'key_point_2', 'key_point_3', 'next_step', 'date', 'resource', 'pain_point', 'your_name'],
  },
  {
    name: 'Post-Demo Follow-Up',
    category: 'follow-up',
    subject: 'Demo recap + {{company}} next steps',
    body: `Hi {{first_name}},

Great demo today! I wanted to follow up with a summary and the resources we discussed.

What we showed you:
- {{feature_1}} — addresses your need for {{need_1}}
- {{feature_2}} — solves {{need_2}}

Your questions & our answers:
- Q: {{question_1}} → A: {{answer_1}}

Agreed next steps:
1. {{next_step_1}}
2. {{next_step_2}}

I'll send over {{deliverable}} by {{date}}. Let me know if you need anything else in the meantime.

Best,
{{your_name}}`,
    variables: ['first_name', 'company', 'feature_1', 'need_1', 'feature_2', 'need_2', 'question_1', 'answer_1', 'next_step_1', 'next_step_2', 'deliverable', 'date', 'your_name'],
  },
  {
    name: 'Mutual Action Plan',
    category: 'deal-progression',
    subject: 'Mutual success plan — {{company}} x {{your_company}}',
    body: `Hi {{first_name}},

Following our conversation, I wanted to outline a mutual action plan to ensure we're aligned on timing and deliverables:

| Date | Action | Owner |
|------|--------|-------|
| {{date_1}} | {{action_1}} | {{owner_1}} |
| {{date_2}} | {{action_2}} | {{owner_2}} |
| {{date_3}} | {{action_3}} | {{owner_3}} |

Target go-live: {{target_date}}

Key stakeholders to involve:
- {{stakeholder_1}} ({{role_1}})
- {{stakeholder_2}} ({{role_2}})

Does this timeline work for your team? Happy to adjust based on your internal processes.

Best,
{{your_name}}`,
    variables: ['first_name', 'company', 'your_company', 'date_1', 'action_1', 'owner_1', 'date_2', 'action_2', 'owner_2', 'date_3', 'action_3', 'owner_3', 'target_date', 'stakeholder_1', 'role_1', 'stakeholder_2', 'role_2', 'your_name'],
  },
  {
    name: 'Check-In (Gone Dark)',
    category: 're-engagement',
    subject: 'Quick check-in — {{topic}}',
    body: `Hi {{first_name}},

I wanted to check in since we last spoke about {{topic}} on {{last_meeting_date}}. I know things can get busy, so no pressure at all.

Since our last conversation, {{new_development}} — thought this might be relevant given your interest in {{their_priority}}.

Would it make sense to reconnect for a quick 15-minute call this week? Happy to work around your schedule.

Best,
{{your_name}}`,
    variables: ['first_name', 'topic', 'last_meeting_date', 'new_development', 'their_priority', 'your_name'],
  },
  {
    name: 'Executive Sponsor Intro',
    category: 'deal-progression',
    subject: 'Connecting {{exec_name}} and {{their_exec}} — {{topic}}',
    body: `Hi {{first_name}},

As we discussed, I'd love to connect our {{exec_title}}, {{exec_name}}, with {{their_exec}} to discuss {{strategic_topic}} at the executive level.

{{exec_name}} has worked with similar organizations like {{reference_company}} on {{similar_initiative}} and would bring valuable perspective to your {{their_initiative}}.

Would {{their_exec}} be available for a brief 20-minute call {{suggested_timeframe}}?

Best,
{{your_name}}`,
    variables: ['first_name', 'exec_name', 'exec_title', 'their_exec', 'strategic_topic', 'reference_company', 'similar_initiative', 'their_initiative', 'suggested_timeframe', 'your_name'],
  },
];

const TEMPLATE_CATEGORIES = [
  { value: 'follow-up', label: 'Follow-Up', icon: Mail },
  { value: 'deal-progression', label: 'Deal Progression', icon: ChevronRight },
  { value: 're-engagement', label: 'Re-Engagement', icon: MessageSquare },
  { value: 'meeting-request', label: 'Meeting Request', icon: Phone },
  { value: 'custom', label: 'Custom', icon: FileText },
];

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
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('prep');
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: '', category: 'custom', subject: '', body: '' });
  const [promptAccount, setPromptAccount] = useState('');

  // Load templates from localStorage (could migrate to DB later)
  const { data: templates = [] } = useQuery({
    queryKey: ['email-templates', user?.id],
    queryFn: () => {
      const stored = localStorage.getItem(`prep-templates-${user?.id}`);
      if (stored) return JSON.parse(stored) as EmailTemplate[];
      // Seed with defaults
      const seeded = DEFAULT_TEMPLATES.map((t, i) => ({
        ...t,
        id: `default-${i}`,
        created_at: new Date().toISOString(),
      }));
      localStorage.setItem(`prep-templates-${user?.id}`, JSON.stringify(seeded));
      return seeded;
    },
    enabled: !!user,
  });

  const saveTemplates = useCallback((updated: EmailTemplate[]) => {
    localStorage.setItem(`prep-templates-${user?.id}`, JSON.stringify(updated));
    queryClient.setQueryData(['email-templates', user?.id], updated);
  }, [user?.id, queryClient]);

  const handleAddTemplate = useCallback(() => {
    if (!newTemplate.name || !newTemplate.body) {
      toast.error('Name and body are required');
      return;
    }
    const vars = (newTemplate.body.match(/\{\{(\w+)\}\}/g) || []).map(v => v.replace(/\{\{|\}\}/g, ''));
    const template: EmailTemplate = {
      ...newTemplate,
      id: crypto.randomUUID(),
      variables: vars,
      created_at: new Date().toISOString(),
    };
    saveTemplates([...templates, template]);
    setNewTemplate({ name: '', category: 'custom', subject: '', body: '' });
    setShowAddTemplate(false);
    toast.success('Template added');
  }, [newTemplate, templates, saveTemplates]);

  const handleDeleteTemplate = useCallback((id: string) => {
    saveTemplates(templates.filter(t => t.id !== id));
    toast.success('Template deleted');
  }, [templates, saveTemplates]);

  const handleUpdateTemplate = useCallback(() => {
    if (!editingTemplate) return;
    const vars = (editingTemplate.body.match(/\{\{(\w+)\}\}/g) || []).map(v => v.replace(/\{\{|\}\}/g, ''));
    const updated = templates.map(t => t.id === editingTemplate.id ? { ...editingTemplate, variables: vars } : t);
    saveTemplates(updated);
    setEditingTemplate(null);
    toast.success('Template updated');
  }, [editingTemplate, templates, saveTemplates]);

  const handleCopyTemplate = useCallback((template: EmailTemplate) => {
    navigator.clipboard.writeText(`Subject: ${template.subject}\n\n${template.body}`);
    toast.success('Copied to clipboard');
  }, []);

  const handleRunPrompt = useCallback((prompt: string, mode: string) => {
    const filled = promptAccount ? prompt.replace(/\{\{account\}\}/g, promptAccount).replace(/\{\{competitor\}\}/g, 'the competitor') : prompt;
    askCopilot(filled, mode as any);
  }, [askCopilot, promptAccount]);

  const categoryFilter = (cat: string) => templates.filter(t => t.category === cat);

  return (
    <Layout>
      <div className="p-4 space-y-4 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Prep Hub</h1>
            <p className="text-xs text-muted-foreground">Call prep, email templates & AI-powered content</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-muted/50 rounded-lg px-2 py-1">
              <span className="text-xs text-muted-foreground">Account:</span>
              <Input
                value={promptAccount}
                onChange={e => setPromptAccount(e.target.value)}
                placeholder="e.g. Acme Corp"
                className="h-7 w-36 text-xs bg-transparent border-0 p-0 focus-visible:ring-0"
              />
            </div>
            <VoiceCommandButton />
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="resources" className="text-xs">
              <FileText className="h-3.5 w-3.5 mr-1" />
              Resources
            </TabsTrigger>
            <TabsTrigger value="prep" className="text-xs">
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              AI Prep
            </TabsTrigger>
            <TabsTrigger value="templates" className="text-xs">
              <FileText className="h-3.5 w-3.5 mr-1" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="prompts" className="text-xs">
              <MessageSquare className="h-3.5 w-3.5 mr-1" />
              My Prompts
            </TabsTrigger>
          </TabsList>

          {/* RESOURCES TAB */}
          <TabsContent value="resources" className="mt-3">
            <ResourceManager />
          </TabsContent>

          {/* AI PREP TAB */}
          <TabsContent value="prep" className="space-y-3 mt-3">
            <p className="text-xs text-muted-foreground">
              {promptAccount ? `Prepping for: ${promptAccount}` : 'Enter an account name above for personalized prompts'}
            </p>
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
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{templates.length} templates</p>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAddTemplate(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Template
              </Button>
            </div>

            {TEMPLATE_CATEGORIES.map(cat => {
              const catTemplates = categoryFilter(cat.value);
              if (catTemplates.length === 0) return null;
              return (
                <div key={cat.value} className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <cat.icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{cat.label}</span>
                    <Badge variant="secondary" className="text-[10px] ml-1">{catTemplates.length}</Badge>
                  </div>
                  {catTemplates.map(template => (
                    <Card key={template.id} className="group">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">{template.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Subject: {template.subject}</p>
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {template.variables.slice(0, 5).map(v => (
                                <Badge key={v} variant="outline" className="text-[10px]">{`{{${v}}}`}</Badge>
                              ))}
                              {template.variables.length > 5 && (
                                <Badge variant="outline" className="text-[10px]">+{template.variables.length - 5} more</Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleCopyTemplate(template)}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingTemplate({ ...template })}>
                              <Edit3 className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDeleteTemplate(template.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <pre className="text-[11px] text-muted-foreground mt-2 whitespace-pre-wrap line-clamp-4 font-sans">{template.body}</pre>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              );
            })}

            {/* Add Template Dialog */}
            <Dialog open={showAddTemplate} onOpenChange={setShowAddTemplate}>
              <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add Email Template</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <Input placeholder="Template name" value={newTemplate.name} onChange={e => setNewTemplate(p => ({ ...p, name: e.target.value }))} />
                  <Select value={newTemplate.category} onValueChange={v => setNewTemplate(p => ({ ...p, category: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TEMPLATE_CATEGORIES.map(c => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input placeholder="Subject line (use {{variable}} for placeholders)" value={newTemplate.subject} onChange={e => setNewTemplate(p => ({ ...p, subject: e.target.value }))} />
                  <Textarea placeholder="Email body (use {{variable}} for placeholders)" value={newTemplate.body} onChange={e => setNewTemplate(p => ({ ...p, body: e.target.value }))} className="min-h-[200px] text-xs font-mono" />
                  <p className="text-[10px] text-muted-foreground">
                    Tip: Use {'{{variable_name}}'} syntax for dynamic fields. They'll be auto-detected.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowAddTemplate(false)}>Cancel</Button>
                    <Button size="sm" onClick={handleAddTemplate}>Save Template</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Edit Template Dialog */}
            <Dialog open={!!editingTemplate} onOpenChange={open => !open && setEditingTemplate(null)}>
              <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Edit Template</DialogTitle>
                </DialogHeader>
                {editingTemplate && (
                  <div className="space-y-3">
                    <Input value={editingTemplate.name} onChange={e => setEditingTemplate(p => p ? { ...p, name: e.target.value } : null)} />
                    <Select value={editingTemplate.category} onValueChange={v => setEditingTemplate(p => p ? { ...p, category: v } : null)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TEMPLATE_CATEGORIES.map(c => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input value={editingTemplate.subject} onChange={e => setEditingTemplate(p => p ? { ...p, subject: e.target.value } : null)} />
                    <Textarea value={editingTemplate.body} onChange={e => setEditingTemplate(p => p ? { ...p, body: e.target.value } : null)} className="min-h-[200px] text-xs font-mono" />
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditingTemplate(null)}>Cancel</Button>
                      <Button size="sm" onClick={handleUpdateTemplate}>Save Changes</Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* MY PROMPTS TAB */}
          <TabsContent value="prompts" className="space-y-3 mt-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Custom Prompts</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                <p>Save your own reusable AI prompts here. Coming soon — for now, use the AI Prep tab or speak to the mic to run any custom prompt.</p>
                <div className="mt-3 flex items-center gap-2">
                  <VoiceCommandButton />
                  <span className="text-xs text-muted-foreground">Tap the mic and say what you need</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
