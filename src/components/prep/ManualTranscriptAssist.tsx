/**
 * Manual Transcript Assist Dialog
 * Allows operator to paste/upload transcript or notes for audio resources
 * that cannot be automatically transcribed.
 */

import { memo, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileAudio, Upload, FileText, Bookmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getAudioJobForResource,
  getAudioStageLabel,
  getAudioFailureDescription,
  type AudioJobState,
  type AudioFailureCode,
} from '@/lib/salesBrain/audioPipeline';
import {
  detectAudioSubtype,
  getAudioStrategy,
} from '@/lib/salesBrain/audioPipeline';

type ManualAssistMode = 'paste_transcript' | 'paste_notes' | 'metadata_only' | 'park_later';

interface ManualTranscriptAssistProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceId: string;
  resourceTitle: string;
  resourceUrl: string | null;
  onSubmit: (data: { mode: ManualAssistMode; content: string }) => void;
}

export const ManualTranscriptAssist = memo(function ManualTranscriptAssist({
  open,
  onOpenChange,
  resourceId,
  resourceTitle,
  resourceUrl,
  onSubmit,
}: ManualTranscriptAssistProps) {
  const [mode, setMode] = useState<ManualAssistMode>('paste_transcript');
  const [content, setContent] = useState('');
  const audioJob = getAudioJobForResource(resourceId);
  const subtype = detectAudioSubtype(resourceUrl);
  const strategy = getAudioStrategy(subtype);

  const handleSubmit = useCallback(() => {
    if (mode === 'park_later') {
      onSubmit({ mode, content: '' });
    } else if (content.trim()) {
      onSubmit({ mode, content: content.trim() });
    }
    onOpenChange(false);
    setContent('');
  }, [mode, content, onSubmit, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileAudio className="h-4 w-4 text-primary" />
            Manual Assist — Audio Resource
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-foreground truncate">{resourceTitle}</p>
            {resourceUrl && (
              <p className="text-[10px] text-muted-foreground truncate">{resourceUrl}</p>
            )}
          </div>

          {/* Status */}
          {audioJob && (
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[9px]">
                {getAudioStageLabel(audioJob.stage)}
              </Badge>
              {audioJob.failureCode && (
                <Badge variant="destructive" className="text-[9px]">
                  {audioJob.failureCode}
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground">
                {audioJob.attemptsCount} attempt{audioJob.attemptsCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}

          {audioJob?.failureReason && (
            <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
              {audioJob.failureReason}
              {audioJob.failureCode && (
                <span className="block text-[10px] mt-0.5">
                  → {getAudioFailureDescription(audioJob.failureCode).nextAction}
                </span>
              )}
            </p>
          )}

          {/* Mode */}
          <div className="space-y-1">
            <Label className="text-xs">What do you have?</Label>
            <Select value={mode} onValueChange={v => setMode(v as ManualAssistMode)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="paste_transcript">
                  <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> Paste transcript</span>
                </SelectItem>
                <SelectItem value="paste_notes">
                  <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> Paste notes / summary</span>
                </SelectItem>
                <SelectItem value="metadata_only">
                  <span className="flex items-center gap-1"><Bookmark className="h-3 w-3" /> Mark metadata-only</span>
                </SelectItem>
                <SelectItem value="park_later">
                  <span className="flex items-center gap-1"><Bookmark className="h-3 w-3" /> Park for later</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Content input */}
          {mode !== 'park_later' && mode !== 'metadata_only' && (
            <div className="space-y-1">
              <Label className="text-xs">
                {mode === 'paste_transcript' ? 'Paste transcript' : 'Paste notes / summary'}
              </Label>
              <Textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder={mode === 'paste_transcript'
                  ? 'Paste the full transcript here...'
                  : 'Paste key notes, takeaways, or summary...'}
                className="text-xs min-h-[120px]"
              />
              {content && (
                <p className="text-[10px] text-muted-foreground">
                  {content.split(/\s+/).filter(Boolean).length} words
                </p>
              )}
            </div>
          )}

          {mode === 'metadata_only' && (
            <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
              This resource will be marked as metadata-only. It can still contribute to the Sales Brain
              with limited insight extraction based on title and available metadata.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={mode !== 'park_later' && mode !== 'metadata_only' && !content.trim()}
          >
            {mode === 'park_later' ? 'Park' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
