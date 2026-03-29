/**
 * ZoomAssistPanel — guided browser-session capture for Zoom recordings.
 *
 * Provides:
 *  1. "Capture from Browser Session" — opens Zoom URL, listens for postMessage
 *  2. Manual JSON paste fallback
 *  3. Progress indicators per strategy
 *  4. Result display with provenance
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Monitor, Copy, ExternalLink, CheckCircle2, XCircle, Loader2,
  AlertTriangle, Clipboard, ChevronDown, ChevronUp, Play,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  generateCaptureScript,
  processZoomCapture,
  parseCaptureJson,
  type ZoomCaptureResult,
  type ZoomSessionState,
} from '@/lib/zoomSessionCapture';

interface Props {
  resourceId: string;
  userId: string;
  resourceUrl: string;
  resourceTitle: string;
  onCaptureComplete: () => void;
}

const STRATEGY_LABELS: Record<string, string> = {
  transcript_tab: 'Transcript tab',
  caption_endpoint: 'Caption/VTT endpoint',
  media_url: 'Media URL (mp4)',
  runtime_config: 'Player runtime config',
  page_metadata: 'Page metadata',
  runtime_caption: 'Runtime caption URL',
  runtime_media: 'Runtime media URL',
};

export function ZoomAssistPanel({ resourceId, userId, resourceUrl, resourceTitle, onCaptureComplete }: Props) {
  const [state, setState] = useState<ZoomSessionState>('idle');
  const [captureResult, setCaptureResult] = useState<ZoomCaptureResult | null>(null);
  const [processResult, setProcessResult] = useState<{ success: boolean; message: string; contentLength: number } | null>(null);
  const [showScript, setShowScript] = useState(false);
  const [manualJson, setManualJson] = useState('');
  const [showManualPaste, setShowManualPaste] = useState(false);
  const popupRef = useRef<Window | null>(null);

  const origin = window.location.origin;

  // Listen for postMessage from the Zoom tab
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type !== 'ZOOM_CAPTURE_RESULT') return;
      const payload = event.data.payload as ZoomCaptureResult;
      setCaptureResult(payload);
      setState('processing');
      // Process the capture
      processZoomCapture(resourceId, userId, payload).then(result => {
        setProcessResult(result);
        setState(result.success ? 'succeeded' : 'failed');
        if (result.success) {
          toast.success(result.message);
          onCaptureComplete();
        } else {
          toast.info(result.message);
        }
      });
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [resourceId, userId, onCaptureComplete]);

  const handleOpenCapture = useCallback(() => {
    setState('waiting_for_capture');
    // Open the Zoom recording in a new window
    popupRef.current = window.open(resourceUrl, '_blank', 'noopener=false');
    toast.info('Zoom recording opened. Run the capture script on that page.');
  }, [resourceUrl]);

  const handleCopyScript = useCallback(() => {
    const script = generateCaptureScript(origin);
    navigator.clipboard.writeText(script).then(() => {
      toast.success('Capture script copied! Paste it into the browser console on the Zoom page.');
    });
  }, [origin]);

  const handleManualJsonSubmit = useCallback(async () => {
    const parsed = parseCaptureJson(manualJson);
    if (!parsed) {
      toast.error('Invalid capture data — expected JSON from the capture script.');
      return;
    }
    setCaptureResult(parsed);
    setState('processing');
    const result = await processZoomCapture(resourceId, userId, parsed);
    setProcessResult(result);
    setState(result.success ? 'succeeded' : 'failed');
    if (result.success) {
      toast.success(result.message);
      onCaptureComplete();
    }
  }, [manualJson, resourceId, userId, onCaptureComplete]);

  return (
    <div className="space-y-3 border border-primary/30 rounded-lg p-3 bg-primary/5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Monitor className="h-4 w-4 text-primary" />
        <span className="text-[11px] font-semibold text-foreground">Zoom Session-Assisted Capture</span>
        <Badge variant="outline" className="text-[8px] h-4 border-primary/40 text-primary ml-auto">
          {state === 'idle' && 'Ready'}
          {state === 'waiting_for_capture' && 'Waiting for capture…'}
          {state === 'processing' && 'Processing…'}
          {state === 'succeeded' && 'Captured ✓'}
          {state === 'failed' && 'Partial / Failed'}
        </Badge>
      </div>

      <p className="text-[9px] text-muted-foreground leading-relaxed">
        This recording appears browser-playable but not server-extractable.
        Use your current browser session to capture transcript/media data directly.
      </p>

      {/* Step-by-step flow */}
      {state === 'idle' && (
        <div className="space-y-2">
          <div className="space-y-1.5 text-[9px] text-muted-foreground">
            <p className="font-medium text-foreground">How it works:</p>
            <p>1. Click <strong>Open Zoom Recording</strong> below</p>
            <p>2. Wait for the recording page to fully load (player visible)</p>
            <p>3. Click <strong>Copy Capture Script</strong></p>
            <p>4. On the Zoom page, open DevTools (F12) → Console tab</p>
            <p>5. Paste the script and press Enter</p>
            <p>6. The captured data will be sent back to this app automatically</p>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-[10px] gap-1.5"
              onClick={handleOpenCapture}
            >
              <ExternalLink className="h-3 w-3" /> Open Zoom Recording
            </Button>
          </div>
        </div>
      )}

      {/* Waiting state */}
      {state === 'waiting_for_capture' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Waiting for capture data from the Zoom page…
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] gap-1.5"
              onClick={handleCopyScript}
            >
              <Copy className="h-3 w-3" /> Copy Capture Script
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[10px] gap-1.5"
              onClick={handleOpenCapture}
            >
              <ExternalLink className="h-3 w-3" /> Re-open Recording
            </Button>
          </div>

          {/* Show script toggle */}
          <button
            className="text-[8px] text-muted-foreground hover:underline flex items-center gap-1"
            onClick={() => setShowScript(!showScript)}
          >
            {showScript ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
            {showScript ? 'Hide' : 'View'} capture script
          </button>
          {showScript && (
            <pre className="text-[7px] bg-background border border-border rounded p-2 max-h-32 overflow-auto font-mono whitespace-pre-wrap break-all">
              {generateCaptureScript(origin)}
            </pre>
          )}

          {/* Manual paste fallback */}
          <button
            className="text-[8px] text-muted-foreground hover:underline flex items-center gap-1"
            onClick={() => setShowManualPaste(!showManualPaste)}
          >
            <Clipboard className="h-2.5 w-2.5" />
            {showManualPaste ? 'Hide' : 'Paste capture data manually'}
          </button>
          {showManualPaste && (
            <div className="space-y-1">
              <Textarea
                placeholder="Paste the JSON capture output here…"
                value={manualJson}
                onChange={e => setManualJson(e.target.value)}
                className="text-[9px] min-h-[60px] font-mono"
              />
              <Button
                size="sm"
                className="h-6 text-[9px]"
                onClick={handleManualJsonSubmit}
                disabled={!manualJson.trim()}
              >
                <Play className="h-3 w-3 mr-1" /> Process Capture Data
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Processing */}
      {state === 'processing' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Processing captured data…
          </div>
          {captureResult && (
            <StrategySummary capture={captureResult} />
          )}
        </div>
      )}

      {/* Result */}
      {(state === 'succeeded' || state === 'failed') && captureResult && (
        <div className="space-y-2">
          <div className={cn(
            'flex items-center gap-2 text-[10px]',
            state === 'succeeded' ? 'text-green-600' : 'text-amber-600'
          )}>
            {state === 'succeeded' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {processResult?.message}
          </div>
          <StrategySummary capture={captureResult} />
          {processResult && processResult.contentLength > 0 && (
            <p className="text-[8px] text-muted-foreground">
              Content length: {processResult.contentLength.toLocaleString()} characters
            </p>
          )}

          {/* Allow retry */}
          {state === 'failed' && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[9px]"
              onClick={() => {
                setState('idle');
                setCaptureResult(null);
                setProcessResult(null);
              }}
            >
              Try Again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Shows which strategies were tried and succeeded. */
function StrategySummary({ capture }: { capture: ZoomCaptureResult }) {
  return (
    <div className="space-y-1">
      <p className="text-[8px] font-medium text-muted-foreground">Capture strategies:</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {capture.capture_strategies_tried.map(s => {
          const ok = capture.capture_strategies_succeeded.includes(s);
          return (
            <div key={s} className="flex items-center gap-1 text-[8px]">
              {ok ? <CheckCircle2 className="h-2.5 w-2.5 text-green-500" /> : <XCircle className="h-2.5 w-2.5 text-muted-foreground/50" />}
              <span className={cn(ok ? 'text-green-600' : 'text-muted-foreground')}>
                {STRATEGY_LABELS[s] || s}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5 text-[7px] text-muted-foreground mt-1">
        {capture.player_loaded && <Badge variant="outline" className="text-[7px] h-3">Player loaded</Badge>}
        {capture.transcript_tab_visible && <Badge variant="outline" className="text-[7px] h-3">Transcript tab</Badge>}
        {capture.caption_url && <Badge variant="outline" className="text-[7px] h-3 text-green-600 border-green-500/30">Caption URL</Badge>}
        {capture.media_url && <Badge variant="outline" className="text-[7px] h-3 text-green-600 border-green-500/30">Media URL</Badge>}
        {capture.meeting_topic && <Badge variant="outline" className="text-[7px] h-3">Topic: {capture.meeting_topic}</Badge>}
      </div>
    </div>
  );
}
