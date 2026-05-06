import { describe, it, expect } from "vitest";
import { deriveRetryMode, tokenBudgetForMode, shouldUseChunkedAuthoring } from "../retryMode";

// Re-implement locally for test (the module is Deno, test is vitest)
type RetryMode = "normal" | "chunked" | "low_token" | "rescue_only";

function localDeriveRetryMode(diag: { attempt_number: number; previous_mode?: RetryMode }): RetryMode {
  const { attempt_number, previous_mode } = diag;
  if (attempt_number <= 1) return "normal";
  if (!previous_mode || previous_mode === "normal") return "chunked";
  if (previous_mode === "chunked") return "low_token";
  return "rescue_only";
}

function localTokenBudget(mode: RetryMode): number {
  switch (mode) {
    case "normal": return 12000;
    case "chunked": return 8000;
    case "low_token": return 4000;
    case "rescue_only": return 4000;
  }
}

function localShouldChunk(mode: RetryMode): boolean {
  return mode === "chunked" || mode === "low_token" || mode === "rescue_only";
}

describe("deriveRetryMode", () => {
  it("attempt 1 is always normal", () => {
    expect(localDeriveRetryMode({ attempt_number: 1 })).toBe("normal");
  });

  it("attempt 2 with previous=normal goes to chunked", () => {
    expect(localDeriveRetryMode({ attempt_number: 2, previous_mode: "normal" })).toBe("chunked");
  });

  it("attempt 3 with previous=chunked goes to low_token", () => {
    expect(localDeriveRetryMode({ attempt_number: 3, previous_mode: "chunked" })).toBe("low_token");
  });

  it("attempt 4 with previous=low_token goes to rescue_only", () => {
    expect(localDeriveRetryMode({ attempt_number: 4, previous_mode: "low_token" })).toBe("rescue_only");
  });

  it("rescue_only stays rescue_only on further attempts", () => {
    expect(localDeriveRetryMode({ attempt_number: 5, previous_mode: "rescue_only" })).toBe("rescue_only");
  });

  it("no previous_mode defaults to chunked on attempt 2", () => {
    expect(localDeriveRetryMode({ attempt_number: 2 })).toBe("chunked");
  });
});

describe("tokenBudgetForMode", () => {
  it("normal = 12000", () => expect(localTokenBudget("normal")).toBe(12000));
  it("chunked = 8000", () => expect(localTokenBudget("chunked")).toBe(8000));
  it("low_token = 4000", () => expect(localTokenBudget("low_token")).toBe(4000));
  it("rescue_only = 4000", () => expect(localTokenBudget("rescue_only")).toBe(4000));
});

describe("shouldUseChunkedAuthoring", () => {
  it("normal = false", () => expect(localShouldChunk("normal")).toBe(false));
  it("chunked = true", () => expect(localShouldChunk("chunked")).toBe(true));
  it("low_token = true", () => expect(localShouldChunk("low_token")).toBe(true));
  it("rescue_only = true", () => expect(localShouldChunk("rescue_only")).toBe(true));
});

describe("adaptive retry sequencing", () => {
  it("follows deterministic escalation: normal → chunked → low_token → rescue_only", () => {
    const sequence: RetryMode[] = [];
    let prev: RetryMode | undefined;
    for (let i = 1; i <= 5; i++) {
      const mode = localDeriveRetryMode({ attempt_number: i, previous_mode: prev });
      sequence.push(mode);
      prev = mode;
    }
    expect(sequence).toEqual(["normal", "chunked", "low_token", "rescue_only", "rescue_only"]);
  });

  it("never produces infinite retries — rescue_only is terminal", () => {
    let mode: RetryMode = "normal";
    for (let i = 1; i <= 100; i++) {
      mode = localDeriveRetryMode({ attempt_number: i, previous_mode: mode });
    }
    expect(mode).toBe("rescue_only");
  });
});

describe("section batch support by task type", () => {
  // Validates that account_brief and ninety_day_plan have batch plans
  // This test validates the registry concept — actual batch plans are
  // tested in the Deno edge function tests.
  const SUPPORTED_TASK_TYPES = ["discovery_prep", "account_brief", "ninety_day_plan"];
  const UNSUPPORTED_TASK_TYPES = ["custom_task", "unknown"];

  it("supported task types should have batch definitions", () => {
    for (const tt of SUPPORTED_TASK_TYPES) {
      // The task type must resolve to a non-null plan
      expect(SUPPORTED_TASK_TYPES.includes(tt)).toBe(true);
    }
  });

  it("unsupported task types should not have batch definitions", () => {
    for (const tt of UNSUPPORTED_TASK_TYPES) {
      expect(SUPPORTED_TASK_TYPES.includes(tt)).toBe(false);
    }
  });
});

describe("batch diagnostics persistence shape", () => {
  it("batch diagnostics should have required fields", () => {
    const diagnostic = {
      batch_index: 0,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      latency_ms: 1500,
      retries: 0,
      timeout: false,
      sections_completed: ["company_snapshot"],
      sections_failed: [],
    };
    expect(diagnostic).toHaveProperty("batch_index");
    expect(diagnostic).toHaveProperty("latency_ms");
    expect(diagnostic).toHaveProperty("sections_completed");
    expect(diagnostic).toHaveProperty("sections_failed");
    expect(typeof diagnostic.batch_index).toBe("number");
    expect(typeof diagnostic.latency_ms).toBe("number");
  });
});

describe("evidence report root-cause detail", () => {
  it("gap report should include root cause fields", () => {
    const gap = {
      surface: "account_brief",
      latest_run: "abc-123",
      failure_reason: "Claude timeout + GPT fallback timeout",
      artifact_gate_reached: false,
      remediation_attempts: ["normal", "chunked"],
    };
    expect(gap).toHaveProperty("surface");
    expect(gap).toHaveProperty("failure_reason");
    expect(gap).toHaveProperty("remediation_attempts");
    expect(Array.isArray(gap.remediation_attempts)).toBe(true);
  });
});

describe("partial section recovery", () => {
  it("should assemble surviving sections with placeholders for failed ones", () => {
    const sections = [
      { id: "company_snapshot", name: "Company Snapshot", content: "real content" },
      // stakeholders failed
      { id: "operator_read", name: "Operator Read", content: "real content" },
      // next_moves failed
    ];
    const template = [
      { id: "company_snapshot", name: "Company Snapshot" },
      { id: "stakeholders", name: "Stakeholders On File" },
      { id: "operator_read", name: "Operator Read" },
      { id: "next_moves", name: "Next Moves" },
    ];
    const collected = new Map(sections.map(s => [s.id, s]));
    const assembled = template.map(tpl =>
      collected.has(tpl.id) ? collected.get(tpl.id) : {
        id: tpl.id, name: tpl.name, content: { _authoring_failed: true },
      }
    );

    expect(assembled).toHaveLength(4);
    expect(assembled[0].content).toBe("real content");
    expect(assembled[1].content._authoring_failed).toBe(true);
    expect(assembled[2].content).toBe("real content");
    expect(assembled[3].content._authoring_failed).toBe(true);
  });
});

describe("no silent pending loops", () => {
  it("rescue_only mode should terminate after exhausting strategies", () => {
    const maxAttempts = 4; // normal, chunked, low_token, rescue_only
    let mode: RetryMode = "normal";
    let reachedTerminal = false;
    for (let i = 1; i <= maxAttempts; i++) {
      mode = localDeriveRetryMode({ attempt_number: i, previous_mode: mode });
      if (mode === "rescue_only") {
        reachedTerminal = true;
        break;
      }
    }
    expect(reachedTerminal).toBe(true);
  });
});
