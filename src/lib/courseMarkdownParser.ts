/**
 * Parser for the Manual Course Import bulk-paste markdown format.
 * Tolerant: missing fields are allowed; lessons are detected dynamically.
 */
import type { ResourceLink } from '@/data/courseImports';

export interface ParsedCourse {
  course: {
    course_name?: string;
    course_authors?: string;
    course_platform?: string;
    course_url?: string;
    course_category?: string;
    primary_use_case?: string;
    notes?: string;
  };
  lessons: ParsedLesson[];
}

export interface ParsedLesson {
  lesson_number: number;
  lesson_name?: string;
  section_name?: string;
  lesson_url?: string;
  transcript_text?: string;
  lesson_text?: string;
  resource_links: ResourceLink[];
  user_notes?: string;
  raw_source_text: string;
  warnings: string[];
}

const LESSON_HEADER = /^##\s+(?:lesson\s*[:\-]?\s*)?(?:module\s+\d+\s*[—\-:]\s*lesson\s+)?(\d+)?\.?\s*(.*)$/i;
const LESSON_HEADER_FALLBACK = /^##\s+(.+)$/;

function isLessonHeader(line: string): boolean {
  if (!/^##\s+/.test(line)) return false;
  if (/^###/.test(line)) return false;
  // Heuristic: top-level "## " is treated as a lesson boundary
  return true;
}

function parseHeaderLine(line: string): { number?: number; title: string } {
  const m = line.match(LESSON_HEADER);
  if (m) {
    const num = m[1] ? parseInt(m[1], 10) : undefined;
    let title = (m[2] || '').trim();
    if (title.startsWith(':') || title.startsWith('-') || title.startsWith('—')) {
      title = title.slice(1).trim();
    }
    if (!title) title = `Lesson ${num ?? ''}`.trim();
    return { number: Number.isFinite(num as number) ? num : undefined, title };
  }
  const fb = line.match(LESSON_HEADER_FALLBACK);
  return { title: fb ? fb[1].trim() : line.replace(/^#+/, '').trim() };
}

const FIELD_REGEX = /^([A-Za-z][A-Za-z /()]*?)\s*:\s*(.*)$/;

function parseKeyValue(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(FIELD_REGEX);
    if (m) {
      const key = m[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      out[key] = m[2].trim();
    }
  }
  return out;
}

function parseResources(block: string): ResourceLink[] {
  const lines = block.split(/\r?\n/);
  const resources: ResourceLink[] = [];
  let current: ResourceLink | null = null;
  const flush = () => {
    if (current && (current.name || current.url || current.notes)) resources.push(current);
    current = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const content = bullet ? bullet[1] : line;
    const kv = content.match(FIELD_REGEX);
    if (kv) {
      const key = kv[1].trim().toLowerCase();
      const val = kv[2].trim();
      if (key.startsWith('resource name') || key === 'name' || key === 'title') {
        flush();
        current = { name: val };
      } else if (key.includes('url') || key === 'link') {
        if (!current) current = {};
        current.url = val;
      } else if (key.includes('type')) {
        if (!current) current = {};
        current.type = val;
      } else if (key.startsWith('note')) {
        if (!current) current = {};
        current.notes = val;
      }
    } else if (bullet) {
      // A plain bullet — treat as standalone resource name
      flush();
      current = { name: content };
    }
  }
  flush();
  return resources;
}

const SUBSECTION_RE = /^###\s+(.+?)\s*$/i;

function classifySubsection(title: string): 'transcript' | 'lesson_text' | 'resources' | 'notes' | null {
  const t = title.toLowerCase();
  if (t.includes('transcript')) return 'transcript';
  if (t.includes('lesson text') || t.includes('notes') && !t.includes('my')) {
    if (t.includes('lesson')) return 'lesson_text';
  }
  if (t.includes('lesson')) return 'lesson_text';
  if (t.includes('resource') || t.includes('attachment')) return 'resources';
  if (t.includes('my note')) return 'notes';
  return null;
}

export function parseCourseMarkdown(input: string): ParsedCourse {
  const text = input.replace(/\r\n/g, '\n').trim();
  if (!text) return { course: {}, lessons: [] };

  const lines = text.split('\n');

  // Find lesson header indices
  const lessonStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isLessonHeader(lines[i])) lessonStarts.push(i);
  }

  // Course preamble = everything before the first lesson header (skip H1)
  const preambleEnd = lessonStarts.length > 0 ? lessonStarts[0] : lines.length;
  const preamble = lines
    .slice(0, preambleEnd)
    .filter((l) => !/^#\s+/.test(l) && !/^---\s*$/.test(l))
    .join('\n');
  const courseFields = parseKeyValue(preamble);
  const course = {
    course_name: courseFields.course_name,
    course_authors: courseFields.course_authors || courseFields.course_author,
    course_platform: courseFields.course_platform || courseFields.platform,
    course_url: courseFields.course_url || courseFields.url,
    course_category: courseFields.course_category || courseFields.category,
    primary_use_case: courseFields.primary_use_case || courseFields.use_case,
    notes: courseFields.notes,
  };

  const lessons: ParsedLesson[] = [];
  for (let i = 0; i < lessonStarts.length; i++) {
    const start = lessonStarts[i];
    const end = i + 1 < lessonStarts.length ? lessonStarts[i + 1] : lines.length;
    const block = lines.slice(start, end);
    const headerLine = block[0];
    const { number, title } = parseHeaderLine(headerLine);

    // Body = lines after header, stripping trailing horizontal rules
    const body = block
      .slice(1)
      .filter((l) => !/^---\s*$/.test(l));

    // Split body into front-matter (key: value lines until first ###) and subsections
    let firstSubsection = body.findIndex((l) => SUBSECTION_RE.test(l));
    if (firstSubsection === -1) firstSubsection = body.length;
    const frontMatter = body.slice(0, firstSubsection).join('\n');
    const fmFields = parseKeyValue(frontMatter);

    const subsections: { kind: ReturnType<typeof classifySubsection>; content: string }[] = [];
    let currentKind: ReturnType<typeof classifySubsection> = null;
    let currentBuf: string[] = [];
    const flushSub = () => {
      if (currentKind) subsections.push({ kind: currentKind, content: currentBuf.join('\n').trim() });
      currentBuf = [];
    };
    for (let j = firstSubsection; j < body.length; j++) {
      const line = body[j];
      const m = line.match(SUBSECTION_RE);
      if (m) {
        flushSub();
        currentKind = classifySubsection(m[1]);
      } else {
        currentBuf.push(line);
      }
    }
    flushSub();

    const lesson: ParsedLesson = {
      lesson_number: number ?? i + 1,
      lesson_name: fmFields.lesson_name || title || `Lesson ${i + 1}`,
      section_name: fmFields.section || fmFields.section_module || fmFields.module,
      lesson_url: fmFields.lesson_url || fmFields.url,
      transcript_text: subsections.find((s) => s.kind === 'transcript')?.content,
      lesson_text: subsections.find((s) => s.kind === 'lesson_text')?.content,
      resource_links: parseResources(
        subsections.find((s) => s.kind === 'resources')?.content || '',
      ),
      user_notes: subsections.find((s) => s.kind === 'notes')?.content,
      raw_source_text: block.join('\n'),
      warnings: [],
    };

    if (!lesson.transcript_text) lesson.warnings.push('Missing transcript');
    if (!lesson.lesson_text) lesson.warnings.push('Missing lesson text');
    if (!lesson.resource_links.length) lesson.warnings.push('No resources');

    lessons.push(lesson);
  }

  return { course, lessons };
}
