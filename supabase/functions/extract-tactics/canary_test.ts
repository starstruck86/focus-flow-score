/**
 * Canary Regression Test Suite — Lesson Detection & KI Extraction
 * 
 * Two layers:
 * 1. ROUTING TESTS (fast, no AI): verify isStructuredLesson logic
 * 2. BENCHMARK TESTS (slow, AI): run via supabase--curl_edge_functions manually
 * 
 * Run: supabase--test_edge_functions with functions: ["extract-tactics"]
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// ── Replicate isStructuredLesson logic from index.ts ──
const LESSON_TRANSCRIPT_MARKER = "--- Video Transcript ---";

function isStructuredLesson(content: string, title?: string, resourceType?: string): boolean {
  const markerIndex = content.indexOf(LESSON_TRANSCRIPT_MARKER);
  if (markerIndex > 500) return true;
  const hasCourseTitle = (title || "").includes(">");
  const isVideoType = ["video", "lesson"].includes((resourceType || "").toLowerCase());
  if (hasCourseTitle && isVideoType && content.length >= 500) return true;
  return false;
}

// ── Canary definitions with inline content signatures ──
// These simulate the key characteristics of each lesson without needing DB access
const ROUTING_CANARIES = [
  {
    label: "short-lesson-no-marker",
    title: "AE Operating System > Cold Call Openers",
    resourceType: "video",
    contentLen: 1854,
    hasMarker: false,
    expectedLesson: true,
  },
  {
    label: "medium-lesson-no-marker (prev failure)",
    title: 'AE Operating System > The "Three Why\'s"',
    resourceType: "video",
    contentLen: 3463,
    hasMarker: false,
    expectedLesson: true,
  },
  {
    label: "medium-long-lesson-no-marker (prev failure)",
    title: "AE Operating System > Dig for Gold - Then Use the Gold",
    resourceType: "video",
    contentLen: 6539,
    hasMarker: false,
    expectedLesson: true,
  },
  {
    label: "long-lesson-no-marker",
    title: "AE Operating System > Discovery Pitfalls (and how to avoid them)",
    resourceType: "video",
    contentLen: 10832,
    hasMarker: false,
    expectedLesson: true,
  },
  {
    label: "lesson-with-marker",
    title: "AE Operating System > Account Scoring",
    resourceType: "video",
    contentLen: 15000,
    hasMarker: true,
    markerPos: 3000,
    expectedLesson: true,
  },
  {
    label: "podcast-not-lesson",
    title: "Sales Introverts Ep 42",
    resourceType: "podcast",
    contentLen: 25000,
    hasMarker: false,
    expectedLesson: false,
  },
  {
    label: "document-not-lesson",
    title: "Challenger Sale Summary",
    resourceType: "document",
    contentLen: 8000,
    hasMarker: false,
    expectedLesson: false,
  },
  {
    label: "short-video-no-course-title",
    title: "Quick Tips on Closing",
    resourceType: "video",
    contentLen: 2000,
    hasMarker: false,
    expectedLesson: false, // video but no ">" in title
  },
  {
    label: "tiny-lesson-below-threshold",
    title: "AE Operating System > Intro",
    resourceType: "video",
    contentLen: 200,
    hasMarker: false,
    expectedLesson: false, // too short (<500 chars)
  },
];

for (const canary of ROUTING_CANARIES) {
  Deno.test({
    name: `[routing] ${canary.label}: detected=${canary.expectedLesson}`,
    fn() {
      // Build fake content of the right length
      let content = "x".repeat(canary.contentLen);
      if (canary.hasMarker && canary.markerPos) {
        content = "x".repeat(canary.markerPos) + LESSON_TRANSCRIPT_MARKER + "x".repeat(canary.contentLen - canary.markerPos - LESSON_TRANSCRIPT_MARKER.length);
      }

      const result = isStructuredLesson(content, canary.title, canary.resourceType);
      assert(
        result === canary.expectedLesson,
        `${canary.label}: expected isStructuredLesson=${canary.expectedLesson}, got ${result}`
      );
    },
  });
}

// ── Benchmark canary IDs and thresholds (for manual curl testing) ──
// These are exported so they can be referenced from CI or manual test scripts
export const BENCHMARK_CANARIES = [
  {
    id: "52981fd2-b8c4-4c09-8472-e8542d40555c",
    title: "AE Operating System > Cold Call Openers",
    min_kis: 3,
    content_chars: 1854,
  },
  {
    id: "b99680d2-b2f2-4fc7-a068-9af43ad66510",
    title: 'AE Operating System > The "Three Why\'s"',
    min_kis: 5,
    content_chars: 3463,
  },
  {
    id: "c4fff21a-ee9e-4f25-8d1e-4f685cb7e5cf",
    title: "AE Operating System > Dig for Gold - Then Use the Gold",
    min_kis: 8,
    content_chars: 6539,
  },
  {
    id: "f04654a6-5934-4e78-8fbb-3a87de79fa17",
    title: "AE Operating System > Discovery Pitfalls (and how to avoid them)",
    min_kis: 10,
    content_chars: 10832,
  },
  {
    id: "cf6e1a9f-ecf7-45f5-86a2-b8df9e9082c6",
    title: "AE Operating System > Identifying Great Companies",
    min_kis: 10,
    content_chars: 12083,
  },
];
