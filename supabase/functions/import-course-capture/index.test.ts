/**
 * Tests for import-course-capture: Zod schema, quality-gate, normalizer.
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyLessonContent, normalizeLessons } from "./index.ts";

Deno.test("classifyLessonContent: rich text → usable", () => {
  const q = classifyLessonContent({ body_text: "This is a real lesson about discovery techniques. ".repeat(10) });
  assertEquals(q.content_type, "text");
  assertEquals(q.usable_content, true);
  assertEquals(q.metadata_only, false);
});

Deno.test("classifyLessonContent: empty → blocked", () => {
  const q = classifyLessonContent({});
  assertEquals(q.content_type, "empty");
  assertEquals(q.usable_content, false);
});

Deno.test("classifyLessonContent: login wall → login_page, not usable", () => {
  const q = classifyLessonContent({ body_text: 'You must log in to continue' });
  assertEquals(q.content_type, "login_page");
  assertEquals(q.has_login_wall, true);
  assertEquals(q.usable_content, false);
});

Deno.test("classifyLessonContent: video-only without transcript → metadata_only", () => {
  const q = classifyLessonContent({ body_text: "Watch the video", media_url: "https://wistia.com/abc" });
  assertEquals(q.content_type, "video_only");
  assertEquals(q.metadata_only, true);
});

Deno.test("classifyLessonContent: video-only WITH transcript → usable, not metadata_only", () => {
  const transcript = "Welcome to this lesson on cold calling. We will cover openers and objections in detail. ".repeat(8);
  const q = classifyLessonContent({ body_text: "Watch the video", media_url: "https://wistia.com/abc", transcript });
  assertEquals(q.metadata_only, false);
  assertEquals(q.usable_content, true);
});

Deno.test("normalizeLessons: rejects empty + accepts good + flags video_only", () => {
  const debug: string[] = [];
  const out = normalizeLessons({
    mode: 'capture',
    source_url: 'https://30mpc.circle.so/c/x',
    platform: 'circle',
    title: 'Course',
    lessons: [
      { url: 'https://x.so/c/x/lessons/1', title: 'Intro', body_text: 'A real intro lesson body. '.repeat(20) },
      { url: 'https://x.so/c/x/lessons/2', title: 'Empty' },
      { url: 'https://x.so/c/x/lessons/3', title: 'Video', media_url: 'https://wistia.com/v', body_text: 'Watch' },
    ],
  }, debug);
  assertEquals(out.length, 3);
  assertEquals(out[0].imported, true);
  assertEquals(out[1].imported, false);
  assertEquals(out[1].reject_reason !== undefined, true);
  assertEquals(out[2].quality.metadata_only, true);
  assert(out[2].imported, 'video_only should still be imported as metadata');
});
