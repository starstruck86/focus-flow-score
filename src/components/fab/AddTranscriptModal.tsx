import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { FileText, Target, Check, ChevronsUpDown, Copy, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AddTranscriptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillOpportunityId?: string;
}

interface Transcript {
  id: string;
  opportunityId: string;
  content: string;
  date: string;
  participants?: string;
  callType?: string;
  tags?: string[];
  notes?: string;
  createdAt: string;
}

const CALL_TYPES = [
  'Discovery Call',
  'Demo',
  'Technical Review',
  'Executive Meeting',
  'Pricing Discussion',
  'Contract Review',
  'Follow-up',
  'Other',
];

export function AddTranscriptModal({
  open,
  onOpenChange,
  prefillOpportunityId,
}: AddTranscriptModalProps) {
  const { opportunities, updateOpportunity } = useStore();
  
  const [oppSelectOpen, setOppSelectOpen] = useState(false);
  const [selectedOppId, setSelectedOppId] = useState<string>('');
  const [transcript, setTranscript] = useState('');
  const [transcriptDate, setTranscriptDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [participants, setParticipants] = useState('');
  const [callType, setCallType] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  
  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setSelectedOppId(prefillOpportunityId || '');
      setTranscript('');
      setTranscriptDate(format(new Date(), 'yyyy-MM-dd'));
      setParticipants('');
      setCallType('');
      setTags('');
      setNotes('');
    }
  }, [open, prefillOpportunityId]);
  
  const selectedOpp = useMemo(() => 
    opportunities.find(o => o.id === selectedOppId),
    [opportunities, selectedOppId]
  );
  
  const handleCopyTranscript = () => {
    navigator.clipboard.writeText(transcript);
    toast.success('Transcript copied to clipboard');
  };
  
  const handleCopySummaryStarter = () => {
    const oppName = selectedOpp?.name || 'Opportunity';
    const starter = `## ${oppName} - Call Summary (${transcriptDate})

**Participants:** ${participants || 'TBD'}
**Call Type:** ${callType || 'N/A'}

### Key Points:
- 

### Next Steps:
- 

### Notes:
${notes || ''}

---
*Full transcript attached*`;
    
    navigator.clipboard.writeText(starter);
    toast.success('Summary starter copied to clipboard');
  };
  
  const handleSave = () => {
    if (!selectedOppId) {
      toast.error('Please select an opportunity');
      return;
    }
    
    if (!transcript.trim()) {
      toast.error('Please paste or enter a transcript');
      return;
    }
    
    // In a real app, you'd store transcripts in a dedicated table
    // For now, we'll add it to the opportunity's notes or a custom field
    const transcriptEntry: Transcript = {
      id: Math.random().toString(36).substring(2, 15),
      opportunityId: selectedOppId,
      content: transcript.trim(),
      date: transcriptDate,
      participants: participants.trim() || undefined,
      callType: callType || undefined,
      tags: tags.trim() ? tags.split(',').map(t => t.trim()) : undefined,
      notes: notes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    
    // Append to opportunity notes (or could be a separate transcripts array)
    const currentNotes = selectedOpp?.notes || '';
    const transcriptNote = `\n\n---\n📝 Transcript (${transcriptDate})\nParticipants: ${participants || 'N/A'}\nType: ${callType || 'N/A'}\n\n${transcript.substring(0, 500)}${transcript.length > 500 ? '...' : ''}`;
    
    updateOpportunity(selectedOppId, {
      notes: currentNotes + transcriptNote,
      lastTouchDate: format(new Date(), 'yyyy-MM-dd'),
    });
    
    toast.success('Transcript saved', {
      description: `Added to ${selectedOpp?.name}`,
    });
    
    onOpenChange(false);
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Add Transcript
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Opportunity Selector */}
          <div className="space-y-2">
            <Label>Link to Opportunity *</Label>
            <Popover open={oppSelectOpen} onOpenChange={setOppSelectOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={oppSelectOpen}
                  className="w-full justify-between"
                >
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
                        <CommandItem
                          key={opp.id}
                          value={opp.name}
                          onSelect={() => {
                            setSelectedOppId(opp.id);
                            setOppSelectOpen(false);
                          }}
                        >
                          <Target className="h-4 w-4 mr-2 text-muted-foreground" />
                          <span className="truncate">{opp.name}</span>
                          {opp.accountName && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({opp.accountName})
                            </span>
                          )}
                          <Check
                            className={cn(
                              "ml-auto h-4 w-4",
                              selectedOppId === opp.id ? "opacity-100" : "opacity-0"
                            )}
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          
          {/* Transcript Textarea (Paste-first) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Transcript *</Label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={handleCopyTranscript}
                  disabled={!transcript.trim()}
                >
                  <Copy className="h-3 w-3" />
                  Copy
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={handleCopySummaryStarter}
                  disabled={!transcript.trim()}
                >
                  <Copy className="h-3 w-3" />
                  Summary Starter
                </Button>
              </div>
            </div>
            <Textarea
              placeholder="Paste your transcript here..."
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={8}
              className="font-mono text-sm"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Paste from Zoom, Teams, Gong, or any transcription service
            </p>
          </div>
          
          {/* Date & Call Type Row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={transcriptDate}
                onChange={(e) => setTranscriptDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Call Type</Label>
              <Select value={callType} onValueChange={setCallType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  {CALL_TYPES.map(type => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {/* Participants */}
          <div className="space-y-2">
            <Label>Participants</Label>
            <Input
              placeholder="e.g., John Smith (VP Sales), Jane Doe (CTO)"
              value={participants}
              onChange={(e) => setParticipants(e.target.value)}
            />
          </div>
          
          {/* Tags */}
          <div className="space-y-2">
            <Label>Tags</Label>
            <Input
              placeholder="e.g., pricing, objection-handling, technical"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Comma-separated</p>
          </div>
          
          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              placeholder="Quick notes about this call..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} className="gap-2">
            <FileText className="h-4 w-4" />
            Save Transcript
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
