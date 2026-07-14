import { EDGE_BUILD_MANIFEST } from "./edgeBuildManifest.generated.ts";
import {
  readEdgeBuildAttestation,
  withEdgeBuildAttestation,
} from "./edgeBuildAttestation.ts";

export const VERSION_PROOF_SCOPE = "version-function-bundle" as const;

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
  releaseMetadata: EDGE_BUILD_MANIFEST,
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

export function createVersionHandler(
  runtime: VersionRuntime = productionRuntime,
): (request: Request) => Response {
  return (request: Request): Response => {
    if (request.method === "OPTIONS") {
      return withEdgeBuildAttestation(
        new Response(null, {
          status: 204,
          headers: responseHeaders({ Allow: "GET, OPTIONS" }),
        }),
        "version",
        {
          manifest: runtime.releaseMetadata,
          getDeploymentId: () => runtime.getEnv("DENO_DEPLOYMENT_ID"),
        },
      );
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

    const edgeAttestation = readEdgeBuildAttestation({
      manifest: runtime.releaseMetadata,
      getDeploymentId: () => runtime.getEnv("DENO_DEPLOYMENT_ID"),
    });
    const region = readEnvironment(runtime, "SB_REGION");

    const attestation: VersionAttestation = {
      status: edgeAttestation.verified ? "ok" : "unavailable",
      service: "version",
      verified: edgeAttestation.verified,
      release_id: edgeAttestation.releaseId,
      source_commit: edgeAttestation.sourceCommit,
      deployment_id: edgeAttestation.deploymentId,
      region,
      proof_scope: VERSION_PROOF_SCOPE,
    };

    return jsonResponse(attestation, edgeAttestation.verified ? 200 : 503);
  };
}
