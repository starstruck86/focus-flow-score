import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createVersionHandler,
  type VersionEnvironmentName,
  type VersionRuntime,
} from "../_shared/versionResponse.ts";

const VALID_RELEASE = {
  release_id: "edge-20260712-0123456789ab",
  source_commit: "0123456789abcdef0123456789abcdef01234567",
  functions: {
    "strategy-chat": "0123456789abcdef0123456789abcdef01234567",
    "analyze-call": "0123456789abcdef0123456789abcdef01234567",
    mcp: "0123456789abcdef0123456789abcdef01234567",
    version: "0123456789abcdef0123456789abcdef01234567",
  },
};

const VALID_ENVIRONMENT: Partial<Record<VersionEnvironmentName, string>> = {
  DENO_DEPLOYMENT_ID: "odbjjklumdsuqdvkgwyv_version_42",
  SB_REGION: "us-east-1",
};

function runtime(
  releaseMetadata: unknown = VALID_RELEASE,
  environment: Partial<Record<VersionEnvironmentName, string>> =
    VALID_ENVIRONMENT,
): VersionRuntime {
  return {
    releaseMetadata,
    getEnv: (name) => environment[name],
  };
}

function request(method = "GET"): Request {
  return new Request("https://example.com/functions/v1/version", { method });
}

Deno.test("successful version response returns the exact public attestation", async () => {
  const response = createVersionHandler(runtime())(request());

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(response.headers.get("Content-Type"), "application/json");
  assertEquals(await response.json(), {
    status: "ok",
    service: "version",
    verified: true,
    release_id: VALID_RELEASE.release_id,
    source_commit: VALID_RELEASE.source_commit,
    deployment_id: VALID_ENVIRONMENT.DENO_DEPLOYMENT_ID,
    region: VALID_ENVIRONMENT.SB_REGION,
    proof_scope: "version-function-bundle",
  });
});

Deno.test("missing deployment ID fails closed", async () => {
  for (const deploymentId of [undefined, "", "   "]) {
    const response = createVersionHandler(
      runtime(VALID_RELEASE, {
        DENO_DEPLOYMENT_ID: deploymentId,
        SB_REGION: "us-east-1",
      }),
    )(request());
    const body = await response.json();

    assertEquals(response.status, 503);
    assertEquals(body.verified, false);
    assertEquals(body.status, "unavailable");
    assertEquals(body.deployment_id, null);
  }
});

Deno.test("missing or pending release metadata fails closed", async () => {
  const invalidMetadata = [
    undefined,
    null,
    {},
    { release_id: "", source_commit: VALID_RELEASE.source_commit },
    { release_id: VALID_RELEASE.release_id, source_commit: "   " },
    { release_id: "PENDING", source_commit: "PENDING" },
  ];

  for (const metadata of invalidMetadata) {
    const response = createVersionHandler({
      releaseMetadata: metadata,
      getEnv: (name) => VALID_ENVIRONMENT[name],
    })(request());
    const body = await response.json();

    assertEquals(response.status, 503);
    assertEquals(body.verified, false);
    assertEquals(body.status, "unavailable");
  }
});

Deno.test("malformed release ID fails closed", async () => {
  for (
    const releaseId of [
      "release-20260712-0123456789ab",
      "edge-2026071-0123456789ab",
      "edge-20260712-0123456789AB",
      "edge-20260712-0123456789abc",
      ` ${VALID_RELEASE.release_id}`,
    ]
  ) {
    const response = createVersionHandler(
      runtime({ ...VALID_RELEASE, release_id: releaseId }),
    )(request());
    const body = await response.json();

    assertEquals(response.status, 503);
    assertEquals(body.verified, false);
    assertEquals(body.status, "unavailable");
  }
});

Deno.test("malformed or short source commit fails closed", async () => {
  for (
    const sourceCommit of [
      "0123456789ab",
      "0123456789abcdef0123456789abcdef0123456",
      "0123456789abcdef0123456789abcdef012345678",
      "0123456789ABCDEF0123456789ABCDEF01234567",
      "g123456789abcdef0123456789abcdef01234567",
      `${VALID_RELEASE.source_commit} `,
    ]
  ) {
    const response = createVersionHandler(
      runtime({ ...VALID_RELEASE, source_commit: sourceCommit }),
    )(request());
    const body = await response.json();

    assertEquals(response.status, 503);
    assertEquals(body.verified, false);
    assertEquals(body.status, "unavailable");
  }
});

Deno.test("release ID suffix must match source commit prefix", async () => {
  const response = createVersionHandler(
    runtime({
      release_id: "edge-20260712-abcdef012345",
      source_commit: VALID_RELEASE.source_commit,
    }),
  )(request());
  const body = await response.json();

  assertEquals(response.status, 503);
  assertEquals(body.verified, false);
  assertEquals(body.status, "unavailable");
});

Deno.test("valid matching release metadata succeeds", async () => {
  const response = createVersionHandler(runtime(VALID_RELEASE))(request());
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.verified, true);
  assertEquals(body.release_id, VALID_RELEASE.release_id);
  assertEquals(body.source_commit, VALID_RELEASE.source_commit);
});

Deno.test("version GET requires the exact four-function manifest", async () => {
  const invalidManifests = [
    {
      ...VALID_RELEASE,
      functions: { ...VALID_RELEASE.functions, mcp: "f".repeat(40) },
    },
    {
      ...VALID_RELEASE,
      functions: {
        ...VALID_RELEASE.functions,
        unexpected: VALID_RELEASE.source_commit,
      },
    },
  ];

  for (const releaseMetadata of invalidManifests) {
    const response = createVersionHandler(runtime(releaseMetadata))(request());
    const body = await response.json();

    assertEquals(response.status, 503);
    assertEquals(body.verified, false);
    assertEquals(body.release_id, null);
    assertEquals(body.source_commit, null);
  }
});

Deno.test("version GET rejects deployment IDs from another project", async () => {
  const response = createVersionHandler(runtime(VALID_RELEASE, {
    DENO_DEPLOYMENT_ID: "otherproject_version_42",
    SB_REGION: "us-east-1",
  }))(request());
  const body = await response.json();

  assertEquals(response.status, 503);
  assertEquals(body.verified, false);
});

Deno.test("unsupported methods return 405 before reading environment", async () => {
  const accessedEnvironmentNames: VersionEnvironmentName[] = [];
  const handler = createVersionHandler({
    releaseMetadata: VALID_RELEASE,
    getEnv: (name) => {
      accessedEnvironmentNames.push(name);
      return VALID_ENVIRONMENT[name];
    },
  });

  for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE"]) {
    const response = handler(request(method));
    const body = await response.json();

    assertEquals(response.status, 405);
    assertEquals(response.headers.get("Allow"), "GET, OPTIONS");
    assertEquals(body.error, "method_not_allowed");
  }

  assertEquals(accessedEnvironmentNames, []);
});

Deno.test("OPTIONS returns a side-effect-free preflight response", async () => {
  const response = createVersionHandler(runtime())(request("OPTIONS"));

  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Allow"), "GET, OPTIONS");
  assertEquals(
    response.headers.get("Access-Control-Allow-Methods"),
    "GET, OPTIONS",
  );
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(response.headers.get("X-Edge-Attestation-Verified"), "true");
  assertEquals(response.headers.get("X-Edge-Function"), "version");
  assertEquals(
    response.headers.get("X-Edge-Source-Commit"),
    VALID_RELEASE.source_commit,
  );
  assertEquals(
    response.headers.get("X-Edge-Deployment-Id"),
    VALID_ENVIRONMENT.DENO_DEPLOYMENT_ID,
  );
  assertEquals(
    response.headers.get("X-Edge-Proof-Scope"),
    "edge-function-bundle",
  );
  assertEquals(await response.text(), "");
});

Deno.test("Cache-Control is no-store on every response path", () => {
  const handler = createVersionHandler(runtime());
  const unavailableHandler = createVersionHandler(
    runtime(VALID_RELEASE, { SB_REGION: "us-east-1" }),
  );
  const responses = [
    handler(request()),
    unavailableHandler(request()),
    handler(request("POST")),
    handler(request("OPTIONS")),
  ];

  for (const response of responses) {
    assertEquals(response.headers.get("Cache-Control"), "no-store");
  }
});

Deno.test("response never exposes secrets, execution IDs, or request data", async () => {
  const secretValues = {
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-canary",
    SUPABASE_SECRET_KEY: "supabase-secret-canary",
    SUPABASE_DB_URL: "postgres-secret-canary",
    API_KEY: "generic-api-secret-canary",
    SB_EXECUTION_ID: "execution-id-secret-canary",
  };
  const environment: Record<string, string> = {
    ...secretValues,
    DENO_DEPLOYMENT_ID: "odbjjklumdsuqdvkgwyv_version_42",
    SB_REGION: "us-east-1",
  };
  const accessedEnvironmentNames: string[] = [];
  const handler = createVersionHandler({
    releaseMetadata: VALID_RELEASE,
    getEnv: (name) => {
      accessedEnvironmentNames.push(name);
      return environment[name];
    },
  });
  const response = handler(
    new Request(
      "https://example.com/functions/v1/version?token=user-query-secret-canary",
      { headers: { Authorization: "Bearer user-header-secret-canary" } },
    ),
  );
  const serialized = await response.text();
  const body = JSON.parse(serialized) as Record<string, unknown>;

  assertEquals(accessedEnvironmentNames, ["DENO_DEPLOYMENT_ID", "SB_REGION"]);
  assertEquals(Object.keys(body).sort(), [
    "deployment_id",
    "proof_scope",
    "region",
    "release_id",
    "service",
    "source_commit",
    "status",
    "verified",
  ]);

  for (const [secretName, secretValue] of Object.entries(secretValues)) {
    assertFalse(serialized.includes(secretName));
    assertFalse(serialized.includes(secretValue));
  }
  assertFalse(serialized.includes("user-query-secret-canary"));
  assertFalse(serialized.includes("user-header-secret-canary"));
  assert(!serialized.includes("SB_EXECUTION_ID"));
});
