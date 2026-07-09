import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("security regressions — source-invariant guards", () => {
  it("useDataSync hydration never deletes account rows based on motion", () => {
    const src = read("src/hooks/useDataSync.ts");
    // No purge variable or motion-based filter/delete of accounts
    expect(src).not.toMatch(/nonBranchRows/);
    expect(src).not.toMatch(/motion\s*!==?\s*['"]both['"]/);
    // No .delete() call scoped to accounts hydration purge block
    expect(src).not.toMatch(/\.from\(['"]accounts['"]\)[\s\S]{0,200}\.delete\(\)[\s\S]{0,200}motion/);
  });

  it("typedUpsert and typedDelete throw on Supabase errors", () => {
    const src = read("src/hooks/useDataSync.ts");
    // Both functions must surface errors — look for error-throw pattern
    expect(src).toMatch(/typedUpsert/);
    expect(src).toMatch(/typedDelete/);
    // Expect an error-check / throw pattern near writes
    expect(src).toMatch(/if\s*\(\s*error\s*\)\s*\{[\s\S]{0,200}throw\s+(error|new Error)/);
  });

  const authGuardedProxies = [
    "supabase/functions/parse-account-screenshot/index.ts",
    "supabase/functions/parse-claude-import/index.ts",
    "supabase/functions/simulate-chat/index.ts",
    "supabase/functions/elevenlabs-tts-stream/index.ts",
    "supabase/functions/elevenlabs-stt/index.ts",
    "supabase/functions/import-youtube-playlist/index.ts",
    "supabase/functions/import-podcast/index.ts",
  ];
  for (const p of authGuardedProxies) {
    it(`${p} imports and calls requireUser`, () => {
      const src = read(p);
      expect(src).toMatch(/from\s+['"]\.\.\/_shared\/requireUser\.ts['"]/);
      expect(src).toMatch(/requireUser\s*\(/);
    });
  }

  it("enrich-account enforces ownership via .eq('user_id', ...)", () => {
    const src = read("supabase/functions/enrich-account/index.ts");
    expect(src).toMatch(/\.eq\(\s*['"]user_id['"]/);
  });

  it("parse-screenshot enforces ownership via .eq('user_id', ...)", () => {
    const src = read("supabase/functions/parse-screenshot/index.ts");
    expect(src).toMatch(/\.eq\(\s*['"]user_id['"]/);
    // No stray duplicate .single() call
    expect(src).not.toMatch(/\.single\(\);\s*\n\s*\.single\(\);/);
  });

  it("extract-tactics rejects legacy_user_path with 400", () => {
    const src = read("supabase/functions/extract-tactics/index.ts");
    expect(src).toMatch(/legacy_user_path/);
    expect(src).toMatch(/status:\s*400[\s\S]{0,200}protected|mode:\s*['"]protected['"][\s\S]{0,200}400/);
  });

  it("sync-calendar upserts before deleting, and deletes scoped by user_id", () => {
    const src = read("supabase/functions/sync-calendar/index.ts");
    const upsertIdx = src.search(/\.upsert\s*\(/);
    const deleteIdx = src.search(/\.delete\s*\(\s*\)/);
    expect(upsertIdx).toBeGreaterThan(-1);
    if (deleteIdx > -1) {
      expect(upsertIdx).toBeLessThan(deleteIdx);
      // Every .delete() call chain must include user_id scope
      const deleteChains = src.match(/\.delete\(\)[\s\S]{0,400}?(?:;|\n\n)/g) ?? [];
      for (const chain of deleteChains) {
        expect(chain).toMatch(/\.eq\(\s*['"]user_id['"]/);
      }
    }
  });

  it("enrich-resource-content requires JWT user or internal secret", () => {
    const src = read("supabase/functions/enrich-resource-content/index.ts");
    expect(src).toMatch(/x-internal-secret/);
    expect(src).toMatch(/INTERNAL_FUNCTION_SECRET/);
  });
});
