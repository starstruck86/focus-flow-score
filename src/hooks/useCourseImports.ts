import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  listCourseImports,
  getCourseImport,
  createCourseImport,
  updateCourseImport,
  deleteCourseImport,
  listCourseLessons,
  upsertLesson,
  bulkInsertLessons,
  deleteLesson,
  duplicateLesson,
  markCourseReadyForProcessing,
  type CourseImportRow,
  type CourseLessonRow,
} from '@/data/courseImports';
import { toast } from 'sonner';

export function useCourseImportsList() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['course-imports', user?.id],
    queryFn: () => listCourseImports(user!.id),
    enabled: !!user?.id,
  });
}

export function useCourseImport(id: string | undefined) {
  return useQuery({
    queryKey: ['course-import', id],
    queryFn: () => getCourseImport(id!),
    enabled: !!id,
  });
}

export function useCourseLessons(courseId: string | undefined) {
  return useQuery({
    queryKey: ['course-lessons', courseId],
    queryFn: () => listCourseLessons(courseId!),
    enabled: !!courseId,
  });
}

export function useCreateCourseImport() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (input: Partial<CourseImportRow> & { course_name: string }) =>
      createCourseImport({ ...input, user_id: user!.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course-imports'] });
      toast.success('Course created');
    },
    onError: (e: any) => toast.error(`Failed: ${e.message}`),
  });
}

export function useUpdateCourseImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CourseImportRow> }) =>
      updateCourseImport(id, patch),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['course-imports'] });
      qc.invalidateQueries({ queryKey: ['course-import', row.id] });
    },
    onError: (e: any) => toast.error(`Failed: ${e.message}`),
  });
}

export function useDeleteCourseImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteCourseImport,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course-imports'] });
      toast.success('Course deleted');
    },
    onError: (e: any) => toast.error(`Failed: ${e.message}`),
  });
}

export function useUpsertLesson(courseId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (lesson: Partial<CourseLessonRow>) =>
      upsertLesson({
        ...lesson,
        user_id: user!.id,
        course_import_id: courseId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course-lessons', courseId] });
    },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });
}

export function useBulkInsertLessons(courseId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (lessons: Partial<CourseLessonRow>[]) =>
      bulkInsertLessons(
        lessons.map((l) => ({ ...l, user_id: user!.id, course_import_id: courseId })),
      ),
    onSuccess: (rows) => {
      qc.invalidateQueries({ queryKey: ['course-lessons', courseId] });
      toast.success(`${rows.length} lesson${rows.length === 1 ? '' : 's'} saved`);
    },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });
}

export function useDeleteLesson(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteLesson,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['course-lessons', courseId] }),
    onError: (e: any) => toast.error(`Delete failed: ${e.message}`),
  });
}

export function useDuplicateLesson(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: duplicateLesson,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['course-lessons', courseId] }),
  });
}

export function useMarkCourseReady(courseId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: () => markCourseReadyForProcessing(courseId, user!.id),
    onSuccess: ({ lessonsQueued }) => {
      qc.invalidateQueries({ queryKey: ['course-imports'] });
      qc.invalidateQueries({ queryKey: ['course-import', courseId] });
      qc.invalidateQueries({ queryKey: ['course-lessons', courseId] });
      toast.success(`Course queued for processing — ${lessonsQueued} lesson(s) sent to pipeline`);
    },
    onError: (e: any) => toast.error(`Failed: ${e.message}`),
  });
}
