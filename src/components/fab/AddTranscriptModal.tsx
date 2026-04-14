import { useState, useEffect, useMemo } from 'react';
import { trackedInvoke } from '@/lib/trackedInvoke';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useStore } from '@/store/useStore';
import { useSaveTranscript } from '@/hooks/useCallTranscripts';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { FileText, Target, Check, ChevronsUpDown, Copy, RefreshCw, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AddTranscriptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillOpportunityId?: string;
  prefillAccountId?: string;
  prefillRenewalId?: string;
}

const CALL_TYPES = [
  'Cold Call', 'Discovery Call', 'Demo', 'Technical Review', 'Executive Meeting',
  'Pricing Discussion', 'Contract Review', 'Renewal Check-in',
  'QBR', 'Follow-up', 'Other',
];

export function AddTranscriptModal({
  open, onOpenChange, prefillOpportunityId, prefillAccountId, prefillRenewalId,
}: AddTranscriptModalProps) {
  const { opportunities, renewals, accounts } = useStore();
  const saveTranscript = useSaveTranscript();

  const [linkType, setLinkType] = useState<'opportunity' | 'renewal'>('opportunity');
  const [oppSelectOpen, setOppSelectOpen] = useState(false);
  const [renewalSelectOpen, setRenewalSelectOpen] = useState(false);
  const [selectedOppId, setSelectedOppId] = useState('');
  const [selectedRenewalId, setSelectedRenewalId] = useState('');
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [transcriptDate, setTranscriptDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [participants, setParticipants] = useState('');
  const [callType, setCallType] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [summary, setSummary] = useState('');
  const [duration, setDuration] = useState('');

  useEffect(() => {
    if (open) {
      setSelectedOppId(prefillOpportunityId || '');
      setSelectedRenewalId(prefillRenewalId || '');
      setLinkType(prefillRenewalId ? 'renewal' : 'opportunity');
      setTitle('');
      setTranscript('');
      setTranscriptDate(format(new Date(), 'yyyy-MM-dd'));
      setParticipants('');
      setCallType('');
      setTags('');
      setNotes('');
      setSummary('');
      setDuration('');
    }
  }, [open, prefillOpportunityId, prefillRenewalId]);

  const selectedOpp = useMemo(() => opportunities.find(o => o.id === selectedOppId), [opportunities, selectedOppId]);
  const selectedRenewal = useMemo(() => renewals.find(r => r.id === selectedRenewalId), [renewals, selectedRenewalId]);

  // Derive account_id from linked record
  const derivedAccountId = useMemo(() => {
    if (prefillAccountId) return prefillAccountId;
    if (linkType === 'opportunity' && selectedOpp?.accountId) return selectedOpp.accountId;
    if (linkType === 'renewal' && selectedRenewal) {
      const acc = accounts.find(a => a.name === selectedRenewal.accountName);
      return acc?.id;
    }
    return undefined;
  }, [linkType, selectedOpp, selectedRenewal, accounts, prefillAccountId]);

  const handleSave = async () => {
    if (linkType === 'opportunity' && !selectedOppId) {
      toast.error('Please select an opportunity');
      return;
    }
    if (linkType === 'renewal' && !selectedRenewalId) {
      toast.error('Please select a renewal');
      return;
    }
    if (!transcript.trim()) {
      toast.error('Please paste or enter a transcript');
      return;
    }

    const autoTitle = title.trim() || `${callType || 'Call'} - ${linkType === 'opportunity' ? selectedOpp?.name : selectedRenewal?.accountName} (${transcriptDate})`;

    try {
      await saveTranscript.mutateAsync({
        title: autoTitle,
        content: transcript.trim(),
        summary: summary.trim() || undefined,
        call_date: transcriptDate,
        call_type: callType || undefined,
        participants: participants.trim() || undefined,
        tags: tags.trim() ? tags.split(',').map(t => t.trim()) : undefined,
        notes: notes.trim() || undefined,
        opportunity_id: linkType === 'opportunity' ? selectedOppId : undefined,
        renewal_id: linkType === 'renewal' ? selectedRenewalId : undefined,
        account_id: derivedAccountId,
        duration_minutes: duration ? parseInt(duration) : undefined,
      });
      toast.success('Transcript saved to database');
      
      // Auto-extract tasks from transcript
      if (autoExtractTasks) {
        extractTasksFromTranscript(autoTitle);
      }
      
      onOpenChange(false);
    } catch (err: any) {
      toast.error('Failed to save transcript', { description: err.message });
    }
  };

  const [autoExtractTasks, setAutoExtractTasks] = useState(true);
  const [extractedTasks, setExtractedTasks] = useState<any[]>([]);
  const [extracting, setExtracting] = useState(false);

  const extractTasksFromTranscript = async (transcriptTitle: string) => {
    setExtracting(true);
    try {
      const { data, error } = await trackedInvoke<any>('extract-tasks', {
        body: {
          transcript_content: transcript.trim(),
          transcript_title: transcriptTitle,
          account_id: derivedAccountId,
          opportunity_id: linkType === 'opportunity' ? selectedOppId : undefined,
          renewal_id: linkType === 'renewal' ? selectedRenewalId : undefined,
        },
      });
      if (error) throw error;
      if (data?.tasks?.length > 0) {
        const { addTask } = useStore.getState();
        data.tasks.forEach((t: any) => {
          addTask({
            title: t.title,
            priority: t.priority || 'P2',
            status: 'next' as const,
            dueDate: t.due_date,
            notes: t.notes ? `[From transcript] ${t.notes}` : '[Auto-extracted from call transcript]',
            category: t.category || 'call',
            motion: linkType === 'renewal' ? 'renewal' as const : 'new-logo' as const,
            workstream: linkType === 'renewal' ? 'renewals' as const : 'pg' as const,
            linkedRecordType: linkType === 'opportunity' ? 'opportunity' as const : 'renewal' as const,
            linkedRecordId: linkType === 'opportunity' ? selectedOppId : selectedRenewalId,
            linkedAccountId: derivedAccountId,
          } as any);
        });
        toast.success(`${data.tasks.length} tasks auto-created from transcript`, {
          description: 'Check your Tasks page to review them',
        });
      } else {
        toast.info('No action items found in transcript');
      }
    } catch (err: any) {
      toast.error('Could not extract tasks', { description: err.message });
    } finally {
      setExtracting(false);
    }
  };

  const handleCopySummaryStarter = () => {
    const name = linkType === 'opportunity' ? selectedOpp?.name : selectedRenewal?.accountName;
    const starter = `## ${name || 'Call'} - Summary (${transcriptDate})\n\n**Participants:** ${participants || 'TBD'}\n**Call Type:** ${callType || 'N/A'}\n\n### Key Points:\n- \n\n### Next Steps:\n- \n\n### Action Items:\n- `;
    navigator.clipboard.writeText(starter);
    toast.success('Summary starter copied');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Add Call Transcript
          </DialogTitle>
          <p className="text-sm text-muted-foreground">Paste a call transcript to save it to your records.</p>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Link Type Tabs */}
          <Tabs value={linkType} onValueChange={v => setLinkType(v as any)}>
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="opportunity">New Logo Opp</TabsTrigger>
              <TabsTrigger value="renewal">Renewal</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Opportunity Selector */}
          {linkType === 'opportunity' && (
            <div className="space-y-2">
              <Label>Link to Opportunity *</Label>
              <Popover open={oppSelectOpen} onOpenChange={setOppSelectOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between">
                    {selectedOpp ? (
                      <span className="flex items-center gap-2 truncate">
                        <Target className="h-4 w-4 text-muted-foreground" />
                        {selectedOpp.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Select opportunity...</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[350px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search opportunities..." />
                    <CommandList>
                      <CommandEmpty>No opportunities found.</CommandEmpty>
                      <CommandGroup>
                        {opportunities.map(opp => (
                          <CommandItem key={opp.id} value={opp.name} onSelect={() => { setSelectedOppId(opp.id); setOppSelectOpen(false); }}>
                            <Target className="h-4 w-4 mr-2 text-muted-foreground" />
                            <span className="truncate">{opp.name}</span>
                            {opp.accountName && <span className="ml-1 text-xs text-muted-foreground">({opp.accountName})</span>}
                            <Check className={cn("ml-auto h-4 w-4", selectedOppId === opp.id ? "opacity-100" : "opacity-0")} />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Renewal Selector */}
          {linkType === 'renewal' && (
            <div className="space-y-2">
              <Label>Link to Renewal *</Label>
              <Popover open={renewalSelectOpen} onOpenChange={setRenewalSelectOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between">
                    {selectedRenewal ? (
                      <span className="flex items-center gap-2 truncate">
                        <RefreshCw className="h-4 w-4 text-muted-foreground" />
                        {selectedRenewal.accountName}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Select renewal...</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[350px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search renewals..." />
                    <CommandList>
                      <CommandEmpty>No renewals found.</CommandEmpty>
                      <CommandGroup>
                        {renewals.map(r => (
                          <CommandItem key={r.id} value={r.accountName} onSelect={() => { setSelectedRenewalId(r.id); setRenewalSelectOpen(false); }}>
                            <RefreshCw className="h-4 w-4 mr-2 text-muted-foreground" />
                            <span className="truncate">{r.accountName}</span>
                            <span className="ml-1 text-xs text-muted-foreground">${(r.arr / 1000).toFixed(0)}k</span>
                            <Check className={cn("ml-auto h-4 w-4", selectedRenewalId === r.id ? "opacity-100" : "opacity-0")} />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Title */}
          <div className="space-y-2">
            <Label>Title <span className="text-muted-foreground text-xs">(auto-generated if blank)</span></Label>
            <Input placeholder="e.g., Discovery Call - Acme Corp" value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          {/* Transcript */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Transcript *</Label>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleCopySummaryStarter} disabled={!transcript.trim()}>
                <Copy className="h-3 w-3" /> Summary Starter
              </Button>
            </div>
            <Textarea placeholder="Paste your transcript here..." value={transcript} onChange={e => setTranscript(e.target.value)} rows={8} className="font-mono text-sm" autoFocus />
            <div className="flex items-center gap-2 mt-1">
              <Checkbox id="auto-extract" checked={autoExtractTasks} onCheckedChange={(v) => setAutoExtractTasks(!!v)} />
              <label htmlFor="auto-extract" className="text-xs text-muted-foreground flex items-center gap-1 cursor-pointer">
                <Sparkles className="h-3 w-3 text-primary" /> Auto-extract action items as tasks
              </label>
              {extracting && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
            </div>
          </div>

          {/* Summary */}
          <div className="space-y-2">
            <Label>Summary <span className="text-muted-foreground text-xs">(for quick reference)</span></Label>
            <Textarea placeholder="Key takeaways, decisions made, next steps..." value={summary} onChange={e => setSummary(e.target.value)} rows={3} />
          </div>

          {/* Date, Call Type, Duration */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={transcriptDate} onChange={e => setTranscriptDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Call Type</Label>
              <Select value={callType} onValueChange={setCallType}>
                <SelectTrigger><SelectValue placeholder="Type..." /></SelectTrigger>
                <SelectContent>
                  {CALL_TYPES.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Duration (min)</Label>
              <Input type="number" placeholder="30" value={duration} onChange={e => setDuration(e.target.value)} />
            </div>
          </div>

          {/* Participants */}
          <div className="space-y-2">
            <Label>Participants</Label>
            <Input placeholder="e.g., John Smith (VP Sales), Jane Doe (CTO)" value={participants} onChange={e => setParticipants(e.target.value)} />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Tags</Label>
            <Input placeholder="e.g., pricing, objection-handling, technical" value={tags} onChange={e => setTags(e.target.value)} />
            <p className="text-xs text-muted-foreground">Comma-separated</p>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea placeholder="Quick notes about this call..." value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saveTranscript.isPending} className="gap-2">
            <FileText className="h-4 w-4" />
            {saveTranscript.isPending ? 'Saving...' : 'Save Transcript'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
