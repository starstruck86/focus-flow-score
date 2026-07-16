import {
  acceptsCronSecret,
  hasValidCronSecret,
} from "./cronSecretAuth.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("accepts the configured current cron key", async () => {
  assert(
    await acceptsCronSecret("synthetic-current", {
      current: "synthetic-current",
      next: "synthetic-next",
    }),
    "current key should be accepted",
  );
});

Deno.test("accepts the independently configured next cron key", async () => {
  assert(
    await acceptsCronSecret("synthetic-next", {
      next: "synthetic-next",
    }),
    "next key should be accepted when the current slot is absent",
  );
});

Deno.test("accepts the next key during true two-slot overlap", async () => {
  assert(
    await acceptsCronSecret("synthetic-next", {
      current: "synthetic-current",
      next: "synthetic-next",
    }),
    "next key should be accepted while both slots are configured",
  );
});

Deno.test("rejects an unknown cron key", async () => {
  assert(
    !(await acceptsCronSecret("synthetic-unknown", {
      current: "synthetic-current",
      next: "synthetic-next",
    })),
    "unknown key should be rejected",
  );
});

Deno.test("fails closed when both configured keys are absent or empty", async () => {
  assert(
    !(await acceptsCronSecret("synthetic-presented", {})),
    "missing keys should reject",
  );
  assert(
    !(await acceptsCronSecret("synthetic-presented", {
      current: "",
      next: "",
    })),
    "empty keys should reject",
  );
});

Deno.test("rejects missing, empty, and oversized presented values", async () => {
  const slots = { current: "synthetic-current", next: "synthetic-next" };
  assert(!(await acceptsCronSecret(null, slots)), "missing header should reject");
  assert(!(await acceptsCronSecret("", slots)), "empty header should reject");
  assert(
    !(await acceptsCronSecret("x".repeat(4097), slots)),
    "oversized header should reject",
  );
});

Deno.test("retirement rejects the old key and retains the promoted key", async () => {
  const retired = { current: "synthetic-promoted" };
  assert(
    !(await acceptsCronSecret("synthetic-retired", retired)),
    "retired key should be rejected",
  );
  assert(
    await acceptsCronSecret("synthetic-promoted", retired),
    "promoted key should remain accepted",
  );
});

Deno.test("reads current and next slots without exposing their values", async () => {
  const environment = new Map([
    ["CRON_SECRET", "synthetic-current"],
    ["CRON_SECRET_NEXT", "synthetic-next"],
  ]);
  const headers = new Headers({ "x-cron-secret": "synthetic-next" });
  assert(
    await hasValidCronSecret(headers, (name) => environment.get(name)),
    "next environment slot should be accepted",
  );
});
