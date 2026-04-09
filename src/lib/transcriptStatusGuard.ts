/**
 * Transcript Status Drift Guard
 * 
 * Detects and optionally auto-corrects mismatches between
 * course_lesson_imports.transcript_status and actual resource content.
 */

import { supabase } from "@/integrations/supabase/client";

interface TranscriptMismatch {
  import_id: string;
  lesson_url: string;
  source_lesson_title: string | null;
  resource_id: string | null;
  transcript_status: string;
  content_length: number | null;
  has_transcript_marker: boolean;
}

/**
 * Finds all course_lesson_imports where transcript_status = 'transcript_pending'
 * but the linked resource clearly contains transcript content.
 */
export async function detectTranscriptStatusDrift(userId: string): Promise<TranscriptMismatch[]> {
  const { data, error } = await supabase
    .from("course_lesson_imports")
    .select("id, lesson_url, source_lesson_title, resource_id, transcript_status")
    .eq("user_id", userId)
    .eq("transcript_status", "transcript_pending")
    .not("resource_id", "is", null);

  if (error || !data || data.length === 0) return [];

  const resourceIds = data.map(d => d.resource_id).filter(Boolean) as string[];
  if (resourceIds.length === 0) return [];

  const { data: resources } = await supabase
    .from("resources")
    .select("id, content, content_length")
    .in("id", resourceIds);

  if (!resources) return [];

  const resourceMap = new Map(resources.map(r => [r.id, r]));
  const mismatches: TranscriptMismatch[] = [];

  for (const row of data) {
    if (!row.resource_id) continue;
    const res = resourceMap.get(row.resource_id);
    if (!res) continue;

    const hasMarker = (res.content || "").includes("--- Video Transcript ---");
    const isLong = (res.content_length || 0) > 2000;

    if (hasMarker || isLong) {
      mismatches.push({
        import_id: row.id,
        lesson_url: row.lesson_url,
        source_lesson_title: row.source_lesson_title,
        resource_id: row.resource_id,
        transcript_status: row.transcript_status,
        content_length: res.content_length,
        has_transcript_marker: hasMarker,
      });
    }
  }

  if (mismatches.length > 0) {
    console.warn(
      `[TranscriptStatusGuard] ${mismatches.length} lesson(s) have transcript content but status is still 'transcript_pending':`,
      mismatches.map(m => m.source_lesson_title || m.lesson_url)
    );
  }

  return mismatches;
}

/**
 * Auto-heals detected mismatches by updating transcript_status to 'transcript_complete'.
 * Returns the count of corrected records.
 */
export async function healTranscriptStatusDrift(userId: string): Promise<number> {
  const mismatches = await detectTranscriptStatusDrift(userId);
  if (mismatches.length === 0) return 0;

  let healed = 0;
  for (const m of mismatches) {
    const { error } = await supabase
      .from("course_lesson_imports")
      .update({
        transcript_status: "transcript_complete",
        transcript_completed_at: new Date().toISOString(),
        transcript_source: "auto_healed",
      })
      .eq("id", m.import_id)
      .eq("user_id", userId);

    if (!error) {
      healed++;
      console.warn(`[TranscriptStatusGuard] Auto-healed: "${m.source_lesson_title}" → transcript_complete`);
    }
  }

  return healed;
}

/**
 * Inline guard: call after any transcript merge to warn if status wasn't updated.
 * Does NOT write to DB — just logs.
 */
export function warnIfStatusDrifted(
  lessonTitle: string,
  transcriptStatus: string | null | undefined,
  contentHasTranscript: boolean
): void {
  if (contentHasTranscript && transcriptStatus !== "transcript_complete") {
    console.warn(
      `[TranscriptStatusGuard] DRIFT DETECTED — "${lessonTitle}" has transcript content but status="${transcriptStatus}". This should be auto-corrected.`
    );
  }
}
