import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Sparkles, FileText, Mail, BarChart3, Presentation,
  Target, Loader2, Save, Copy, ChevronDown, X, Search
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';

const CONTENT_TYPES = [
  { value: 'business_case', label: 'Business Case', icon: BarChart3 },
  { value: 'roi_analysis', label: 'ROI Analysis', icon: Target },
  { value: 'executive_email', label: 'Executive Email', icon: Mail },
  { value: 'follow_up', label: 'Follow-up Email', icon: Mail },
  { value: 'qbr', label: 'QBR Deck', icon: Presentation },
  { value: 'proposal', label: 'Proposal', icon: FileText },
  { value: 'custom', label: 'Custom', icon: Sparkles },
];

export function ContentBuilder() {
  const { user } = useAuth();
  const accounts = useStore(s => s.accounts);
  const opportunities = useStore(s => s.opportunities);

  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedOpp, setSelectedOpp] = useState('');
  const [contentType, setContentType] = useState('executive_email');
  const [instructions, setInstructions] = useState('');
  const [selectedTranscripts, setSelectedTranscripts] = useState<string[]>([]);
  const [transcripts, setTranscripts] = useState<any[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Elapsed time tracker during generation
  useEffect(() => {
    if (generating) {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [generating]);

  // Load transcripts for selected account/opp
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      let query = supabase.from('call_transcripts').select('id, title, call_date, account_id, opportunity_id').eq('user_id', user.id).order('call_date', { ascending: false }).limit(20);
      if (selectedAccount) query = query.eq('account_id', selectedAccount);
      const { data } = await query;
      setTranscripts(data || []);
    };
    load();
  }, [user, selectedAccount]);

  // Listen for Dave context event
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { accountName, opportunityName, contentType: ct } = e.detail || {};
      if (accountName) {
        const acct = accounts.find(a => a.name.toLowerCase() === accountName.toLowerCase());
        if (acct) setSelectedAccount(acct.id);
      }
      if (ct) setContentType(ct);
    };
    window.addEventListener('dave-open-content-builder', handler as any);
    return () => window.removeEventListener('dave-open-content-builder', handler as any);
  }, [accounts]);

  const filteredOpps = opportunities.filter(o => !selectedAccount || o.accountId === selectedAccount);
  const accountName = accounts.find(a => a.id === selectedAccount)?.name || '';

  const handleGenerate = useCallback(async () => {
    if (!user) return;
    setGenerating(true);
    setGeneratedContent('');

    try {
      // Build context
      const account = accounts.find(a => a.id === selectedAccount);
      const opp = opportunities.find(o => o.id === selectedOpp);

      // Fetch methodology if opp selected
      let methodology: any = null;
      if (selectedOpp) {
        const { data } = await supabase.from('opportunity_methodology').select('*').eq('opportunity_id', selectedOpp).maybeSingle();
        methodology = data;
      }

      // Fetch selected transcripts content
      let transcriptContext = '';
      if (selectedTranscripts.length) {
        const { data } = await supabase.from('call_transcripts').select('title, content, call_date, summary').in('id', selectedTranscripts);
        if (data?.length) {
          transcriptContext = data.map(t => `--- ${t.title} (${t.call_date}) ---\n${t.summary || t.content?.slice(0, 3000) || '(empty)'}`).join('\n\n');
        }
      }

      // Fetch contacts for account
      let contacts: any[] = [];
      if (selectedAccount) {
        const { data } = await supabase.from('contacts').select('name, title, buyer_role, influence_level').eq('account_id', selectedAccount).eq('user_id', user.id);
        contacts = data || [];
      }

      const prompt = buildPrompt({
        contentType,
        instructions,
        account,
        opp,
        methodology,
        transcriptContext,
        contacts,
      });

      const response = await supabase.functions.invoke('build-resource', {
        body: {
          type: 'build-content',
          contentType,
          prompt,
          accountContext: account ? {
            name: account.name,
            industry: account.industry,
            contacts: contacts.map(c => `${c.name} (${c.title})`).join(', '),
            dealStage: opp?.stage,
          } : undefined,
        },
      });

      if (response.error) throw response.error;

      // Handle streaming response
      const reader = response.data;
      if (typeof reader === 'string') {
        setGeneratedContent(reader);
      } else if (reader?.error) {
        throw new Error(reader.error);
      } else {
        // Try to parse SSE from the response
        const text = typeof reader === 'object' ? JSON.stringify(reader) : String(reader);
        setGeneratedContent(text);
      }
    } catch (err: any) {
      toast.error(err.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }, [user, selectedAccount, selectedOpp, contentType, instructions, selectedTranscripts, accounts, opportunities]);

  const handleSave = useCallback(async () => {
    if (!user || !generatedContent) return;
    setSaving(true);
    try {
      const typeLabel = CONTENT_TYPES.find(t => t.value === contentType)?.label || 'Document';
      const title = `${typeLabel}${accountName ? ` — ${accountName}` : ''} (${new Date().toLocaleDateString()})`;
      const { error } = await supabase.from('resources').insert({
        user_id: user.id,
        title,
        content: generatedContent,
        resource_type: 'document',
        content_status: 'enriched',
        tags: ['ai-generated', contentType],
        account_id: selectedAccount || null,
        opportunity_id: selectedOpp || null,
      });
      if (error) throw error;
      toast.success('Saved to Resource Library');
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [user, generatedContent, contentType, accountName, selectedAccount, selectedOpp]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(generatedContent);
    toast.success('Copied to clipboard');
  }, [generatedContent]);

  const toggleTranscript = (id: string) => {
    setSelectedTranscripts(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 5 ? [...prev, id] : prev
    );
  };

  return (
    <div className="space-y-4">
      {/* Context Selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Account</label>
          <Select value={selectedAccount} onValueChange={setSelectedAccount}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Select account..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {accounts.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Opportunity</label>
          <Select value={selectedOpp} onValueChange={setSelectedOpp}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Select opportunity..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {filteredOpps.map(o => (
                <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Content Type</label>
          <Select value={contentType} onValueChange={setContentType}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTENT_TYPES.map(ct => (
                <SelectItem key={ct.value} value={ct.value}>
                  <span className="flex items-center gap-1.5">
                    <ct.icon className="h-3.5 w-3.5" />
                    {ct.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Transcript Selector */}
      {transcripts.length > 0 && (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Transcripts ({selectedTranscripts.length}/5)
          </label>
          <div className="flex flex-wrap gap-1.5">
            {transcripts.slice(0, 10).map(t => (
              <Badge
                key={t.id}
                variant={selectedTranscripts.includes(t.id) ? 'default' : 'outline'}
                className="cursor-pointer text-[10px]"
                onClick={() => toggleTranscript(t.id)}
              >
                {t.title || t.call_date}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Custom Instructions</label>
        <Textarea
          value={instructions}
          onChange={e => setInstructions(e.target.value)}
          placeholder="e.g. Focus on ROI metrics, keep tone consultative, include competitor comparison..."
          className="text-xs min-h-[60px]"
        />
      </div>

      {/* Generate Button */}
      <Button onClick={handleGenerate} disabled={generating} className="w-full">
        {generating ? (
          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating... ({elapsedSeconds}s)</>
        ) : (
          <><Sparkles className="h-4 w-4 mr-2" /> Generate Content</>
        )}
      </Button>

      {/* Generated Content */}
      {generatedContent && (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Generated Content</CardTitle>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={handleCopy}>
                <Copy className="h-3.5 w-3.5 mr-1" /> Copy
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                Save to Library
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[400px]">
              <div ref={contentRef} className="prose prose-sm dark:prose-invert max-w-none text-xs whitespace-pre-wrap">
                {generatedContent}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function buildPrompt(ctx: {
  contentType: string;
  instructions: string;
  account: any;
  opp: any;
  methodology: any;
  transcriptContext: string;
  contacts: any[];
}) {
  const parts: string[] = [];

  parts.push(`Generate a professional ${ctx.contentType.replace(/_/g, ' ')} document.`);

  if (ctx.account) {
    parts.push(`\n## Account Context\n- Name: ${ctx.account.name}\n- Industry: ${ctx.account.industry || 'N/A'}\n- Notes: ${ctx.account.notes?.slice(0, 500) || 'N/A'}`);
  }

  if (ctx.opp) {
    parts.push(`\n## Opportunity\n- Name: ${ctx.opp.name}\n- Stage: ${ctx.opp.stage || 'N/A'}\n- ARR: $${ctx.opp.arr?.toLocaleString() || 'N/A'}\n- Close Date: ${ctx.opp.closeDate || 'N/A'}\n- Next Step: ${ctx.opp.nextStep || 'N/A'}`);
  }

  if (ctx.methodology) {
    const gaps: string[] = [];
    if (!ctx.methodology.identify_pain_confirmed) gaps.push('Identify Pain');
    if (!ctx.methodology.champion_confirmed) gaps.push('Champion');
    if (!ctx.methodology.decision_criteria_confirmed) gaps.push('Decision Criteria');
    if (!ctx.methodology.decision_process_confirmed) gaps.push('Decision Process');
    if (!ctx.methodology.economic_buyer_confirmed) gaps.push('Economic Buyer');
    if (!ctx.methodology.metrics_confirmed) gaps.push('Metrics');
    if (!ctx.methodology.competition_confirmed) gaps.push('Competition');
    if (gaps.length) parts.push(`\n## MEDDICC Gaps: ${gaps.join(', ')}`);

    if (ctx.methodology.metrics_value_notes) parts.push(`Metrics/Value: ${ctx.methodology.metrics_value_notes}`);
    if (ctx.methodology.positive_business_outcomes_notes) parts.push(`PBOs: ${ctx.methodology.positive_business_outcomes_notes}`);
  }

  if (ctx.contacts.length) {
    parts.push(`\n## Key Contacts\n${ctx.contacts.map(c => `- ${c.name} (${c.title || 'N/A'}) — ${c.buyer_role || 'N/A'}, Influence: ${c.influence_level || 'N/A'}`).join('\n')}`);
  }

  if (ctx.transcriptContext) {
    parts.push(`\n## Recent Call Transcripts\n${ctx.transcriptContext}`);
  }

  if (ctx.instructions) {
    parts.push(`\n## Additional Instructions\n${ctx.instructions}`);
  }

  return parts.join('\n');
}
