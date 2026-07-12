import { EDGE_BUILD_MANIFEST } from "./edgeBuildManifest.generated.ts";

export const EDGE_ATTESTATION_PROOF_SCOPE = "edge-function-bundle" as const;
export const EDGE_ATTESTED_FUNCTIONS = [
  "strategy-chat",
  "analyze-call",
  "mcp",
  "version",
] as const;

export type EdgeAttestedFunction = typeof EDGE_ATTESTED_FUNCTIONS[number];

export interface EdgeAttestationRuntime {
  manifest: unknown;
  getDeploymentId: () => string | undefined;
}

interface ValidatedManifest {
  releaseId: string;
  sourceCommit: string;
}

export interface EdgeBuildAttestationResult {
  verified: boolean;
  releaseId: string | null;
  sourceCommit: string | null;
  deploymentId: string | null;
}

const RELEASE_ID_PATTERN = /^edge-[0-9]{8}-[0-9a-f]{12}$/;
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const DEPLOYMENT_ID_PATTERN = /^odbjjklumdsuqdvkgwyv_.+$/;
const ATTESTATION_HEADER_NAMES = [
  "X-Edge-Attestation-Verified",
  "X-Edge-Function",
  "X-Edge-Source-Commit",
  "X-Edge-Deployment-Id",
  "X-Edge-Proof-Scope",
];

const productionRuntime: EdgeAttestationRuntime = {
  manifest: EDGE_BUILD_MANIFEST,
  getDeploymentId: () => Deno.env.get("DENO_DEPLOYMENT_ID"),
};

function normalizeEnvironmentValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function validateManifest(manifest: unknown): ValidatedManifest | null {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return null;
  }

  const record = manifest as Record<string, unknown>;
  const releaseId = record.release_id;
  const sourceCommit = record.source_commit;
  const functions = record.functions;

  if (
    typeof releaseId !== "string" ||
    typeof sourceCommit !== "string" ||
    !RELEASE_ID_PATTERN.test(releaseId) ||
    !SOURCE_COMMIT_PATTERN.test(sourceCommit) ||
    releaseId.slice(-12) !== sourceCommit.slice(0, 12) ||
    !functions ||
    typeof functions !== "object" ||
    Array.isArray(functions)
  ) {
    return null;
  }

  const functionRecord = functions as Record<string, unknown>;
  const functionNames = Object.keys(functionRecord).sort();
  const expectedNames = [...EDGE_ATTESTED_FUNCTIONS].sort();
  if (
    functionNames.length !== expectedNames.length ||
    functionNames.some((name, index) => name !== expectedNames[index]) ||
    expectedNames.some((name) => functionRecord[name] !== sourceCommit)
  ) {
    return null;
  }

  return { releaseId, sourceCommit };
}

function appendExposedHeaders(headers: Headers): void {
  const existing = headers.get("Access-Control-Expose-Headers")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  const merged = [...new Set([...existing, ...ATTESTATION_HEADER_NAMES])];
  headers.set("Access-Control-Expose-Headers", merged.join(", "));
}

export function readEdgeBuildAttestation(
  runtime: EdgeAttestationRuntime = productionRuntime,
): EdgeBuildAttestationResult {
  const manifest = validateManifest(runtime.manifest);
  let deploymentId: string | null = null;
  try {
    deploymentId = normalizeEnvironmentValue(runtime.getDeploymentId());
  } catch {
    deploymentId = null;
  }

  return {
    verified: Boolean(
      manifest && deploymentId && DEPLOYMENT_ID_PATTERN.test(deploymentId),
    ),
    releaseId: manifest?.releaseId ?? null,
    sourceCommit: manifest?.sourceCommit ?? null,
    deploymentId,
  };
}

export function withEdgeBuildAttestation(
  response: Response,
  functionName: EdgeAttestedFunction,
  runtime: EdgeAttestationRuntime = productionRuntime,
): Response {
  const attestation = readEdgeBuildAttestation(runtime);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Access-Control-Max-Age", "0");
  headers.set("X-Edge-Attestation-Verified", String(attestation.verified));
  headers.set("X-Edge-Function", functionName);
  headers.set("X-Edge-Proof-Scope", EDGE_ATTESTATION_PROOF_SCOPE);
  appendExposedHeaders(headers);

  if (attestation.sourceCommit) {
    headers.set("X-Edge-Source-Commit", attestation.sourceCommit);
  } else {
    headers.delete("X-Edge-Source-Commit");
  }
  if (attestation.deploymentId) {
    headers.set("X-Edge-Deployment-Id", attestation.deploymentId);
  } else {
    headers.delete("X-Edge-Deployment-Id");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
