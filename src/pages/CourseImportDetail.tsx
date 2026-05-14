import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  useCourseImport,
  useCourseLessons,
  useUpdateCourseImport,
  useUpsertLesson,
  useDeleteLesson,
  useDuplicateLesson,
  useBulkInsertLessons,
  useMarkCourseReady,
} from '@/hooks/useCourseImports';
import type { CourseLessonRow, ResourceLink, AttachmentRef } from '@/data/courseImports';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  ArrowLeft, ChevronDown, ChevronRight, Plus, Trash2, Copy, AlertTriangle, Download, CheckCircle2, Sparkles,
} from 'lucide-react';
import { parseCourseMarkdown } from '@/lib/courseMarkdownParser';
import { toast } from 'sonner';

export default function CourseImportDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: course, isLoading } = useCourseImport(id);
  const { data: lessons = [] } = useCourseLessons(id);
  const updateCourse = useUpdateCourseImport();
  const upsert = useUpsertLesson(id!);
  const del = useDeleteLesson(id!);
  const dup = useDuplicateLesson(id!);
  const markReady = useMarkCourseReady(id!);

  if (isLoading || !course) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }

  const completeCount = lessons.filter((l) => l.status === 'complete' || l.status === 'ready_for_processing').length;
  const resourceCount = lessons.reduce((n, l) => n + (l.resource_links?.length || 0) + (l.attachment_refs?.length || 0), 0);

  return (
    <div className="container max-w-6xl mx-auto p-4 md:p-6 space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/course-import')}><ArrowLeft className="h-4 w-4" /> All courses</Button>

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <CardTitle>{course.course_name}</CardTitle>
              <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground items-center">
                {course.course_authors && <span>by {course.course_authors}</span>}
                {course.course_platform && <Badge variant="outline">{course.course_platform}</Badge>}
                {course.course_category && <Badge variant="outline">{course.course_category}</Badge>}
                <Badge>{course.status}</Badge>
                <span>{lessons.length} lesson{lessons.length === 1 ? '' : 's'}</span>
                <span>· {completeCount} complete</span>
                <span>· {resourceCount} resource{resourceCount === 1 ? '' : 's'}</span>
              </div>
            </div>
            <Button
              onClick={() => markReady.mutate()}
              disabled={markReady.isPending || lessons.length === 0 || course.status === 'ready_for_processing' || course.status === 'processed'}
            >
              <Sparkles className="h-4 w-4" />
              {course.status === 'ready_for_processing' ? 'Queued for processing' : 'Mark ready for processing'}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="lessons">
        <TabsList>
          <TabsTrigger value="lessons">Lessons</TabsTrigger>
          <TabsTrigger value="bulk">Bulk Paste</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>

        <TabsContent value="lessons" className="space-y-3">
          <LessonsTab
            lessons={lessons}
            onAdd={() => upsert.mutate({ lesson_number: lessons.length + 1, lesson_name: 'Untitled lesson' })}
            onSave={(l) => upsert.mutate(l)}
            onDelete={(id) => del.mutate(id)}
            onDuplicate={(id) => dup.mutate(id)}
          />
        </TabsContent>

        <TabsContent value="bulk">
          <BulkPasteTab courseId={id!} existingCount={lessons.length} onCourseUpdate={(patch) => updateCourse.mutate({ id: id!, patch })} />
        </TabsContent>

        <TabsContent value="resources">
          <ResourcesTab lessons={lessons} />
        </TabsContent>

        <TabsContent value="export">
          <ExportTab course={course} lessons={lessons} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Lessons tab ────────────────────────────────────────────────
function LessonsTab({
  lessons, onAdd, onSave, onDelete, onDuplicate,
}: {
  lessons: CourseLessonRow[];
  onAdd: () => void;
  onSave: (l: Partial<CourseLessonRow>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [allOpen, setAllOpen] = useState(false);

  const filtered = useMemo(() => {
    return lessons.filter((l) => {
      const matchesSearch = !search || (l.lesson_name || '').toLowerCase().includes(search.toLowerCase()) || (l.section_name || '').toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || l.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [lessons, search, statusFilter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Search lessons…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <select className="h-10 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="complete">Complete</option>
          <option value="missing_transcript">Missing transcript</option>
          <option value="missing_lesson_text">Missing lesson text</option>
          <option value="missing_resources">Missing resources</option>
          <option value="ready_for_processing">Ready</option>
        </select>
        <Button variant="outline" size="sm" onClick={() => setAllOpen((v) => !v)}>{allOpen ? 'Collapse all' : 'Expand all'}</Button>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={onAdd}><Plus className="h-4 w-4" /> Add lesson</Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No lessons match.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((l) => (
            <LessonCard
              key={l.id}
              lesson={l}
              forceOpen={allOpen}
              onSave={onSave}
              onDelete={() => { if (confirm('Delete this lesson?')) onDelete(l.id); }}
              onDuplicate={() => onDuplicate(l.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LessonCard({
  lesson, forceOpen, onSave, onDelete, onDuplicate,
}: {
  lesson: CourseLessonRow;
  forceOpen: boolean;
  onSave: (l: Partial<CourseLessonRow>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const isOpen = forceOpen || open;

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setOpen}>
        <div className="flex items-center justify-between gap-2 p-3">
          <CollapsibleTrigger asChild>
            <button className="flex items-start gap-2 min-w-0 flex-1 text-left">
              {isOpen ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">
                  {lesson.lesson_number != null && <span className="text-muted-foreground mr-1">{lesson.lesson_number}.</span>}
                  {lesson.lesson_name || 'Untitled'}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
                  {lesson.section_name && <Badge variant="outline">{lesson.section_name}</Badge>}
                  <StatusBadge status={lesson.status} />
                  {lesson.missing_fields?.length > 0 && (
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" /> Missing: {lesson.missing_fields.join(', ')}
                    </span>
                  )}
                </div>
              </div>
            </button>
          </CollapsibleTrigger>
          <div className="flex gap-1 shrink-0">
            <Button size="sm" variant="ghost" onClick={() => { setOpen(true); setEditing((v) => !v); }}>{editing ? 'Cancel' : 'Edit'}</Button>
            <Button size="icon" variant="ghost" onClick={onDuplicate}><Copy className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>

        <CollapsibleContent>
          <CardContent className="border-t pt-4">
            {editing ? (
              <LessonEditor lesson={lesson} onSave={(patch) => { onSave({ id: lesson.id, ...patch }); setEditing(false); }} onCancel={() => setEditing(false)} />
            ) : (
              <LessonView lesson={lesson} />
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    complete: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    ready_for_processing: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
    draft: 'bg-muted text-muted-foreground',
  };
  const cls = tone[status] || 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20';
  return <Badge variant="outline" className={cls}>{status.replace(/_/g, ' ')}</Badge>;
}

function LessonView({ lesson }: { lesson: CourseLessonRow }) {
  return (
    <div className="space-y-3 text-sm">
      {lesson.lesson_url && <div><span className="text-muted-foreground">URL: </span><a href={lesson.lesson_url} target="_blank" rel="noreferrer" className="text-primary underline break-all">{lesson.lesson_url}</a></div>}
      {lesson.lesson_text && (<div><div className="font-medium mb-1">Lesson text</div><div className="whitespace-pre-wrap text-muted-foreground line-clamp-6">{lesson.lesson_text}</div></div>)}
      {lesson.transcript_text && (<div><div className="font-medium mb-1">Transcript</div><div className="whitespace-pre-wrap text-muted-foreground line-clamp-6">{lesson.transcript_text}</div></div>)}
      {lesson.resource_links?.length > 0 && (
        <div>
          <div className="font-medium mb-1">Resources</div>
          <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
            {lesson.resource_links.map((r, i) => <li key={i}>{r.name || '(unnamed)'} {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-primary underline ml-1">link</a>}</li>)}
          </ul>
        </div>
      )}
      {lesson.user_notes && (<div><div className="font-medium mb-1">My notes</div><div className="whitespace-pre-wrap text-muted-foreground">{lesson.user_notes}</div></div>)}
    </div>
  );
}

function LessonEditor({ lesson, onSave, onCancel }: { lesson: CourseLessonRow; onSave: (patch: Partial<CourseLessonRow>) => void; onCancel: () => void; }) {
  const [form, setForm] = useState({
    lesson_number: lesson.lesson_number ?? 0,
    lesson_name: lesson.lesson_name ?? '',
    section_name: lesson.section_name ?? '',
    lesson_url: lesson.lesson_url ?? '',
    transcript_text: lesson.transcript_text ?? '',
    lesson_text: lesson.lesson_text ?? '',
    user_notes: lesson.user_notes ?? '',
    resource_links: lesson.resource_links || [],
    attachment_refs: lesson.attachment_refs || [],
  });

  const updateRes = (i: number, patch: Partial<ResourceLink>) => {
    const next = [...form.resource_links];
    next[i] = { ...next[i], ...patch };
    setForm({ ...form, resource_links: next });
  };
  const addRes = () => setForm({ ...form, resource_links: [...form.resource_links, { name: '', url: '' }] });
  const rmRes = (i: number) => setForm({ ...form, resource_links: form.resource_links.filter((_, idx) => idx !== i) });

  const updateAtt = (i: number, patch: Partial<AttachmentRef>) => {
    const next = [...form.attachment_refs];
    next[i] = { ...next[i], ...patch };
    setForm({ ...form, attachment_refs: next });
  };
  const addAtt = () => setForm({ ...form, attachment_refs: [...form.attachment_refs, { file_name: '', file_url: '' }] });
  const rmAtt = (i: number) => setForm({ ...form, attachment_refs: form.attachment_refs.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-3 text-sm">
      <div className="grid md:grid-cols-3 gap-3">
        <div><Label>Lesson #</Label><Input type="number" value={form.lesson_number} onChange={(e) => setForm({ ...form, lesson_number: parseInt(e.target.value || '0', 10) })} /></div>
        <div className="md:col-span-2"><Label>Lesson Name</Label><Input value={form.lesson_name} onChange={(e) => setForm({ ...form, lesson_name: e.target.value })} /></div>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div><Label>Section / Module</Label><Input value={form.section_name} onChange={(e) => setForm({ ...form, section_name: e.target.value })} /></div>
        <div><Label>Lesson URL</Label><Input value={form.lesson_url} onChange={(e) => setForm({ ...form, lesson_url: e.target.value })} /></div>
      </div>
      <div><Label>Lesson Text / Notes</Label><Textarea rows={6} value={form.lesson_text} onChange={(e) => setForm({ ...form, lesson_text: e.target.value })} /></div>
      <div><Label>Transcript</Label><Textarea rows={8} value={form.transcript_text} onChange={(e) => setForm({ ...form, transcript_text: e.target.value })} /></div>

      <div>
        <div className="flex items-center justify-between mb-1"><Label>Resource Links</Label><Button size="sm" variant="outline" onClick={addRes}><Plus className="h-3 w-3" /> Add</Button></div>
        {form.resource_links.length === 0 && <p className="text-muted-foreground text-xs">None</p>}
        <div className="space-y-2">
          {form.resource_links.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start">
              <Input className="col-span-3" placeholder="Name" value={r.name || ''} onChange={(e) => updateRes(i, { name: e.target.value })} />
              <Input className="col-span-5" placeholder="URL" value={r.url || ''} onChange={(e) => updateRes(i, { url: e.target.value })} />
              <Input className="col-span-3" placeholder="Notes" value={r.notes || ''} onChange={(e) => updateRes(i, { notes: e.target.value })} />
              <Button className="col-span-1" size="icon" variant="ghost" onClick={() => rmRes(i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1"><Label>Attachments</Label><Button size="sm" variant="outline" onClick={addAtt}><Plus className="h-3 w-3" /> Add</Button></div>
        {form.attachment_refs.length === 0 && <p className="text-muted-foreground text-xs">None</p>}
        <div className="space-y-2">
          {form.attachment_refs.map((a, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start">
              <Input className="col-span-3" placeholder="File name" value={a.file_name || ''} onChange={(e) => updateAtt(i, { file_name: e.target.value })} />
              <Input className="col-span-2" placeholder="Type (pdf…)" value={a.file_type || ''} onChange={(e) => updateAtt(i, { file_type: e.target.value })} />
              <Input className="col-span-4" placeholder="URL / reference" value={a.file_url || ''} onChange={(e) => updateAtt(i, { file_url: e.target.value })} />
              <Input className="col-span-2" placeholder="Notes" value={a.notes || ''} onChange={(e) => updateAtt(i, { notes: e.target.value })} />
              <Button className="col-span-1" size="icon" variant="ghost" onClick={() => rmAtt(i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      </div>

      <div><Label>My Notes</Label><Textarea rows={3} value={form.user_notes} onChange={(e) => setForm({ ...form, user_notes: e.target.value })} /></div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSave(form)}><CheckCircle2 className="h-4 w-4" /> Save</Button>
      </div>
    </div>
  );
}

// ── Bulk paste tab ────────────────────────────────────────────
function BulkPasteTab({ courseId, existingCount, onCourseUpdate }: { courseId: string; existingCount: number; onCourseUpdate: (patch: any) => void; }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ReturnType<typeof parseCourseMarkdown> | null>(null);
  const bulk = useBulkInsertLessons(courseId);

  const handleParse = () => {
    const result = parseCourseMarkdown(text);
    setParsed(result);
    if (result.lessons.length === 0) toast.error('No lessons detected. Use "## Lesson N" headers.');
    else toast.success(`Parsed ${result.lessons.length} lesson(s)`);
  };

  const handleSave = async () => {
    if (!parsed) return;
    // Update course header fields if any
    const courseFieldsPresent = Object.values(parsed.course).some(Boolean);
    if (courseFieldsPresent) {
      const patch: any = {};
      Object.entries(parsed.course).forEach(([k, v]) => { if (v) patch[k] = v; });
      onCourseUpdate(patch);
    }
    const offset = existingCount;
    await bulk.mutateAsync(
      parsed.lessons.map((l, idx) => ({
        lesson_number: l.lesson_number ?? offset + idx + 1,
        lesson_name: l.lesson_name,
        section_name: l.section_name,
        lesson_url: l.lesson_url,
        transcript_text: l.transcript_text,
        lesson_text: l.lesson_text,
        resource_links: l.resource_links,
        user_notes: l.user_notes,
        raw_source_text: l.raw_source_text,
      })),
    );
    setText('');
    setParsed(null);
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div>
            <Label>Paste course markdown</Label>
            <Textarea
              rows={14}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Course Name: ...\nCourse Author(s): ...\n---\n## Lesson 1\nLesson Name: ...\nSection / Module: ...\n### Transcript\n...\n### Lesson Text / Notes\n...\n### Resources / Attachments\n- Resource name: ...\n- Resource URL: ...\n### My Notes\n...`}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleParse} disabled={!text.trim()}>Parse Lessons</Button>
            {parsed && parsed.lessons.length > 0 && (
              <Button onClick={handleSave} disabled={bulk.isPending}><CheckCircle2 className="h-4 w-4" /> Save {parsed.lessons.length} lesson(s)</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {parsed && parsed.lessons.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Preview ({parsed.lessons.length} lessons)</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-auto">
              {parsed.lessons.map((l, i) => (
                <div key={i} className="text-sm border rounded p-2">
                  <div className="font-medium">{l.lesson_number}. {l.lesson_name}</div>
                  {l.section_name && <div className="text-xs text-muted-foreground">{l.section_name}</div>}
                  <div className="flex flex-wrap gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">{l.transcript_text ? `Transcript ✓ (${l.transcript_text.length} chars)` : 'No transcript'}</Badge>
                    <Badge variant="outline" className="text-xs">{l.lesson_text ? `Lesson text ✓` : 'No lesson text'}</Badge>
                    <Badge variant="outline" className="text-xs">{l.resource_links.length} resource(s)</Badge>
                  </div>
                  {l.warnings.length > 0 && <div className="text-xs text-amber-600 mt-1">⚠ {l.warnings.join(' · ')}</div>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Resources tab ─────────────────────────────────────────────
function ResourcesTab({ lessons }: { lessons: CourseLessonRow[] }) {
  const rows = lessons.flatMap((l) => [
    ...(l.resource_links || []).map((r) => ({ lesson: l, kind: 'link', name: r.name, url: r.url, type: r.type, notes: r.notes })),
    ...(l.attachment_refs || []).map((a) => ({ lesson: l, kind: 'attachment', name: a.file_name, url: a.file_url, type: a.file_type, notes: a.notes })),
  ]);
  if (rows.length === 0) return <Card><CardContent className="py-8 text-center text-muted-foreground">No resources yet.</CardContent></Card>;
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Lesson</TableHead><TableHead>Resource</TableHead><TableHead>Type</TableHead><TableHead>URL</TableHead><TableHead>Notes</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="text-xs">{r.lesson.lesson_number}. {r.lesson.lesson_name}</TableCell>
                <TableCell>{r.name || '—'}</TableCell>
                <TableCell><Badge variant="outline">{r.type || r.kind}</Badge></TableCell>
                <TableCell className="max-w-xs truncate">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="text-primary underline">{r.url}</a> : '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.notes || ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Export tab ────────────────────────────────────────────────
function ExportTab({ course, lessons }: { course: any; lessons: CourseLessonRow[] }) {
  const download = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const slug = (course.course_name || 'course').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  const exportJSON = () => download(`${slug}.json`, JSON.stringify({ course, lessons }, null, 2), 'application/json');

  const exportMarkdown = () => {
    const lines: string[] = [`# ${course.course_name}`, ''];
    if (course.course_authors) lines.push(`Course Author(s): ${course.course_authors}`);
    if (course.course_platform) lines.push(`Course Platform: ${course.course_platform}`);
    if (course.course_url) lines.push(`Course URL: ${course.course_url}`);
    if (course.course_category) lines.push(`Course Category: ${course.course_category}`);
    if (course.primary_use_case) lines.push(`Primary Use Case: ${course.primary_use_case}`);
    lines.push('', '---', '');
    for (const l of lessons) {
      lines.push(`## Lesson ${l.lesson_number ?? ''}`.trim() + (l.lesson_name ? `: ${l.lesson_name}` : ''));
      if (l.section_name) lines.push(`Section / Module: ${l.section_name}`);
      if (l.lesson_url) lines.push(`Lesson URL: ${l.lesson_url}`);
      if (l.transcript_text) { lines.push('', '### Transcript', '', l.transcript_text); }
      if (l.lesson_text) { lines.push('', '### Lesson Text / Notes', '', l.lesson_text); }
      if (l.resource_links?.length) {
        lines.push('', '### Resources / Attachments');
        l.resource_links.forEach((r) => {
          lines.push(`- Resource name: ${r.name || ''}`);
          if (r.url) lines.push(`  - Resource URL: ${r.url}`);
          if (r.notes) lines.push(`  - Notes: ${r.notes}`);
        });
      }
      if (l.user_notes) { lines.push('', '### My Notes', '', l.user_notes); }
      lines.push('', '---', '');
    }
    download(`${slug}.md`, lines.join('\n'), 'text/markdown');
  };

  const csvEscape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const exportLessonsCSV = () => {
    const headers = ['lesson_number', 'lesson_name', 'section_name', 'lesson_url', 'transcript_text', 'lesson_text', 'user_notes', 'status'];
    const rows = [headers.join(',')].concat(
      lessons.map((l) => headers.map((h) => csvEscape((l as any)[h])).join(',')),
    );
    download(`${slug}-lessons.csv`, rows.join('\n'), 'text/csv');
  };

  const exportResourcesCSV = () => {
    const headers = ['lesson_number', 'lesson_name', 'kind', 'name', 'type', 'url', 'notes'];
    const rows: string[] = [headers.join(',')];
    for (const l of lessons) {
      for (const r of l.resource_links || []) rows.push([l.lesson_number, l.lesson_name, 'link', r.name, r.type, r.url, r.notes].map(csvEscape).join(','));
      for (const a of l.attachment_refs || []) rows.push([l.lesson_number, l.lesson_name, 'attachment', a.file_name, a.file_type, a.file_url, a.notes].map(csvEscape).join(','));
    }
    download(`${slug}-resources.csv`, rows.join('\n'), 'text/csv');
  };

  return (
    <Card>
      <CardContent className="pt-4 space-y-2">
        <p className="text-sm text-muted-foreground mb-2">Export the raw course content for backup or processing elsewhere.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportJSON}><Download className="h-4 w-4" /> JSON</Button>
          <Button variant="outline" onClick={exportMarkdown}><Download className="h-4 w-4" /> Markdown</Button>
          <Button variant="outline" onClick={exportLessonsCSV}><Download className="h-4 w-4" /> Lessons CSV</Button>
          <Button variant="outline" onClick={exportResourcesCSV}><Download className="h-4 w-4" /> Resources CSV</Button>
        </div>
      </CardContent>
    </Card>
  );
}
