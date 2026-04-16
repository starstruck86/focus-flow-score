import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Plus, X, FileText, Zap } from 'lucide-react';
import type { TaskInputs } from '@/hooks/strategy/useTaskExecution';

interface Participant {
  name: string;
  title: string;
  role: string;
  side: 'internal' | 'prospect';
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (inputs: TaskInputs) => void;
  isRunning: boolean;
  linkedContext?: any;
}

const TEMPLATE_SECTIONS = [
  'Page-1 Cockpit', 'Cover & Key Info', 'Participants', 'Executive Snapshot',
  'Value Selling Framework', 'Discovery-1 Questions', 'Customer Examples',
  'Pivot Statements', 'Objection Handling', 'Exit Criteria & MEDDPICC',
  'Revenue Pathway & Sensitivity', 'Metrics Intelligence', 'Loyalty Analysis',
  'Tech Stack & Consolidation', 'Competitive War Game', 'Hypotheses & Risks',
  'APPENDIX: Deep Research',
];

export function DiscoveryPrepPrompter({ open, onOpenChange, onSubmit, isRunning, linkedContext }: Props) {
  const [companyName, setCompanyName] = useState('');
  const [repName, setRepName] = useState('Corey');
  const [website, setWebsite] = useState('');
  const [opportunity, setOpportunity] = useState('');
  const [stage, setStage] = useState('');
  const [priorNotes, setPriorNotes] = useState('');
  const [scale, setScale] = useState('');
  const [desiredNextStep, setDesiredNextStep] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([
    { name: '', title: '', role: '', side: 'prospect' },
  ]);

  useEffect(() => {
    if (open && linkedContext?.account?.name) setCompanyName(linkedContext.account.name);
    if (open && linkedContext?.opportunity?.name) setOpportunity(linkedContext.opportunity.name);
    if (open && linkedContext?.account?.website) setWebsite(linkedContext.account.website);
  }, [open, linkedContext]);

  const addParticipant = (side: 'internal' | 'prospect') => {
    setParticipants(prev => [...prev, { name: '', title: '', role: '', side }]);
  };

  const updateParticipant = (idx: number, field: keyof Participant, value: string) => {
    setParticipants(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const removeParticipant = (idx: number) => {
    setParticipants(prev => prev.filter((_, i) => i !== idx));
  };

  const canSubmit = companyName.trim() && participants.some(p => p.name.trim());

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      company_name: companyName.trim(),
      rep_name: repName.trim() || undefined,
      website: website.trim() || undefined,
      participants: participants.filter(p => p.name.trim()),
      opportunity: opportunity.trim() || undefined,
      stage: stage.trim() || undefined,
      prior_notes: priorNotes.trim() || undefined,
      scale: scale.trim() || undefined,
      desired_next_step: desiredNextStep.trim() || undefined,
    });
  };

  const prospectParticipants = participants.filter(p => p.side === 'prospect');
  const internalParticipants = participants.filter(p => p.side === 'internal');

  return (
    <Dialog open={open} onOpenChange={v => { if (!isRunning) onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[85vh] p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/10">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base">Discovery Prep</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                Full research → synthesis → meeting-ready .docx &amp; PDF
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[55vh]">
          <div className="px-5 py-4 space-y-4">
            {/* Required */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">
                    Company Name <span className="text-destructive">*</span>
                  </Label>
                  <Input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Acme Corp" autoFocus />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Website URL</Label>
                  <Input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..." />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Rep Name</Label>
                <Input value={repName} onChange={e => setRepName(e.target.value)} placeholder="Your name" />
              </div>

              {/* Prospect Participants */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">
                    Meeting Participants (Prospect) <span className="text-destructive">*</span>
                  </Label>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-primary" onClick={() => addParticipant('prospect')}>
                    <Plus className="h-3 w-3" /> Add
                  </Button>
                </div>
                {prospectParticipants.map((p) => {
                  const realIdx = participants.indexOf(p);
                  return (
                    <div key={realIdx} className="flex gap-1.5 items-start">
                      <Input className="flex-1 text-xs h-8" placeholder="Name" value={p.name} onChange={e => updateParticipant(realIdx, 'name', e.target.value)} />
                      <Input className="flex-1 text-xs h-8" placeholder="Title" value={p.title} onChange={e => updateParticipant(realIdx, 'title', e.target.value)} />
                      <Input className="w-24 text-xs h-8" placeholder="EB/Champ/Coach" value={p.role} onChange={e => updateParticipant(realIdx, 'role', e.target.value)} />
                      {prospectParticipants.length > 1 && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground" onClick={() => removeParticipant(realIdx)}>
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Internal */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-muted-foreground">Internal Team</Label>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground" onClick={() => addParticipant('internal')}>
                    <Plus className="h-3 w-3" /> Add
                  </Button>
                </div>
                {internalParticipants.map((p) => {
                  const realIdx = participants.indexOf(p);
                  return (
                    <div key={realIdx} className="flex gap-1.5 items-start">
                      <Input className="flex-1 text-xs h-8" placeholder="Name" value={p.name} onChange={e => updateParticipant(realIdx, 'name', e.target.value)} />
                      <Input className="flex-1 text-xs h-8" placeholder="Role in meeting" value={p.role} onChange={e => updateParticipant(realIdx, 'role', e.target.value)} />
                      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground" onClick={() => removeParticipant(realIdx)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Optional */}
            <div className="space-y-3 pt-2 border-t border-border/10">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Optional Context</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Opportunity</Label>
                  <Input className="text-xs h-8" value={opportunity} onChange={e => setOpportunity(e.target.value)} placeholder="Opp name or SFDC link" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Sales Stage</Label>
                  <Input className="text-xs h-8" value={stage} onChange={e => setStage(e.target.value)} placeholder="e.g. Discovery" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Platform Scale</Label>
                <Input className="text-xs h-8" value={scale} onChange={e => setScale(e.target.value)} placeholder="MAUs, email volume, channels..." />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Desired Next Step</Label>
                <Input className="text-xs h-8" value={desiredNextStep} onChange={e => setDesiredNextStep(e.target.value)} placeholder="e.g. Schedule technical deep dive" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Prior Notes</Label>
                <Textarea className="text-xs min-h-[60px] resize-none" value={priorNotes} onChange={e => setPriorNotes(e.target.value)} placeholder="Any context from previous interactions..." />
              </div>
            </div>

            {/* Template preview */}
            <div className="pt-2 border-t border-border/10">
              <div className="flex items-center gap-1.5 mb-2">
                <FileText className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Template: Mid-Market Discovery Prep</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {TEMPLATE_SECTIONS.map(s => (
                  <Badge key={s} variant="outline" className="text-[9px] font-normal text-muted-foreground border-border/20">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="px-5 py-3 border-t border-border/10">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isRunning}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit || isRunning} className="gap-1.5">
            {isRunning ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Researching & generating…</>
            ) : (
              <><Zap className="h-3.5 w-3.5" />Generate Prep Doc</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
