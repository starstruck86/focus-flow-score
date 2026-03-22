import { useState, useCallback, useRef } from 'react';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Camera, Upload, X, Loader2, Users, Baby, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ExtractedEvent {
  title: string;
  start_time: string;
  end_time: string;
  category: 'work_meeting' | 'personal' | 'all_day';
  is_personal_block: boolean;
  family_member?: string;
  notes?: string;
  confirmed: boolean;
}

interface CalendarScreenshotDropProps {
  date: string;
  onEventsConfirmed: (events: ExtractedEvent[]) => void;
}

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${m.toString().padStart(2, '0')} ${suffix}`;
}

export function CalendarScreenshotDrop({ date, onEventsConfirmed }: CalendarScreenshotDropProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [extractedEvents, setExtractedEvents] = useState<ExtractedEvent[] | null>(null);
  const [confidence, setConfidence] = useState<string>('');
  const [dateDetected, setDateDetected] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processImage = useCallback(async (file: File) => {
    setIsParsing(true);
    try {
      // Convert to base64
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          // Strip the data URL prefix
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const { data, error } = await trackedInvoke<{ events?: Partial<ExtractedEvent>[]; confidence?: string; date_detected?: string }>('parse-calendar-screenshot', {
        body: { imageBase64: base64, date },
      });

      if (error) throw error;

      const events = (data.events || []).map((e: any) => ({
        ...e,
        confirmed: true, // all confirmed by default
      }));

      setExtractedEvents(events);
      setConfidence(data.confidence || 'medium');
      setDateDetected(data.date_detected || date);

      const personalCount = events.filter((e: ExtractedEvent) => e.is_personal_block).length;
      const workCount = events.filter((e: ExtractedEvent) => e.category === 'work_meeting').length;

      toast.success(`Found ${workCount} meetings + ${personalCount} personal blocks`);
    } catch (err) {
      console.error('Calendar screenshot parse error:', err);
      toast.error('Failed to parse calendar screenshot');
    } finally {
      setIsParsing(false);
    }
  }, [date]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      processImage(file);
    } else {
      toast.error('Please drop an image file');
    }
  }, [processImage]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImage(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  }, [processImage]);

  const toggleEvent = useCallback((idx: number) => {
    setExtractedEvents(prev => {
      if (!prev) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], confirmed: !next[idx].confirmed };
      return next;
    });
  }, []);

  const confirmEvents = useCallback(() => {
    if (!extractedEvents) return;
    const confirmed = extractedEvents.filter(e => e.confirmed);
    onEventsConfirmed(confirmed);
    setExtractedEvents(null);
    toast.success(`Confirmed ${confirmed.length} events — rebuilding plan`);
  }, [extractedEvents, onEventsConfirmed]);

  // Parsing state
  if (isParsing) {
    return (
      <div className="px-4 py-4 border-b border-border/30 bg-primary/5">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 text-primary animate-spin" />
          <div>
            <p className="text-sm font-medium">Reading your calendar…</p>
            <p className="text-[11px] text-muted-foreground">Extracting meetings & personal commitments</p>
          </div>
        </div>
      </div>
    );
  }

  // Confirmation state
  if (extractedEvents) {
    const workEvents = extractedEvents.filter(e => e.category === 'work_meeting');
    const personalEvents = extractedEvents.filter(e => e.is_personal_block);
    const allDayEvents = extractedEvents.filter(e => e.category === 'all_day' && !e.is_personal_block);
    const dateMatch = dateDetected === date;

    return (
      <div className="border-b border-border/30">
        <div className="px-4 py-3 bg-accent/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium">Calendar Snapshot</span>
            {!dateMatch && (
              <Badge variant="outline" className="text-[10px] h-5 text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Screenshot shows {dateDetected}
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] h-5">
              {confidence} confidence
            </Badge>
          </div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setExtractedEvents(null)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="px-4 py-2 space-y-1 max-h-60 overflow-y-auto">
          {/* Work meetings */}
          {workEvents.length > 0 && (
            <div className="mb-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Meetings ({workEvents.length})
              </p>
              {workEvents.map((evt, idx) => {
                const realIdx = extractedEvents.indexOf(evt);
                return (
                  <label
                    key={realIdx}
                    className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={evt.confirmed}
                      onCheckedChange={() => toggleEvent(realIdx)}
                      className="h-3.5 w-3.5"
                    />
                    <Users className="h-3 w-3 text-primary shrink-0" />
                    <span className="text-xs flex-1 truncate">{evt.title}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {formatTime(evt.start_time)}–{formatTime(evt.end_time)}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {/* Personal blocks */}
          {personalEvents.length > 0 && (
            <div className="mb-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Personal / Family ({personalEvents.length})
              </p>
              {personalEvents.map((evt, idx) => {
                const realIdx = extractedEvents.indexOf(evt);
                return (
                  <label
                    key={realIdx}
                    className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={evt.confirmed}
                      onCheckedChange={() => toggleEvent(realIdx)}
                      className="h-3.5 w-3.5"
                    />
                    <Baby className="h-3 w-3 text-amber-500 shrink-0" />
                    <span className="text-xs flex-1 truncate">
                      {evt.title}
                      {evt.family_member && (
                        <span className="text-muted-foreground ml-1">({evt.family_member})</span>
                      )}
                    </span>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {formatTime(evt.start_time)}–{formatTime(evt.end_time)}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {/* All-day events */}
          {allDayEvents.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                All Day
              </p>
              {allDayEvents.map((evt) => {
                const realIdx = extractedEvents.indexOf(evt);
                return (
                  <label
                    key={realIdx}
                    className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={evt.confirmed}
                      onCheckedChange={() => toggleEvent(realIdx)}
                      className="h-3.5 w-3.5"
                    />
                    <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-xs flex-1 truncate">{evt.title}</span>
                    <span className="text-[11px] text-muted-foreground">All Day</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2.5 bg-muted/20 border-t border-border/30 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {extractedEvents.filter(e => e.confirmed).length} of {extractedEvents.length} selected
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExtractedEvents(null)}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 text-xs gap-1" onClick={confirmEvents}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Confirm & Rebuild Plan
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Drop zone (compact)
  return (
    <div
      className={cn(
        "px-4 py-3 border-b border-border/30 transition-colors cursor-pointer",
        isDragOver ? "bg-primary/10 border-primary/30" : "bg-muted/10 hover:bg-muted/20"
      )}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      <div className="flex items-center gap-3">
        <div className={cn(
          "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
          isDragOver ? "bg-primary/20" : "bg-muted/50"
        )}>
          <Camera className={cn("h-4 w-4", isDragOver ? "text-primary" : "text-muted-foreground")} />
        </div>
        <div className="flex-1">
          <p className="text-xs font-medium text-muted-foreground">
            {isDragOver ? 'Drop calendar screenshot' : 'Drop or click to upload calendar screenshot'}
          </p>
          <p className="text-[10px] text-muted-foreground/60">
            Confirms meetings + blocks personal time (Quinn & Emmett)
          </p>
        </div>
        <Upload className="h-3.5 w-3.5 text-muted-foreground/40" />
      </div>
    </div>
  );
}
