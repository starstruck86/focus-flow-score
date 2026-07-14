import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const VERIFIER = resolve(SCRIPT_DIR, "verify-edge-attestations.sh");
const PROJECT_REF = "odbjjklumdsuqdvkgwyv";
const EXPECTED_SHA = "a".repeat(40);
const WRONG_SHA = "b".repeat(40);

const FAKE_CURL_SOURCE = [
  "#!/usr/bin/env node",
  'const { writeFileSync } = require("node:fs");',
  "const args = process.argv.slice(2);",
  'const valueAfter = (flag) => args[args.indexOf(flag) + 1];',
  'if (valueAfter("--proto") !== "=https" || !args.includes("--tlsv1.2")) process.exit(90);',
  'if (valueAfter("--request") !== "OPTIONS") process.exit(91);',
  'const headerFile = valueAfter("--dump-header");',
  "const url = args.at(-1);",
  'const match = url.match(/^https:\\/\\/odbjjklumdsuqdvkgwyv\\.supabase\\.co\\/functions\\/v1\\/([^?]+)\\?/);',
  "if (!headerFile || !match) process.exit(92);",
  "const functionName = match[1];",
  'const sourceCommit = functionName === process.env.FAKE_MISMATCH_FUNCTION',
  '  ? process.env.FAKE_MISMATCH_SOURCE_COMMIT',
  '  : process.env.FAKE_SOURCE_COMMIT;',
  'const deploymentId = process.env.FAKE_DUPLICATE_DEPLOYMENTS === "1"',
  '  ? `${process.env.SUPABASE_PROJECT_REF}_duplicate`',
  '  : `${process.env.SUPABASE_PROJECT_REF}_${functionName}_test`;',
  "let headers = [",
  '  "HTTP/2 204",',
  '  "X-Edge-Attestation-Verified: true",',
  '  `X-Edge-Function: ${functionName}`,',
  '  `X-Edge-Source-Commit: ${sourceCommit}`,',
  '  `X-Edge-Deployment-Id: ${deploymentId}`,',
  '  "X-Edge-Proof-Scope: edge-function-bundle",',
  '  "Cache-Control: no-store",',
  '  "Access-Control-Max-Age: 0",',
  "];",
  "if (process.env.FAKE_OMIT_HEADER) {",
  '  const prefix = `${process.env.FAKE_OMIT_HEADER.toLowerCase()}:`;',
  "  headers = headers.filter((header) => !header.toLowerCase().startsWith(prefix));",
  "}",
  'writeFileSync(headerFile, `${headers.join("\\r\\n")}\\r\\n\\r\\n`, "utf8");',
  'process.stdout.write("204");',
  "",
].join("\n");

function runVerifier(extraEnvironment = {}) {
  const testRoot = mkdtempSync(join(tmpdir(), "edge-attestation-test-"));
  const binDir = join(testRoot, "bin");
  const fakeCurl = join(binDir, "curl");
  try {
    mkdirSync(binDir, { recursive: true });
    writeFileSync(fakeCurl, FAKE_CURL_SOURCE, "utf8");
    chmodSync(fakeCurl, 0o755);

    return spawnSync("bash", [VERIFIER], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        EXPECTED_SOURCE_COMMIT: EXPECTED_SHA,
        SUPABASE_PROJECT_REF: PROJECT_REF,
        EDGE_ATTESTATION_MAX_ATTEMPTS: "1",
        EDGE_ATTESTATION_RETRY_SECONDS: "0",
        GITHUB_RUN_ID: "test",
        GITHUB_RUN_ATTEMPT: "1",
        RUNNER_TEMP: testRoot,
        FAKE_SOURCE_COMMIT: EXPECTED_SHA,
        ...extraEnvironment,
      },
    });
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
}

test("the deployment workflow invokes this tested verifier after deploy", () => {
  const workflow = readFileSync(
    resolve(REPO_ROOT, ".github/workflows/deploy-edge-functions.yml"),
    "utf8",
  );

  assert.match(workflow, /\n  verify:\n/);
  assert.match(workflow, /\n    needs: deploy\n/);
  assert.match(
    workflow,
    /ref: \$\{\{ needs\.deploy\.outputs\.source_sha \}\}/,
  );
  assert.equal(
    workflow.match(/run: bash scripts\/verify-edge-attestations\.sh/g)?.length,
    1,
  );
});

test("all four matching runtime attestations exit zero", () => {
  const result = runVerifier();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified all four edge bundles/);
});

test("one function reporting the wrong SHA exits nonzero", () => {
  const result = runVerifier({
    FAKE_MISMATCH_FUNCTION: "analyze-call",
    FAKE_MISMATCH_SOURCE_COMMIT: WRONG_SHA,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Runtime attestation mismatch for analyze-call/);
});

test("a missing required attestation header exits nonzero", () => {
  const result = runVerifier({ FAKE_OMIT_HEADER: "X-Edge-Proof-Scope" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Runtime attestation mismatch for strategy-chat/);
});

test("reused deployment IDs exit nonzero", () => {
  const result = runVerifier({ FAKE_DUPLICATE_DEPLOYMENTS: "1" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Expected four distinct deployment IDs/);
});
