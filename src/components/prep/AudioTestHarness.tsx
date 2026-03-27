import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, RotateCcw, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { detectAudioSubtype, getAudioStrategy, scoreTranscriptQuality } from '@/lib/salesBrain/audioPipeline';
import { transcribeDirectAudio, retryAudioJob, getAudioJobForResourceDb } from '@/lib/salesBrain/audioOrchestrator';
import type { TranscribeDirectResult } from '@/lib/salesBrain/audioOrchestrator';

interface StageEntry {
  stage: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  detail?: string;
  timestamp?: number;
}

export function AudioTestHarness() {
  const [url, setUrl] = useState('');
  const [running, setRunning] = useState(false);
  const [headResult, setHeadResult] = useState<any>(null);
  const [subtypeInfo, setSubtypeInfo] = useState<any>(null);
  const [result, setResult] = useState<TranscribeDirectResult | null>(null);
  const [stages, setStages] = useState<StageEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const addStage = (stage: string, status: StageEntry['status'], detail?: string) => {
    setStages(prev => {
      const existing = prev.findIndex(s => s.stage === stage);
      const entry: StageEntry = { stage, status, detail, timestamp: Date.now() };
      if (existing >= 0) {
        const copy = [...prev];
        copy[existing] = entry;
        return copy;
      }
      return [...prev, entry];
    });
  };

  const runPipeline = async () => {
    if (!url.trim()) return;
    setRunning(true);
    setResult(null);
    setHeadResult(null);
    setError(null);
    setStages([]);

    try {
      // Step 1: Detect subtype
      addStage('Detect subtype', 'running');
      const subtype = detectAudioSubtype(url);
      const strategy = getAudioStrategy(subtype);
      setSubtypeInfo({ subtype, strategy });
      addStage('Detect subtype', 'done', subtype);

      // Step 2: HEAD check (via edge function — it does this internally)
      addStage('HEAD check', 'running');
      try {
        const headResp = await fetch(url, { method: 'HEAD' });
        const hd = {
          status: headResp.status,
          contentType: headResp.headers.get('content-type'),
          contentLength: headResp.headers.get('content-length'),
          reachable: headResp.ok,
        };
        setHeadResult(hd);
        addStage('HEAD check', hd.reachable ? 'done' : 'failed', `${hd.status} ${hd.contentType}`);
      } catch (e) {
        // HEAD may be blocked by CORS from browser — that's OK, edge function will do it
        setHeadResult({ status: 'CORS blocked', note: 'Edge function will perform HEAD check' });
        addStage('HEAD check', 'done', 'CORS — delegated to edge function');
      }

      // Step 3: Transcribe via edge function
      addStage('Transcribe (edge fn)', 'running');
      // Use a pseudo resource ID for testing
      const testResourceId = `test-${Date.now()}`;
      const transcribeResult = await transcribeDirectAudio(testResourceId, url);
      setResult(transcribeResult);

      if (transcribeResult.success) {
        addStage('Transcribe (edge fn)', 'done',
          `${transcribeResult.totalWords} words, ${transcribeResult.chunksCompleted}/${transcribeResult.chunksTotal} chunks, ${transcribeResult.durationMs}ms`);

        // Step 4: Quality check (already done in orchestrator)
        if (transcribeResult.quality) {
          addStage('Quality check', 'done', `${transcribeResult.quality.quality} — ${transcribeResult.quality.reason}`);
        }
      } else {
        addStage('Transcribe (edge fn)', 'failed', `${transcribeResult.failureCode}: ${transcribeResult.failureReason}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addStage('Pipeline', 'failed', msg);
    } finally {
      setRunning(false);
    }
  };

  const stageIcon = (s: StageEntry) => {
    switch (s.status) {
      case 'running': return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case 'done': return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed': return <XCircle className="h-4 w-4 text-destructive" />;
      default: return <div className="h-4 w-4 rounded-full border border-muted" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Audio Pipeline Test Harness</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="Paste audio URL (MP3, podcast, etc.)"
            className="flex-1"
          />
          <Button onClick={runPipeline} disabled={running || !url.trim()}>
            {running ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
            Run
          </Button>
        </div>

        {/* Stages timeline */}
        {stages.length > 0 && (
          <div className="space-y-1 border rounded-lg p-3 bg-muted/30">
            <div className="text-xs font-medium text-muted-foreground mb-2">Pipeline Stages</div>
            {stages.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {stageIcon(s)}
                <span className="font-medium min-w-[140px]">{s.stage}</span>
                {s.detail && <span className="text-muted-foreground text-xs truncate">{s.detail}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Subtype info */}
        {subtypeInfo && (
          <div className="border rounded-lg p-3 space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Detection</div>
            <div className="flex gap-2 flex-wrap">
              <Badge variant="outline">{subtypeInfo.subtype}</Badge>
              <Badge variant={subtypeInfo.strategy.retryMode === 'automatic' ? 'default' : 'secondary'}>
                {subtypeInfo.strategy.retryMode}
              </Badge>
              {subtypeInfo.strategy.manualAssistRequired && (
                <Badge variant="destructive">Manual assist required</Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Primary: {subtypeInfo.strategy.primaryPath.description}
            </div>
          </div>
        )}

        {/* HEAD result */}
        {headResult && (
          <div className="border rounded-lg p-3 space-y-1">
            <div className="text-xs font-medium text-muted-foreground">HEAD Check</div>
            <div className="text-sm font-mono">
              Status: {headResult.status} | Type: {headResult.contentType || 'n/a'} | Size: {headResult.contentLength ? `${Math.round(Number(headResult.contentLength) / 1024)}KB` : 'n/a'}
            </div>
            {headResult.note && <div className="text-xs text-muted-foreground">{headResult.note}</div>}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className={`border rounded-lg p-3 space-y-2 ${result.success ? 'border-green-500/30 bg-green-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
            <div className="flex items-center gap-2">
              {result.success
                ? <CheckCircle2 className="h-5 w-5 text-green-500" />
                : <XCircle className="h-5 w-5 text-destructive" />}
              <span className="font-medium text-sm">{result.success ? 'Transcription Complete' : 'Failed'}</span>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div className="text-muted-foreground">Words:</div>
              <div>{result.totalWords}</div>
              <div className="text-muted-foreground">Chunks:</div>
              <div>{result.chunksCompleted}/{result.chunksTotal}</div>
              <div className="text-muted-foreground">Provider:</div>
              <div>{result.provider || 'n/a'}</div>
              <div className="text-muted-foreground">Duration:</div>
              <div>{result.durationMs}ms</div>
              <div className="text-muted-foreground">Quality:</div>
              <div>
                {result.quality ? (
                  <Badge variant={result.quality.quality === 'high_quality' ? 'default' : result.quality.quality === 'usable' ? 'secondary' : 'destructive'}>
                    {result.quality.quality}
                  </Badge>
                ) : 'n/a'}
              </div>
              <div className="text-muted-foreground">Persisted:</div>
              <div>{result.persisted ? '✅ Yes' : '❌ No'}</div>
              {result.failureCode && (
                <>
                  <div className="text-muted-foreground">Failure:</div>
                  <div className="text-destructive">{result.failureCode}: {result.failureReason}</div>
                </>
              )}
            </div>

            {/* Transcript preview */}
            {result.transcript && (
              <div className="mt-2">
                <div className="text-xs font-medium text-muted-foreground mb-1">Transcript Preview (first 500 chars)</div>
                <div className="text-xs bg-background rounded p-2 border max-h-40 overflow-y-auto font-mono whitespace-pre-wrap">
                  {result.transcript.substring(0, 500)}
                  {result.transcript.length > 500 && '...'}
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
