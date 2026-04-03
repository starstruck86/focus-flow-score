/**
 * Canary Regression Test Suite — Lesson KI Extraction
 * 
 * Tests 5 real lessons against the batch-extract-kis endpoint in benchmarkMode
 * to guarantee minimum KI yields and correct pipeline routing.
 * 
 * Run: supabase--test_edge_functions with functions: ["extract-tactics"]
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;

// ── Canary lesson definitions ──
// Each canary has an expected minimum KI count based on content density.
// Rule of thumb: min_kis ≈ max(3, floor(content_chars / 700))
// These are conservative floors — a healthy pipeline should exceed them.
const CANARY_LESSONS = [
  {
    id: "52981fd2-b8c4-4c09-8472-e8542d40555c",
    title: "AE Operating System > Cold Call Openers",
    min_kis: 3,
    label: "short-lesson",
  },
  {
    id: "b99680d2-b2f2-4fc7-a068-9af43ad66510",
    title: 'AE Operating System > The "Three Why\'s"',
    min_kis: 5,
    label: "medium-lesson-prev-failure",
  },
  {
    id: "c4fff21a-ee9e-4f25-8d1e-4f685cb7e5cf",
    title: "AE Operating System > Dig for Gold - Then Use the Gold",
    min_kis: 8,
    label: "medium-long-lesson-prev-failure",
  },
  {
    id: "f04654a6-5934-4e78-8fbb-3a87de79fa17",
    title: "AE Operating System > Discovery Pitfalls (and how to avoid them)",
    min_kis: 10,
    label: "long-lesson",
  },
  {
    id: "cf6e1a9f-ecf7-45f5-86a2-b8df9e9082c6",
    title: "AE Operating System > Identifying Great Companies",
    min_kis: 10,
    label: "very-long-lesson",
  },
];

async function fetchResourceContent(resourceId: string): Promise<{ content: string; title: string; resource_type: string }> {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await sb
    .from("resources")
    .select("content, title, resource_type")
    .eq("id", resourceId)
    .single();
  if (error || !data) throw new Error(`Failed to fetch resource ${resourceId}: ${error?.message}`);
  return data as any;
}

async function runBenchmark(resourceId: string): Promise<any> {
  const url = `${SUPABASE_URL}/functions/v1/batch-extract-kis`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ resourceId, benchmarkMode: true }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`batch-extract-kis returned ${res.status}: ${body}`);
  return JSON.parse(body);
}

// ── Individual canary tests ──
for (const canary of CANARY_LESSONS) {
  Deno.test({
    name: `[canary] ${canary.label}: "${canary.title}" yields ≥${canary.min_kis} KIs`,
    // Allow up to 120s per lesson (AI calls are slow)
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      console.log(`\n🐤 CANARY: ${canary.title}`);

      // 1. Verify resource exists and has content
      const resource = await fetchResourceContent(canary.id);
      assert(resource.content.length >= 500, `Resource content too short: ${resource.content.length} chars`);
      console.log(`   Content: ${resource.content.length} chars`);

      // 2. Run benchmark (dry-run, no DB writes)
      const result = await runBenchmark(canary.id);
      const kiCount = result.kis ?? result.items?.length ?? 0;
      console.log(`   KIs produced: ${kiCount} (minimum: ${canary.min_kis})`);

      // 3. Assert minimum KI yield
      assert(
        kiCount >= canary.min_kis,
        `REGRESSION: "${canary.title}" produced ${kiCount} KIs, expected ≥${canary.min_kis}. ` +
        `Pipeline may have misrouted this lesson.`
      );

      // 4. If benchmark returns items, check for HTML contamination
      const items = result.items || [];
      for (const item of items) {
        const allText = [item.title, item.tactic_summary, item.how_to_execute, item.example_usage].join(" ");
        assert(
          !/<[a-z][\s\S]*>/i.test(allText),
          `HTML contamination detected in KI: "${item.title}"`
        );
      }

      console.log(`   ✅ PASSED`);
    },
  });
}

// ── Meta-test: verify lesson routing ──
Deno.test({
  name: "[canary] All 5 lessons are detected as structured lessons (not transcripts)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    for (const canary of CANARY_LESSONS) {
      const resource = await fetchResourceContent(canary.id);
      const hasMarker = resource.content.includes("--- Video Transcript ---") &&
        resource.content.indexOf("--- Video Transcript ---") > 500;
      const hasCourseTitle = resource.title.includes(">");
      const isVideoType = resource.resource_type === "video";

      const detected = hasMarker || (hasCourseTitle && isVideoType && resource.content.length >= 500);
      assert(
        detected,
        `ROUTING FAILURE: "${canary.title}" would NOT be detected as a structured lesson. ` +
        `marker=${hasMarker}, courseTitle=${hasCourseTitle}, video=${isVideoType}, len=${resource.content.length}`
      );
    }
    console.log("✅ All 5 canaries correctly detected as structured lessons");
  },
});
