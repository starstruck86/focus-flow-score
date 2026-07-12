import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  EDGE_ATTESTED_FUNCTIONS,
  type EdgeAttestationRuntime,
  withEdgeBuildAttestation,
} from "./edgeBuildAttestation.ts";

const SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const VALID_MANIFEST = {
  release_id: "edge-20260712-0123456789ab",
  source_commit: SOURCE_COMMIT,
  functions: Object.fromEntries(
    EDGE_ATTESTED_FUNCTIONS.map((functionName) => [
      functionName,
      SOURCE_COMMIT,
    ]),
  ),
};

function runtime(
  manifest: unknown = VALID_MANIFEST,
  deploymentId: string | undefined = "odbjjklumdsuqdvkgwyv_strategy-chat_42",
): EdgeAttestationRuntime {
  return {
    manifest,
    getDeploymentId: () => deploymentId,
  };
}

Deno.test("every scoped function exposes the generated source commit", () => {
  for (const functionName of EDGE_ATTESTED_FUNCTIONS) {
    const response = withEdgeBuildAttestation(
      new Response(null, { status: 204 }),
      functionName,
      runtime(),
    );

    assertEquals(response.status, 204);
    assertEquals(response.headers.get("X-Edge-Attestation-Verified"), "true");
    assertEquals(response.headers.get("X-Edge-Function"), functionName);
    assertEquals(response.headers.get("X-Edge-Source-Commit"), SOURCE_COMMIT);
    assertEquals(
      response.headers.get("X-Edge-Deployment-Id"),
      "odbjjklumdsuqdvkgwyv_strategy-chat_42",
    );
    assertEquals(
      response.headers.get("X-Edge-Proof-Scope"),
      "edge-function-bundle",
    );
  }
});

Deno.test("malformed or incomplete manifests fail closed", () => {
  const invalidManifests = [
    null,
    {},
    { ...VALID_MANIFEST, release_id: "edge-invalid" },
    { ...VALID_MANIFEST, source_commit: SOURCE_COMMIT.slice(0, 39) },
    { ...VALID_MANIFEST, release_id: "edge-20260712-abcdef012345" },
    {
      ...VALID_MANIFEST,
      functions: { ...VALID_MANIFEST.functions, mcp: "f".repeat(40) },
    },
    {
      ...VALID_MANIFEST,
      functions: { ...VALID_MANIFEST.functions, unexpected: SOURCE_COMMIT },
    },
  ];

  for (const manifest of invalidManifests) {
    const response = withEdgeBuildAttestation(
      new Response(null),
      "strategy-chat",
      runtime(manifest),
    );
    assertEquals(response.headers.get("X-Edge-Attestation-Verified"), "false");
    assertFalse(response.headers.has("X-Edge-Source-Commit"));
  }
});

Deno.test("missing or blank deployment IDs fail closed", () => {
  for (const deploymentId of [undefined, "", "   "]) {
    const response = withEdgeBuildAttestation(
      new Response(null),
      "analyze-call",
      {
        manifest: VALID_MANIFEST,
        getDeploymentId: () => deploymentId,
      },
    );
    assertEquals(response.headers.get("X-Edge-Attestation-Verified"), "false");
    assertFalse(response.headers.has("X-Edge-Deployment-Id"));
    assertEquals(response.headers.get("X-Edge-Source-Commit"), SOURCE_COMMIT);
  }
});

Deno.test("deployment IDs from another project fail closed", () => {
  const response = withEdgeBuildAttestation(
    new Response(null),
    "strategy-chat",
    runtime(VALID_MANIFEST, "otherproject_strategy-chat_42"),
  );

  assertEquals(response.headers.get("X-Edge-Attestation-Verified"), "false");
  assertEquals(
    response.headers.get("X-Edge-Deployment-Id"),
    "otherproject_strategy-chat_42",
  );
});

Deno.test("attestation preserves preflight behavior and disables caching", () => {
  const response = withEdgeBuildAttestation(
    new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Mcp-Session-Id",
      },
    }),
    "mcp",
    runtime(),
  );

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(response.headers.get("Access-Control-Max-Age"), "0");
  const exposed = response.headers.get("Access-Control-Expose-Headers") ?? "";
  assertEquals(exposed.includes("Mcp-Session-Id"), true);
  assertEquals(exposed.includes("X-Edge-Source-Commit"), true);
});

Deno.test("attestation never reads or exposes unrelated runtime values", async () => {
  const secretCanaries = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SB_EXECUTION_ID",
    "user-data-canary",
    "secret-value-canary",
  ];
  let deploymentReads = 0;
  const response = withEdgeBuildAttestation(
    new Response(null),
    "version",
    {
      manifest: VALID_MANIFEST,
      getDeploymentId: () => {
        deploymentReads += 1;
        return "odbjjklumdsuqdvkgwyv_version_42";
      },
    },
  );
  const serialized = JSON.stringify([...response.headers.entries()]);

  assertEquals(deploymentReads, 1);
  for (const canary of secretCanaries) {
    assertFalse(serialized.includes(canary));
  }
  assertEquals(await response.text(), "");
});
