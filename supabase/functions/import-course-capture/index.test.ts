/**
 * Tests for import-course-capture: Zod schema, quality-gate, normalizer.
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyLessonContent, normalizeLessons, normalizeLessonUrl, dedupeLessons } from "./index.ts";

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

Deno.test("normalizeLessonUrl: strips hash + trailing slash + lowercases host", () => {
  assertEquals(
    normalizeLessonUrl("https://30MPC.circle.so/c/x/lessons/1/#section"),
    "https://30mpc.circle.so/c/x/lessons/1",
  );
  assertEquals(
    normalizeLessonUrl("https://x.so/a/"),
    "https://x.so/a",
  );
  assertEquals(normalizeLessonUrl(""), "");
});

Deno.test("dedupeLessons: collapses by normalized URL and keeps richer lesson", () => {
  const debug: string[] = [];
  const out = dedupeLessons(
    [
      { url: "https://x.so/c/x/lessons/1/#a", title: "Intro" },
      { url: "https://X.so/c/x/lessons/1", title: "Intro v2", body_text: "Real body content here." },
      { url: "https://x.so/c/x/lessons/1#b", title: "Intro v3", transcript: "A transcript wins all." },
      { url: "https://x.so/c/x/lessons/2", title: "Other", media_url: "https://wistia.com/v" },
    ],
    debug,
  );
  assertEquals(out.length, 2);
  const lesson1 = out.find(l => l.url === "https://x.so/c/x/lessons/1")!;
  assert(lesson1, "lesson 1 should be present under normalized URL");
  assertEquals(lesson1.transcript, "A transcript wins all.");
  // body_text from earlier duplicate should be merged in
  assertEquals(lesson1.body_text, "Real body content here.");
  assert(debug.some(d => /dedupe collapsed/.test(d)), "should log dedupe collisions");
});

Deno.test("dedupeLessons: prefers body_text over media_url-only over title-only", () => {
  const out = dedupeLessons([
    { url: "https://x.so/l/1", title: "Title only" },
    { url: "https://x.so/l/1/", title: "Media only", media_url: "https://wistia.com/v" },
    { url: "https://x.so/l/1#x", title: "Body version", body_text: "An actual body of content." },
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].body_text, "An actual body of content.");
  assertEquals(out[0].media_url, "https://wistia.com/v");
});

Deno.test("normalizeLessons: dedupes before classification", () => {
  const debug: string[] = [];
  const out = normalizeLessons({
    mode: 'capture',
    source_url: 'https://x.so/c/x',
    platform: 'circle',
    title: 'Course',
    lessons: [
      { url: 'https://x.so/c/x/lessons/1', title: 'A', body_text: 'Real body content. '.repeat(20) },
      { url: 'https://x.so/c/x/lessons/1/#frag', title: 'A dup', body_text: 'short' },
      { url: 'https://x.so/c/x/lessons/2', title: 'B', body_text: 'Another real body. '.repeat(20) },
    ],
  }, debug);
  assertEquals(out.length, 2);
});
