// Deno-style edge test for W10 schemaHealth compact validator.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeSchemaHealth,
  STRATEGY_SCHEMA_VERSION,
} from "./schemaHealth.ts";

Deno.test("computeSchemaHealth — empty meta returns ok with all-missing", () => {
  const r = computeSchemaHealth({}, "chat");
  assertEquals(r.status, "ok");
  assertEquals(r.schema_version, STRATEGY_SCHEMA_VERSION);
  assertEquals(r.totals.malformed, 0);
  // chat hides sop, so 7 layers expected as missing
  assertEquals(r.totals.missing, 7);
});

Deno.test("computeSchemaHealth — malformed block produces drift", () => {
  const r = computeSchemaHealth(
    { calibration: { weightedScore: 0.5 } },
    "chat",
  );
  assertEquals(r.status, "drift");
  assertEquals(r.malformed_keys.includes("calibration"), true);
});

Deno.test("computeSchemaHealth — unknown fields are warning only", () => {
  const r = computeSchemaHealth(
    {
      standard_context: { injected: true, novel_field: "future" },
    },
    "chat",
  );
  assertEquals(r.status, "ok");
  assertEquals(r.totals.unknownFieldWarnings, 1);
  assertEquals(r.unknown_field_keys.includes("standard_context"), true);
});

Deno.test("computeSchemaHealth — task source includes sop", () => {
  const r = computeSchemaHealth(
    { sop: { enabled: true } },
    "task",
  );
  // sop now valid, others missing
  assertEquals(r.status, "ok");
  assertEquals(r.totals.valid, 1);
});

Deno.test("computeSchemaHealth — never throws on garbage input", () => {
  const r = computeSchemaHealth(null, "chat");
  assertEquals(r.status, "ok");
  assertEquals(r.totals.missing, 7);
});
