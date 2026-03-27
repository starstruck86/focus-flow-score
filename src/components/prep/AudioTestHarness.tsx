import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, CheckCircle2, XCircle, AlertTriangle, Music, Podcast } from 'lucide-react';
import { detectAudioSubtype, getAudioStrategy } from '@/lib/salesBrain/audioPipeline';
import { processAudioResource } from '@/lib/salesBrain/audioOrchestrator';
import type { TranscribeDirectResult, PlatformResolveResult } from '@/lib/salesBrain/audioOrchestrator';

interface StageEntry {
  stage: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  detail?: string;
}

export function AudioTestHarness() {
  const [url, setUrl] = useState('');
  const [running, setRunning] = useState(false);
  const [headResult, setHeadResult] = useState<any>(null);
  const [subtypeInfo, setSubtypeInfo] = useState<any>(null);
  const [directResult, setDirectResult] = useState<TranscribeDirectResult | null>(null);
  const [platformResult, setPlatformResult] = useState<PlatformResolveResult | null>(null);
  const [stages, setStages] = useState<StageEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const addStage = (stage: string, status: StageEntry['status'], detail?: string) => {
    setStages(prev => {
      const existing = prev.findIndex(s => s.stage === stage);
      const entry: StageEntry = { stage, status, detail };
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
    setDirectResult(null);
    setPlatformResult(null);
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

      const isPlatform = ['spotify_episode', 'spotify_show', 'apple_podcast_episode', 'apple_podcast_show', 'podcast_episode_page_only'].includes(subtype);

      // Step 2: HEAD check for direct audio
      if (!isPlatform) {
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
        } catch {
          setHeadResult({ status: 'CORS blocked', note: 'Edge function will perform HEAD check' });
          addStage('HEAD check', 'done', 'CORS — delegated to edge function');
        }
      }

      // Step 3: Process via smart orchestrator
      const actionLabel = isPlatform ? 'Platform resolve' : 'Transcribe (edge fn)';
      addStage(actionLabel, 'running');
      const testResourceId = `test-${Date.now()}`;
      const result = await processAudioResource(testResourceId, url);

      // Determine result type
      if ('metadata' in result && 'resolution' in result) {
        // PlatformResolveResult
        const pr = result as PlatformResolveResult;
        setPlatformResult(pr);

        // Add resolver stages
        for (const rs of pr.resolverStages) {
          addStage(rs.stage, rs.status === 'done' ? 'done' : rs.status === 'failed' ? 'failed' : 'running', rs.detail);
        }

        if (pr.transcriptionResult) {
          setDirectResult(pr.transcriptionResult);
          addStage('Transcription', pr.transcriptionResult.success ? 'done' : 'failed',
            pr.transcriptionResult.success
              ? `${pr.transcriptionResult.totalWords} words`
              : pr.transcriptionResult.failureReason || 'Failed');
        }

        addStage(actionLabel, pr.success ? 'done' : 'failed',
          `${pr.finalStatus}${pr.failureCode ? ` (${pr.failureCode})` : ''}`);
      } else {
        // TranscribeDirectResult
        const tr = result as TranscribeDirectResult;
        setDirectResult(tr);
        if (tr.success) {
          addStage(actionLabel, 'done',
            `${tr.totalWords} words, ${tr.chunksCompleted}/${tr.chunksTotal} chunks, ${tr.durationMs}ms`);
          if (tr.quality) {
            addStage('Quality check', 'done', `${tr.quality.quality} — ${tr.quality.reason}`);
          }
        } else {
          addStage(actionLabel, 'failed', `${tr.failureCode}: ${tr.failureReason}`);
        }
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

  const subtypeBadgeVariant = (subtype: string) => {
    if (subtype.includes('spotify')) return 'default';
    if (subtype.includes('apple')) return 'secondary';
    if (subtype === 'direct_audio_file') return 'outline';
    return 'destructive';
  };

  const subtypeIcon = (subtype: string) => {
    if (subtype.includes('spotify')) return <Music className="h-3 w-3" />;
    if (subtype.includes('apple') || subtype.includes('podcast')) return <Podcast className="h-3 w-3" />;
    return null;
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
            placeholder="Paste URL: MP3, Spotify episode, Apple Podcasts episode..."
            className="flex-1"
          />
          <Button onClick={runPipeline} disabled={running || !url.trim()}>
            {running ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
            Run
          </Button>
        </div>

        {/* Quick test URLs */}
        <div className="flex flex-wrap gap-1">
          {[
            { label: 'Spotify ep', url: 'https://open.spotify.com/episode/3LsHTsCRkxEqllND7f3PCL' },
            { label: 'Apple ep', url: 'https://podcasts.apple.com/gr/podcast/sales-enablement-masterclass-with-nate-vogel/id1502265369?i=1000756968305' },
          ].map(t => (
            <Button key={t.label} variant="outline" size="sm" className="text-xs h-6 px-2"
              onClick={() => setUrl(t.url)}>
              {t.label}
            </Button>
          ))}
        </div>

        {/* Stages timeline */}
        {stages.length > 0 && (
          <div className="space-y-1 border rounded-lg p-3 bg-muted/30">
            <div className="text-xs font-medium text-muted-foreground mb-2">Pipeline Stages</div>
            {stages.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {stageIcon(s)}
                <span className="font-medium min-w-[180px]">{s.stage}</span>
                {s.detail && <span className="text-muted-foreground text-xs truncate">{s.detail}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Subtype info */}
        {subtypeInfo && (
          <div className="border rounded-lg p-3 space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Detection</div>
            <div className="flex gap-2 flex-wrap items-center">
              <Badge variant={subtypeBadgeVariant(subtypeInfo.subtype)} className="gap-1">
                {subtypeIcon(subtypeInfo.subtype)}
                {subtypeInfo.subtype}
              </Badge>
              <Badge variant={subtypeInfo.strategy.retryMode === 'automatic' ? 'default' : 'secondary'}>
                {subtypeInfo.strategy.retryMode}
              </Badge>
              {subtypeInfo.strategy.manualAssistRequired && (
                <Badge variant="destructive">Manual assist required</Badge>
              )}
              {subtypeInfo.strategy.metadataOnlyAcceptable && (
                <Badge variant="outline">Metadata-only OK</Badge>
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

        {/* Platform Resolution Result */}
        {platformResult && (
          <div className={`border rounded-lg p-3 space-y-2 ${platformResult.finalStatus === 'audio_resolved' || platformResult.finalStatus === 'completed' ? 'border-green-500/30 bg-green-500/5' : platformResult.finalStatus === 'metadata_only' ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
            <div className="flex items-center gap-2">
              {platformResult.finalStatus === 'completed' || platformResult.finalStatus === 'audio_resolved'
                ? <CheckCircle2 className="h-5 w-5 text-green-500" />
                : platformResult.finalStatus === 'metadata_only'
                  ? <AlertTriangle className="h-5 w-5 text-yellow-500" />
                  : <XCircle className="h-5 w-5 text-destructive" />}
              <span className="font-medium text-sm">
                {platformResult.finalStatus === 'completed' ? 'Resolved + Transcribed' :
                  platformResult.finalStatus === 'audio_resolved' ? 'Audio Resolved' :
                    platformResult.finalStatus === 'metadata_only' ? 'Metadata Only' : 'Needs Manual Assist'}
              </span>
              {platformResult.failureCode && (
                <Badge variant="outline" className="text-xs">{platformResult.failureCode}</Badge>
              )}
            </div>

            {/* Metadata */}
            {platformResult.metadata && (
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {platformResult.metadata.title && <>
                  <div className="text-muted-foreground">Title:</div>
                  <div className="truncate">{platformResult.metadata.title}</div>
                </>}
                {platformResult.metadata.showName && <>
                  <div className="text-muted-foreground">Show:</div>
                  <div>{platformResult.metadata.showName}</div>
                </>}
                {platformResult.metadata.description && <>
                  <div className="text-muted-foreground">Description:</div>
                  <div className="text-xs truncate max-w-md">{platformResult.metadata.description.substring(0, 200)}</div>
                </>}
              </div>
            )}

            {/* Resolution */}
            {platformResult.resolution && (
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                <div className="text-muted-foreground">RSS Feed:</div>
                <div>{platformResult.resolution.rssFeedUrl ? '✅ Found' : '❌ Not found'}</div>
                <div className="text-muted-foreground">Audio URL:</div>
                <div>{platformResult.resolution.audioEnclosureUrl ? '✅ Resolved' : '❌ Not found'}</div>
                <div className="text-muted-foreground">Transcript Source:</div>
                <div>{platformResult.resolution.transcriptSourceUrl ? '✅ Found' : '❌ Not found'}</div>
              </div>
            )}

            {platformResult.failureReason && (
              <div className="text-xs text-muted-foreground bg-background rounded p-2 border">
                {platformResult.failureReason}
              </div>
            )}
          </div>
        )}

        {/* Direct transcription result */}
        {directResult && (
          <div className={`border rounded-lg p-3 space-y-2 ${directResult.success ? 'border-green-500/30 bg-green-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
            <div className="flex items-center gap-2">
              {directResult.success
                ? <CheckCircle2 className="h-5 w-5 text-green-500" />
                : <XCircle className="h-5 w-5 text-destructive" />}
              <span className="font-medium text-sm">{directResult.success ? 'Transcription Complete' : 'Transcription Failed'}</span>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div className="text-muted-foreground">Words:</div><div>{directResult.totalWords}</div>
              <div className="text-muted-foreground">Chunks:</div><div>{directResult.chunksCompleted}/{directResult.chunksTotal}</div>
              <div className="text-muted-foreground">Provider:</div><div>{directResult.provider || 'n/a'}</div>
              <div className="text-muted-foreground">Duration:</div><div>{directResult.durationMs}ms</div>
              <div className="text-muted-foreground">Quality:</div>
              <div>
                {directResult.quality ? (
                  <Badge variant={directResult.quality.quality === 'high_quality' ? 'default' : directResult.quality.quality === 'usable' ? 'secondary' : 'destructive'}>
                    {directResult.quality.quality}
                  </Badge>
                ) : 'n/a'}
              </div>
              <div className="text-muted-foreground">Persisted:</div><div>{directResult.persisted ? '✅' : '❌'}</div>
              {directResult.failureCode && <>
                <div className="text-muted-foreground">Failure:</div>
                <div className="text-destructive">{directResult.failureCode}: {directResult.failureReason}</div>
              </>}
            </div>

            {directResult.transcript && (
              <div className="mt-2">
                <div className="text-xs font-medium text-muted-foreground mb-1">Transcript Preview (first 500 chars)</div>
                <div className="text-xs bg-background rounded p-2 border max-h-40 overflow-y-auto font-mono whitespace-pre-wrap">
                  {directResult.transcript.substring(0, 500)}
                  {directResult.transcript.length > 500 && '...'}
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
