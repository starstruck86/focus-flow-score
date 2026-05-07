/**
 * Phase 4G-1 — Timeout Classification & Section Author Config Tests
 *
 * Validates timeout budget config and heavy singleton logic via source inspection.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("sectionAuthor defines HEAVY_SINGLETON_SECTIONS", async () => {
  const source = await Deno.readTextFile(
    new URL("./sectionAuthor.ts", import.meta.url).pathname
  );
  assertEquals(source.includes("HEAVY_SINGLETON_SECTIONS"), true, "must define HEAVY_SINGLETON_SECTIONS");
});

Deno.test("sectionAuthor supports AUTHORING_BATCH_TIMEOUT_MS override", async () => {
  const source = await Deno.readTextFile(
    new URL("./sectionAuthor.ts", import.meta.url).pathname
  );
  assertEquals(source.includes("AUTHORING_BATCH_TIMEOUT_MS"), true, "must support AUTHORING_BATCH_TIMEOUT_MS env override");
});

Deno.test("sectionAuthor imports ProviderFailureRecord type", async () => {
  const source = await Deno.readTextFile(
    new URL("./sectionAuthor.ts", import.meta.url).pathname
  );
  assertEquals(source.includes("ProviderFailureRecord"), true, "must import ProviderFailureRecord for instrumentation");
});

Deno.test("sectionAuthor defines ninety_day_plan batches", async () => {
  const source = await Deno.readTextFile(
    new URL("./sectionAuthor.ts", import.meta.url).pathname
  );
  assertEquals(source.includes("NINETY_DAY_PLAN_BATCHES"), true, "must define NINETY_DAY_PLAN_BATCHES");
  assertEquals(source.includes("NINETY_DAY_PLAN_SECTIONS"), true, "must define NINETY_DAY_PLAN_SECTIONS");
});
