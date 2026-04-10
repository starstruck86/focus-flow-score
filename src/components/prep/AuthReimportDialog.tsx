/**
 * AuthReimportDialog — Re-imports an auth-gated lesson resource with credentials.
 * Updates the existing resource in-place rather than creating duplicates.
 */
import { useState, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Shield, Loader2, CheckCircle2, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Resource } from '@/hooks/useResources';

type ReimportStage = 'credentials' | 'fetching' | 'saving' | 'done' | 'failed';

interface Props {
  resource: Resource | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuthReimportDialog({ resource, open, onOpenChange }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [stage, setStage] = useState<ReimportStage>('credentials');
  const [stageMessage, setStageMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const reset = useCallback(() => {
    setStage('credentials');
    setStageMessage('');
    setError(null);
    // Preserve email across uses, clear password
    setPassword('');
  }, []);

  const handleClose = useCallback(() => {
    if (stage === 'fetching' || stage === 'saving') return; // don't close mid-operation
    reset();
    onOpenChange(false);
  }, [stage, reset, onOpenChange]);

  const handleReimport = useCallback(async () => {
    if (!resource) return;
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }

    setError(null);
    setStage('fetching');
    setStageMessage('Looking up lesson URL…');

    try {
      // Step 1: Find the original lesson URL from course_lesson_imports
      const { data: lessonRow } = await supabase
        .from('course_lesson_imports')
        .select('lesson_url, original_course_url, course_title')
        .eq('resource_id', resource.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Fallback: use file_url or derive from title
      const lessonUrl = lessonRow?.lesson_url || resource.file_url;
      const courseUrl = lessonRow?.original_course_url || '';

      if (!lessonUrl) {
        setStage('failed');
        setError('Cannot determine the original lesson URL. Manual content paste may be required.');
        return;
      }

      setStageMessage('Authenticating and fetching lesson content…');

      // Step 2: Call import-course with fetch_lesson action
      const { data: lessonData, error: fetchError } = await trackedInvoke<any>('import-course', {
        body: {
          url: courseUrl || lessonUrl,
          action: 'fetch_lesson',
          lesson_url: lessonUrl,
          email: email.trim(),
          password,
        },
        timeoutMs: 90_000,
      });

      if (fetchError) throw fetchError;

      if (!lessonData?.success) {
        const errMsg = lessonData?.error || 'Lesson fetch failed';
        if (/login|auth|credentials|password/i.test(errMsg)) {
          setStage('credentials');
          setError('Authentication failed — check your credentials and try again.');
        } else {
          setStage('failed');
          setError(errMsg);
        }
        return;
      }

      // Step 3: Update the existing resource with captured content
      setStage('saving');
      setStageMessage('Saving captured content to resource…');

      const content = lessonData.content || '';
      const hasVideo = Boolean(lessonData.media_url);
      const hasTranscript = Boolean(lessonData.transcript && lessonData.transcript.length > 50);

      if (content.length < 50 && !hasVideo) {
        setStage('failed');
        setError('Fetched page but no usable content found. The lesson may require a different access method.');
        return;
      }

      // Build the update payload
      const updatePayload: Record<string, any> = {
        content,
        content_length: content.length,
        enrichment_status: 'not_enriched',
        failure_reason: null,
        manual_input_required: false,
        recovery_queue_bucket: null,
        recovery_status: null,
      };

      // If server returned media URL, attempt transcription
      if (hasVideo && lessonData.media_url) {
        setStageMessage('Transcribing video content…');
        try {
          const { data: txData } = await trackedInvoke<any>('transcribe-audio', {
            body: { audio_url: lessonData.media_url },
            timeoutMs: 120_000,
          });

          if (txData?.success && typeof txData.transcript === 'string' && txData.transcript.trim().length > 0) {
            const transcript = txData.transcript.trim();
            // Merge lesson text with transcript
            const merged = content.length > 100
              ? `${content}\n\n---\n\n## Video Transcript\n\n${transcript}`
              : transcript;
            updatePayload.content = merged;
            updatePayload.content_length = merged.length;
          }
        } catch (txErr) {
          // Non-fatal: we still have the page content
          console.warn('[AuthReimport] Transcription failed (non-fatal):', txErr);
        }
      }

      // Write to the resource
      const { error: updateError } = await supabase
        .from('resources')
        .update(updatePayload as any)
        .eq('id', resource.id);

      if (updateError) throw updateError;

      // Step 4: Update the course_lesson_imports record if it exists
      if (lessonRow) {
        await supabase
          .from('course_lesson_imports')
          .update({
            import_status: 'complete',
            import_substatus: 'auth_reimport',
            import_error: null,
            transcript_status: hasTranscript ? 'transcript_ready' : (hasVideo ? 'transcript_pending' : null),
          } as any)
          .eq('resource_id', resource.id);
      }

      // Step 5: Invalidate caches
      setStageMessage('Running validation…');
      await queryClient.invalidateQueries({ queryKey: ['resources'] });
      await queryClient.invalidateQueries({ queryKey: ['canonical-lifecycle'] });
      await queryClient.invalidateQueries({ queryKey: ['knowledge-items'] });

      setStage('done');
      setStageMessage(
        `Content captured (${Math.round(updatePayload.content_length / 1000)}K chars)` +
        (hasVideo ? ' + video' : '') +
        '. Resource will proceed through the normal pipeline.'
      );

      toast.success('Re-import successful', {
        description: `${resource.title} — content captured and queued for enrichment.`,
      });

    } catch (err: any) {
      setStage('failed');
      setError(err?.message || 'Re-import failed unexpectedly.');
    }
  }, [resource, email, password, queryClient]);

  if (!resource) return null;

  const isProcessing = stage === 'fetching' || stage === 'saving';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md bg-card border border-border/60 rounded-2xl shadow-xl">
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Re-import with Authentication
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground truncate">
            {resource.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status badges */}
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              {resource.resource_type}
            </Badge>
            {resource.content_length != null && resource.content_length > 0 && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Current: {resource.content_length} chars (placeholder)
              </Badge>
            )}
          </div>

          {/* Explanation */}
          {stage === 'credentials' && (
            <div className="text-sm text-muted-foreground">
              This resource was imported from a login-protected course but the content was not fully captured.
              Enter your course platform credentials to re-fetch the content.
            </div>
          )}

          {/* Credentials form */}
          {(stage === 'credentials' || (stage === 'failed' && error)) && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="reimport-email" className="text-xs">Platform Email</Label>
                <Input
                  id="reimport-email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isProcessing}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reimport-password" className="text-xs">Platform Password</Label>
                <div className="relative">
                  <Input
                    id="reimport-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isProcessing}
                    className="h-9 text-sm pr-9"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Credentials are used for this session only and are never stored.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          {/* Progress */}
          {isProcessing && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
              <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
              <span className="text-sm">{stageMessage}</span>
            </div>
          )}

          {/* Success */}
          {stage === 'done' && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-recovery/10 border border-recovery/20">
              <CheckCircle2 className="h-4 w-4 text-recovery shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-recovery">Re-import successful</p>
                <p className="text-xs text-muted-foreground mt-0.5">{stageMessage}</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-end gap-3 mt-4">
          {stage === 'done' ? (
            <Button variant="default" onClick={handleClose} className="text-sm">
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={isProcessing} className="text-sm">
                Cancel
              </Button>
              <Button
                onClick={handleReimport}
                disabled={isProcessing || !email.trim() || !password}
                className="text-sm"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    Re-importing…
                  </>
                ) : stage === 'failed' ? (
                  'Retry'
                ) : (
                  'Re-import'
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
