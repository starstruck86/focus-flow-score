/**
 * Unit tests for the Circle.so importer.
 *
 * These tests cover detection, login-redirect classification, the auth-wall
 * error path, and curriculum extraction from embedded JSON / anchors. They run
 * fully offline (no network) by exercising the pure helpers that take HTML in
 * directly.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isCircleUrl,
  extractCircleLessons,
  circleLogin,
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

Deno.test("circleLogin: returns no_credentials when none provided & none in env", async () => {
  // Make sure env is empty for the duration of this test
  const origEmail = Deno.env.get("COURSE_PLATFORM_EMAIL");
  const origPwd = Deno.env.get("COURSE_PLATFORM_PASSWORD");
  Deno.env.delete("COURSE_PLATFORM_EMAIL");
  Deno.env.delete("COURSE_PLATFORM_PASSWORD");
  try {
    const res = await circleLogin("30mpc.circle.so", undefined);
    assertEquals(res.success, false);
    assertEquals(res.failure, "no_credentials");
    assert(res.failureMessage?.toLowerCase().includes("circle"));
  } finally {
    if (origEmail) Deno.env.set("COURSE_PLATFORM_EMAIL", origEmail);
    if (origPwd) Deno.env.set("COURSE_PLATFORM_PASSWORD", origPwd);
  }
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

Deno.test("extractCircleLessons: parses __NEXT_DATA__ JSON for lessons", () => {
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
  const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
  const debug: string[] = [];
  const lessons = extractCircleLessons(html, "https://30mpc.circle.so/c/cold-calling-tactics/", debug);
  assert(lessons.length >= 2, `expected ≥2 lessons, got ${lessons.length}`);
});

Deno.test("extractCircleLessons: returns empty array (not throw) for empty HTML", () => {
  const debug: string[] = [];
  const lessons = extractCircleLessons("", "https://30mpc.circle.so/c/foo/", debug);
  assertEquals(lessons, []);
});
