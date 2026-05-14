/**
 * Data access layer for the Manual Course Import workflow.
 * Captures source material; downstream KI pipeline processes it.
 */
import { supabase } from '@/integrations/supabase/client';

export type CourseStatus = 'draft' | 'importing' | 'ready_for_processing' | 'processed' | 'archived';
export type LessonStatus =
  | 'draft'
  | 'complete'
  | 'missing_transcript'
  | 'missing_lesson_text'
  | 'missing_resources'
  | 'ready_for_processing';
export type LessonSourceStatus = 'not_processed' | 'queued' | 'processed';

export interface ResourceLink {
  name?: string;
  url?: string;
  type?: string;
  notes?: string;
}

export interface AttachmentRef {
  file_name?: string;
  file_type?: string;
  file_url?: string;
  notes?: string;
}

export interface CourseImportRow {
  id: string;
  user_id: string;
  course_name: string;
  course_authors: string | null;
  course_platform: string | null;
  course_url: string | null;
  course_category: string | null;
  primary_use_case: string | null;
  notes: string | null;
  status: CourseStatus;
  source_registry_id: string | null;
  ready_at: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CourseLessonRow {
  id: string;
  user_id: string;
  course_import_id: string;
  lesson_number: number | null;
  lesson_name: string | null;
  section_name: string | null;
  lesson_url: string | null;
  transcript_text: string | null;
  lesson_text: string | null;
  resource_links: ResourceLink[];
  attachment_refs: AttachmentRef[];
  user_notes: string | null;
  raw_source_text: string | null;
  status: LessonStatus;
  source_status: LessonSourceStatus;
  missing_fields: string[];
  resource_id: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

const sb = supabase as any;

// ── Course imports ────────────────────────────────────────────
export async function listCourseImports(userId: string): Promise<CourseImportRow[]> {
  const { data, error } = await sb
    .from('course_imports')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []) as CourseImportRow[];
}

export async function getCourseImport(id: string): Promise<CourseImportRow> {
  const { data, error } = await sb.from('course_imports').select('*').eq('id', id).single();
  if (error) throw error;
  return data as CourseImportRow;
}

export async function createCourseImport(
  input: Partial<CourseImportRow> & { user_id: string; course_name: string },
): Promise<CourseImportRow> {
  const { data, error } = await sb
    .from('course_imports')
    .insert({ ...input, status: input.status || 'draft' })
    .select()
    .single();
  if (error) throw error;
  return data as CourseImportRow;
}

export async function updateCourseImport(
  id: string,
  patch: Partial<CourseImportRow>,
): Promise<CourseImportRow> {
  const { data, error } = await sb
    .from('course_imports')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as CourseImportRow;
}

export async function deleteCourseImport(id: string): Promise<void> {
  const { error } = await sb.from('course_imports').delete().eq('id', id);
  if (error) throw error;
}

// ── Course lessons ────────────────────────────────────────────
export async function listCourseLessons(courseImportId: string): Promise<CourseLessonRow[]> {
  const { data, error } = await sb
    .from('course_lessons')
    .select('*')
    .eq('course_import_id', courseImportId)
    .order('lesson_number', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as CourseLessonRow[];
}

export function computeMissingFields(
  l: Partial<CourseLessonRow>,
): { missing: string[]; status: LessonStatus } {
  const missing: string[] = [];
  if (!l.lesson_name?.trim()) missing.push('lesson_name');
  if (!l.transcript_text?.trim()) missing.push('transcript');
  if (!l.lesson_text?.trim()) missing.push('lesson_text');
  if (!l.resource_links?.length && !l.attachment_refs?.length) missing.push('resources');

  let status: LessonStatus = 'complete';
  if (missing.includes('transcript')) status = 'missing_transcript';
  else if (missing.includes('lesson_text')) status = 'missing_lesson_text';
  else if (missing.includes('resources')) status = 'missing_resources';
  return { missing, status };
}

export async function upsertLesson(
  lesson: Partial<CourseLessonRow> & { user_id: string; course_import_id: string },
): Promise<CourseLessonRow> {
  const { missing, status } = computeMissingFields(lesson);
  const payload: any = {
    ...lesson,
    missing_fields: missing,
    status: lesson.status || status,
  };
  let res;
  if (lesson.id) {
    res = await sb.from('course_lessons').update(payload).eq('id', lesson.id).select().single();
  } else {
    res = await sb.from('course_lessons').insert(payload).select().single();
  }
  if (res.error) throw res.error;
  return res.data as CourseLessonRow;
}

export async function bulkInsertLessons(
  rows: (Partial<CourseLessonRow> & { user_id: string; course_import_id: string })[],
): Promise<CourseLessonRow[]> {
  if (!rows.length) return [];
  const payload = rows.map((l) => {
    const { missing, status } = computeMissingFields(l);
    return { ...l, missing_fields: missing, status: l.status || status };
  });
  const { data, error } = await sb.from('course_lessons').insert(payload).select();
  if (error) throw error;
  return (data || []) as CourseLessonRow[];
}

export async function deleteLesson(id: string): Promise<void> {
  const { error } = await sb.from('course_lessons').delete().eq('id', id);
  if (error) throw error;
}

export async function duplicateLesson(id: string): Promise<CourseLessonRow> {
  const original = await sb.from('course_lessons').select('*').eq('id', id).single();
  if (original.error) throw original.error;
  const o = original.data as CourseLessonRow;
  const { id: _omit, created_at, updated_at, processed_at, ...rest } = o;
  const copy = {
    ...rest,
    lesson_name: `${o.lesson_name || 'Lesson'} (copy)`,
    lesson_number: (o.lesson_number ?? 0) + 1,
    source_status: 'not_processed' as const,
  };
  const { data, error } = await sb.from('course_lessons').insert(copy).select().single();
  if (error) throw error;
  return data as CourseLessonRow;
}

/**
 * Mark a course ready for downstream processing.
 * Creates a `source_registry` row for the course (if not present) and one `resources`
 * row per eligible lesson with full content. The existing KI/source-processing pipeline
 * picks these up via standard enrichment.
 */
export async function markCourseReadyForProcessing(
  courseId: string,
  userId: string,
): Promise<{ course: CourseImportRow; lessonsQueued: number }> {
  const course = await getCourseImport(courseId);
  const lessons = await listCourseLessons(courseId);

  // Ensure source_registry row exists
  let sourceRegistryId = course.source_registry_id;
  if (!sourceRegistryId) {
    const { data: srcData, error: srcErr } = await sb
      .from('source_registry')
      .insert({
        user_id: userId,
        name: course.course_name,
        source_type: 'manual_note',
        url: course.course_url,
        status: 'active',
        metadata: {
          source_collection_type: 'manual_course_import',
          course_import_id: course.id,
          course_authors: course.course_authors,
          course_platform: course.course_platform,
          course_category: course.course_category,
          primary_use_case: course.primary_use_case,
        },
      })
      .select()
      .single();
    if (srcErr) throw srcErr;
    sourceRegistryId = (srcData as any).id;
  }

  // Create one resource per eligible lesson (has lesson_text or transcript)
  let queued = 0;
  for (const lesson of lessons) {
    const hasContent =
      (lesson.transcript_text && lesson.transcript_text.trim().length > 0) ||
      (lesson.lesson_text && lesson.lesson_text.trim().length > 0);
    if (!hasContent) continue;
    if (lesson.resource_id) {
      queued++;
      continue;
    }

    const contentParts: string[] = [];
    if (lesson.lesson_text?.trim()) contentParts.push(lesson.lesson_text.trim());
    if (lesson.transcript_text?.trim()) {
      contentParts.push('## Transcript\n\n' + lesson.transcript_text.trim());
    }
    if (lesson.user_notes?.trim()) {
      contentParts.push('## Notes\n\n' + lesson.user_notes.trim());
    }
    const content = contentParts.join('\n\n');

    const title =
      [lesson.lesson_number ? `${lesson.lesson_number}. ` : '', lesson.lesson_name || 'Lesson']
        .join('')
        .trim();

    const { data: resData, error: resErr } = await sb
      .from('resources')
      .insert({
        user_id: userId,
        title: `${course.course_name} — ${title}`,
        description: lesson.section_name || null,
        resource_type: 'course_lesson',
        content,
        content_status: 'full',
        content_length: content.length,
        manual_content_present: true,
        author_or_speaker: course.course_authors,
        source_registry_id: sourceRegistryId,
        external_id: `course:${course.id}:lesson:${lesson.id}`,
        file_url: lesson.lesson_url,
        enrichment_status: 'not_enriched',
        brain_status: 'pending',
        tags: [
          'manual_course_import',
          course.course_platform ? `platform:${course.course_platform}` : '',
          course.course_category ? `category:${course.course_category}` : '',
        ].filter(Boolean),
      })
      .select()
      .single();
    if (resErr) throw resErr;

    await sb
      .from('course_lessons')
      .update({
        resource_id: (resData as any).id,
        source_status: 'queued',
        status: 'ready_for_processing',
      })
      .eq('id', lesson.id);
    queued++;
  }

  const updated = await updateCourseImport(courseId, {
    status: 'ready_for_processing',
    source_registry_id: sourceRegistryId,
    ready_at: new Date().toISOString(),
  });

  return { course: updated, lessonsQueued: queued };
}
