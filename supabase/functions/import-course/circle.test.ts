/**
 * Unit tests for the Circle.so importer.
 *
 * Covers detection, the `needs_browser_capture` envelope returned by
 * discoverCircleCourse(), and offline curriculum extraction from anchors and
 * embedded `__NEXT_DATA__` JSON. Server-side login is intentionally NOT
 * supported anymore — Circle is browser-assisted only.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isCircleUrl,
  extractCircleLessons,
  discoverCircleCourse,
} from "./circle.ts";

Deno.test("isCircleUrl: detects *.circle.so subdomains", () => {
  assertEquals(isCircleUrl("https://30mpc.circle.so/c/cold-calling-tactics/"), true);
  assertEquals(isCircleUrl("https://app.circle.so/c/foo/"), true);
  assertEquals(isCircleUrl("https://login.circle.so/sign_in"), true);
});

Deno.test("isCircleUrl: rejects unrelated domains", () => {
  assertEquals(isCircleUrl("https://learning.outboundsquad.com/c/outbound-masterclass/"), false);
  assertEquals(isCircleUrl("https://example.com/courses/foo"), false);
  assertEquals(isCircleUrl("not a url"), false);
});

Deno.test("discoverCircleCourse: returns needs_browser_capture envelope with capture_hint", async () => {
  const res = await discoverCircleCourse(
    "https://30mpc.circle.so/c/cold-calling-tactics/",
    "https://app.example.com",
  );
  assertEquals(res.success, false);
  assertEquals(res.platform, "circle");
  assertEquals(res.needs_browser_capture, true);
  assertEquals(res.failure_type, "needs_browser_capture");
  assertEquals(res.meta.auth_status, "needs_browser_capture");
  assert(res.capture_hint, "capture_hint must be present");
  assert(
    /\/circle-capture\.js$/.test(res.capture_hint.bookmarklet_url),
    `bookmarklet_url should point at /circle-capture.js, got ${res.capture_hint.bookmarklet_url}`,
  );
  assert(
    /\/functions\/v1\/import-course-capture$/.test(res.capture_hint.capture_endpoint),
    `capture_endpoint should target import-course-capture, got ${res.capture_hint.capture_endpoint}`,
  );
  assert(Array.isArray(res.capture_hint.instructions) && res.capture_hint.instructions.length > 0);
});

Deno.test("discoverCircleCourse: works without an appOrigin (relative URLs)", async () => {
  const res = await discoverCircleCourse("https://30mpc.circle.so/c/discovery-tactics/");
  assertEquals(res.needs_browser_capture, true);
  assertEquals(res.failure_type, "needs_browser_capture");
  assertEquals(res.capture_hint.bookmarklet_url, "/circle-capture.js");
  assertEquals(res.capture_hint.capture_endpoint, "/functions/v1/import-course-capture");
});

Deno.test("extractCircleLessons: pulls anchors that look like lessons", () => {
  const html = `
    <html><body>
      <a href="/c/cold-calling-tactics/lessons/intro">Intro</a>
      <a href="/c/cold-calling-tactics/lessons/objections">Handling Objections</a>
      <a href="/c/cold-calling-tactics/">Course root (skip)</a>
      <a href="https://other.com/c/foo/lessons/x">Other host (skip)</a>
      <a href="/about">About (skip)</a>
    </body></html>
  `;
  const debug: string[] = [];
  const lessons = extractCircleLessons(html, "https://30mpc.circle.so/c/cold-calling-tactics/", debug);
  assertEquals(lessons.length, 2);
  assert(lessons[0].url.startsWith("https://30mpc.circle.so/c/cold-calling-tactics/lessons/"));
});

Deno.test("extractCircleLessons: parses real-shape __NEXT_DATA__ JSON for lessons", () => {
  const data = {
    props: {
      pageProps: {
        course: {
          name: "Cold Calling Tactics",
          lessons: [
            { name: "Intro", url: "/c/cold-calling-tactics/lessons/intro" },
            { title: "Discovery", path: "/c/cold-calling-tactics/lessons/discovery" },
          ],
        },
      },
    },
  };
  // Real Next.js shape: <script id="__NEXT_DATA__" type="application/json">{...}</script>
  const html =
    `<html><body>` +
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>` +
    `</body></html>`;
  const debug: string[] = [];
  const lessons = extractCircleLessons(html, "https://30mpc.circle.so/c/cold-calling-tactics/", debug);
  assert(lessons.length >= 2, `expected ≥2 lessons, got ${lessons.length}`);
});

Deno.test("extractCircleLessons: returns empty array (not throw) for empty HTML", () => {
  const debug: string[] = [];
  const lessons = extractCircleLessons("", "https://30mpc.circle.so/c/foo/", debug);
  assertEquals(lessons, []);
});
