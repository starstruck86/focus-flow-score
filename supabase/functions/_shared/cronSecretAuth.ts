import { timingSafeEqual } from "node:crypto";

const CRON_SECRET_HEADER = "x-cron-secret";
const MAX_SECRET_BYTES = 4096;
const MISSING_SLOT_VALUE = "focus-flow-score/missing-cron-secret-slot/v1";

const encoder = new TextEncoder();

export type CronSecretSlots = Readonly<{
  current?: string;
  next?: string;
}>;

export type EnvironmentReader = (name: string) => string | undefined;

function isConfigured(value: string | undefined): value is string {
  if (value === undefined || value.length === 0) return false;
  return encoder.encode(value).byteLength <= MAX_SECRET_BYTES;
}

async function constantTimeEqual(presented: string, configured: string): Promise<boolean> {
  const [presentedDigest, configuredDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(configured)),
  ]);

  // Compare equal-length digests with the runtime's documented constant-time
  // primitive. Both configured slots are evaluated by the caller.
  return timingSafeEqual(
    new Uint8Array(presentedDigest),
    new Uint8Array(configuredDigest),
  );
}

export async function acceptsCronSecret(
  presented: string | null,
  slots: CronSecretSlots,
): Promise<boolean> {
  if (presented === null || presented.length === 0) return false;
  if (encoder.encode(presented).byteLength > MAX_SECRET_BYTES) return false;

  const currentConfigured = isConfigured(slots.current);
  const nextConfigured = isConfigured(slots.next);
  if (!currentConfigured && !nextConfigured) return false;

  const [currentMatches, nextMatches] = await Promise.all([
    constantTimeEqual(
      presented,
      currentConfigured ? slots.current! : MISSING_SLOT_VALUE,
    ),
    constantTimeEqual(
      presented,
      nextConfigured ? slots.next! : MISSING_SLOT_VALUE,
    ),
  ]);

  return Boolean(
    (Number(currentConfigured) * Number(currentMatches)) |
      (Number(nextConfigured) * Number(nextMatches)),
  );
}

export async function hasValidCronSecret(
  headers: Headers,
  readEnvironment: EnvironmentReader = (name) => Deno.env.get(name),
): Promise<boolean> {
  return acceptsCronSecret(headers.get(CRON_SECRET_HEADER), {
    current: readEnvironment("CRON_SECRET"),
    next: readEnvironment("CRON_SECRET_NEXT"),
  });
}
