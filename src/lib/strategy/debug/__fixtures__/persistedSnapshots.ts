/**
 * W11 — Persisted-shape regression fixtures.
 *
 * These represent realistic, fully-populated `strategy_messages.content_json`
 * and `task_runs.meta` blobs as they look AFTER the W10 stamping step has
 * run. They include `schema_health` and the full W3–W7.5 metadata blocks.
 *
 * Doctrine:
 *   - Used by W11 snapshot regression tests.
 *   - Should match what the runtime persists today.
 *   - Update intentionally — drift is the signal.
 */
import { CHAT_MESSAGE_FULL_META, TASK_RUN_FULL_META } from "./snapshots";

export const PERSISTED_CHAT_MESSAGE_FULL = {
  ...CHAT_MESSAGE_FULL_META,
  schema_health: {
    status: "ok" as const,
    validated_at: "2026-04-27T12:00:00.000Z",
    source: "chat" as const,
    schema_version: "w10.v1",
    totals: {
      valid: 7,
      missing: 0,
      malformed: 0,
      unknownFieldWarnings: 0,
    },
    malformed_keys: [],
    missing_keys: [],
    unknown_field_keys: [],
  },
} as const;

export const PERSISTED_TASK_RUN_FULL = {
  ...TASK_RUN_FULL_META,
  schema_health: {
    status: "ok" as const,
    validated_at: "2026-04-27T12:00:00.000Z",
    source: "task" as const,
    schema_version: "w10.v1",
    totals: {
      valid: 8,
      missing: 0,
      malformed: 0,
      unknownFieldWarnings: 0,
    },
    malformed_keys: [],
    missing_keys: [],
    unknown_field_keys: [],
  },
} as const;

/** A chat row missing schema_health entirely (pre-W10 baseline). */
export const PERSISTED_CHAT_MESSAGE_PRE_W10 = {
  ...CHAT_MESSAGE_FULL_META,
} as const;

/** A task row that had a validator_error during stamping. */
export const PERSISTED_TASK_RUN_VALIDATOR_ERROR = {
  ...TASK_RUN_FULL_META,
  schema_health: {
    status: "validator_error" as const,
    validated_at: "2026-04-27T12:00:00.000Z",
    source: "task" as const,
    schema_version: "w10.v1",
    totals: {
      valid: 0,
      missing: 0,
      malformed: 0,
      unknownFieldWarnings: 0,
    },
    malformed_keys: [],
    missing_keys: [],
    unknown_field_keys: [],
    error: "validator threw: TypeError",
  },
} as const;

/** A chat row marked as drift (live validation found malformed keys). */
export const PERSISTED_CHAT_MESSAGE_DRIFT = {
  ...CHAT_MESSAGE_FULL_META,
  schema_health: {
    status: "drift" as const,
    validated_at: "2026-04-27T12:00:00.000Z",
    source: "chat" as const,
    schema_version: "w10.v1",
    totals: {
      valid: 6,
      missing: 0,
      malformed: 1,
      unknownFieldWarnings: 1,
    },
    malformed_keys: ["calibration"],
    missing_keys: [],
    unknown_field_keys: ["citation_check"],
  },
} as const;
