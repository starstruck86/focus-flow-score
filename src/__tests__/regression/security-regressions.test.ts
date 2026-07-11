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

  it("strategy-chat verifies thread and account ownership before context retrieval", () => {
    const src = read("supabase/functions/strategy-chat/index.ts");
    expect(src).toMatch(
      /from\("strategy_threads"\)[\s\S]{0,300}\.eq\("id", threadId\)[\s\S]{0,120}\.eq\("user_id", userId\)/,
    );
    expect(src).toMatch(
      /from\("accounts"\)[\s\S]{0,350}\.eq\("id", thread\.linked_account_id\)[\s\S]{0,120}\.eq\("user_id", userId\)/,
    );
  });

  it("strategy-chat has one classifier-gated web path with stream citation parity", () => {
    const src = read("supabase/functions/strategy-chat/index.ts");
    // The older Current State Perplexity side path must remain disabled so it
    // cannot bypass retrieval.webResearch.include or duplicate the bounded call.
    expect(src).toMatch(/runCurrentStatePreflight\([\s\S]{0,900}webCapabilityAvailable:\s*false/);
    expect(src).toMatch(/const __classifierWebRequested\s*=\s*[\s\S]{0,150}situation\.retrieval\.webResearch\.include\s*&&[\s\S]{0,80}__deterministicCurrentFactNeed/);
    expect(src).toMatch(/classifierRequiresCurrentExternalFacts:\s*__classifierWebRequested/);
    expect(src).toMatch(/const __webRequested\s*=\s*__classifierWebRequested\s*\|\|\s*__workspaceRequiresWebResearch/);
    // Both non-stream and stream citation builders must receive the same set.
    expect(src.match(/webSources:\s*webResearch\?\.sources\s*\?\?\s*\[\]/g)).toHaveLength(2);
    expect(src).toMatch(/web_sources:\s*webSources/);
  });

  it("strategy-chat preserves required Deep Research before generic exit", () => {
    const src = read("supabase/functions/strategy-chat/index.ts");
    const resolveAt = src.indexOf(
      "const __resolvedContract = resolveServerWorkspaceContract(workspaceKeyRaw)",
    );
    const genericExitAt = src.indexOf("!__workspaceRequiresWebResearch", resolveAt);
    const classifierAt = src.indexOf("const situation = await classifySituation", resolveAt);
    expect(resolveAt).toBeGreaterThan(-1);
    expect(genericExitAt).toBeGreaterThan(resolveAt);
    expect(classifierAt).toBeGreaterThan(genericExitAt);
  });

  it("strategy-chat minimizes context sent to the external web provider", () => {
    const src = read("supabase/functions/strategy-chat/index.ts");
    const call = src.match(/retrieveCurrentWebResearch\(\{[\s\S]{0,500}?\}\)/)?.[0] ?? "";
    expect(call).toMatch(/accountContext:\s*__webAccountContext/);
    expect(call).not.toMatch(/__classifierAccountContext|tech_stack|tags|opportunity|stage/i);
    const publicContext = src.match(/const __webAccountCtxParts[\s\S]{0,500}?const __webAccountContext/)?.[0] ?? "";
    expect(publicContext).toMatch(/pack\.account\?\.name/);
    expect(publicContext).toMatch(/pack\.account\?\.industry/);
    expect(publicContext).not.toMatch(/tech_stack|tags|opportunity|stage/i);
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
