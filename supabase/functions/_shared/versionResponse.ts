import releaseMetadata from "./release.json" with { type: "json" };

export const VERSION_PROOF_SCOPE = "version-function-bundle" as const;

const RELEASE_ID_PATTERN = /^edge-[0-9]{8}-[0-9a-f]{12}$/;
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export type VersionEnvironmentName = "DENO_DEPLOYMENT_ID" | "SB_REGION";

export interface VersionRuntime {
  releaseMetadata: unknown;
  getEnv: (name: VersionEnvironmentName) => string | undefined;
}

interface VersionAttestation {
  status: "ok" | "unavailable";
  service: "version";
  verified: boolean;
  release_id: string | null;
  source_commit: string | null;
  deployment_id: string | null;
  region: string | null;
  proof_scope: typeof VERSION_PROOF_SCOPE;
}

const COMMON_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};

const productionRuntime: VersionRuntime = {
  releaseMetadata,
  getEnv: (name) => Deno.env.get(name),
};

function responseHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return { ...COMMON_HEADERS, ...extra };
}

function jsonResponse(
  body: Record<string, unknown> | VersionAttestation,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(extraHeaders),
  });
}

function normalizePublicValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.toUpperCase() === "PENDING") return null;
  return normalized;
}

function readReleaseValue(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim()) return null;
  if (!value || value.toUpperCase() === "PENDING") return null;
  return value;
}

function readReleaseMetadata(metadata: unknown): {
  releaseId: string | null;
  sourceCommit: string | null;
} {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { releaseId: null, sourceCommit: null };
  }

  try {
    const record = metadata as Record<string, unknown>;
    return {
      releaseId: readReleaseValue(record.release_id),
      sourceCommit: readReleaseValue(record.source_commit),
    };
  } catch {
    return { releaseId: null, sourceCommit: null };
  }
}

function readEnvironment(
  runtime: VersionRuntime,
  name: VersionEnvironmentName,
): string | null {
  try {
    return normalizePublicValue(runtime.getEnv(name));
  } catch {
    return null;
  }
}

function hasValidReleaseBinding(
  releaseId: string | null,
  sourceCommit: string | null,
): boolean {
  return Boolean(
    releaseId &&
      sourceCommit &&
      RELEASE_ID_PATTERN.test(releaseId) &&
      SOURCE_COMMIT_PATTERN.test(sourceCommit) &&
      releaseId.slice(-12) === sourceCommit.slice(0, 12),
  );
}

export function createVersionHandler(
  runtime: VersionRuntime = productionRuntime,
): (request: Request) => Response {
  return (request: Request): Response => {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: responseHeaders({ Allow: "GET, OPTIONS" }),
      });
    }

    if (request.method !== "GET") {
      return jsonResponse(
        {
          status: "method_not_allowed",
          service: "version",
          verified: false,
          release_id: null,
          source_commit: null,
          deployment_id: null,
          region: null,
          proof_scope: VERSION_PROOF_SCOPE,
          error: "method_not_allowed",
        },
        405,
        { Allow: "GET, OPTIONS" },
      );
    }

    const { releaseId, sourceCommit } = readReleaseMetadata(
      runtime.releaseMetadata,
    );
    const deploymentId = readEnvironment(runtime, "DENO_DEPLOYMENT_ID");
    const region = readEnvironment(runtime, "SB_REGION");
    const verified = hasValidReleaseBinding(releaseId, sourceCommit) &&
      Boolean(deploymentId);

    const attestation: VersionAttestation = {
      status: verified ? "ok" : "unavailable",
      service: "version",
      verified,
      release_id: releaseId,
      source_commit: sourceCommit,
      deployment_id: deploymentId,
      region,
      proof_scope: VERSION_PROOF_SCOPE,
    };

    return jsonResponse(attestation, verified ? 200 : 503);
  };
}
