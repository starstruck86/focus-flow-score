import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCourseImportsList, useCreateCourseImport, useDeleteCourseImport } from '@/hooks/useCourseImports';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, BookOpen } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function CourseImports() {
  const { data: courses = [], isLoading } = useCourseImportsList();
  const create = useCreateCourseImport();
  const del = useDeleteCourseImport();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    course_name: '',
    course_authors: '',
    course_platform: '',
    course_url: '',
    course_category: '',
    primary_use_case: '',
    notes: '',
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.course_name.trim()) return;
    const row = await create.mutateAsync(form);
    setOpen(false);
    setForm({ course_name: '', course_authors: '', course_platform: '', course_url: '', course_category: '', primary_use_case: '', notes: '' });
    navigate(`/course-import/${row.id}`);
  };

  return (
    <div className="container max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BookOpen className="h-6 w-6" /> Manual Course Import
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Capture course content lesson-by-lesson. Saved lessons are processed by the existing KI pipeline.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> New Course</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Course</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <Field label="Course Name *" value={form.course_name} onChange={(v) => setForm({ ...form, course_name: v })} required />
              <Field label="Course Author(s)" value={form.course_authors} onChange={(v) => setForm({ ...form, course_authors: v })} />
              <Field label="Course Platform" value={form.course_platform} onChange={(v) => setForm({ ...form, course_platform: v })} placeholder="Circle, Thinkific, Kajabi…" />
              <Field label="Course URL" value={form.course_url} onChange={(v) => setForm({ ...form, course_url: v })} />
              <Field label="Course Category" value={form.course_category} onChange={(v) => setForm({ ...form, course_category: v })} />
              <Field label="Primary Use Case" value={form.primary_use_case} onChange={(v) => setForm({ ...form, primary_use_case: v })} />
              <div>
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={create.isPending}>Create</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : courses.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No courses yet. Click "New Course" to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {courses.map((c) => (
            <Card key={c.id} className="cursor-pointer hover:bg-accent/30 transition" onClick={() => navigate(`/course-import/${c.id}`)}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="space-y-1 min-w-0 flex-1">
                  <CardTitle className="text-base truncate">{c.course_name}</CardTitle>
                  <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground">
                    {c.course_platform && <Badge variant="outline">{c.course_platform}</Badge>}
                    {c.course_category && <Badge variant="outline">{c.course_category}</Badge>}
                    <Badge>{c.status}</Badge>
                    <span>Updated {formatDistanceToNow(new Date(c.updated_at), { addSuffix: true })}</span>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${c.course_name}" and all its lessons?`)) del.mutate(c.id);
                  }}
                ><Trash2 className="h-4 w-4" /></Button>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} required={required} />
    </div>
  );
}
