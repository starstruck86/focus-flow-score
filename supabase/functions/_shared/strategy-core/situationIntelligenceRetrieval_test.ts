import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SituationResult } from "../strategy-router/situationClassifier.ts";
import { retrieveSituationIntelligence } from "./situationIntelligenceRetrieval.ts";

type Filter = {
  op: "eq" | "in" | "not";
  column: string;
  value: unknown;
  secondary?: unknown;
};

type Order = { column: string; options: unknown };

interface RecordedQuery {
  table: string;
  selected: string;
  filters: Filter[];
  orders: Order[];
  limit: number | null;
}

interface FakeResponse {
  data: unknown;
  error: unknown;
}

function makeFakeSupabase(
  respond: (query: RecordedQuery, mode: "many" | "maybeSingle") => FakeResponse,
) {
  const queries: RecordedQuery[] = [];

  class QueryBuilder implements PromiseLike<FakeResponse> {
    constructor(readonly query: RecordedQuery) {}

    select(columns: string): this {
      this.query.selected = columns;
      return this;
    }

    eq(column: string, value: unknown): this {
      this.query.filters.push({ op: "eq", column, value });
      return this;
    }

    in(column: string, value: unknown): this {
      this.query.filters.push({ op: "in", column, value });
      return this;
    }

    not(column: string, operator: string, value: unknown): this {
      this.query.filters.push({
        op: "not",
        column,
        value,
        secondary: operator,
      });
      return this;
    }

    order(column: string, options: unknown): this {
      this.query.orders.push({ column, options });
      return this;
    }

    limit(value: number): this {
      this.query.limit = value;
      return this;
    }

    maybeSingle(): Promise<FakeResponse> {
      return Promise.resolve(respond(this.query, "maybeSingle"));
    }

    then<TResult1 = FakeResponse, TResult2 = never>(
      onfulfilled?:
        | ((value: FakeResponse) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(respond(this.query, "many")).then(
        onfulfilled,
        onrejected,
      );
    }
  }

  return {
    from(table: string): QueryBuilder {
      const query: RecordedQuery = {
        table,
        selected: "",
        filters: [],
        orders: [],
        limit: null,
      };
      queries.push(query);
      return new QueryBuilder(query);
    },
    queries,
  };
}

function situation(options: {
  confidence?: "high" | "medium" | "low";
  competitive?: boolean;
  vertical?: boolean;
  names?: string[];
  hints?: string[];
  scopes?: string[];
} = {}): SituationResult {
  return {
    situation: "competitive-evaluation",
    playbookId: null,
    playbookTitle: null,
    confidence: options.confidence ?? "high",
    rationale: "test",
    derivedScopes: options.scopes ?? ["displacement"],
    retrieval: {
      competitive: {
        include: options.competitive ?? false,
        competitorNames: options.names ?? [],
        categoryHints: options.hints ?? [],
      },
      vertical: { include: options.vertical ?? false },
    },
  };
}

function catalogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "intel-default",
    competitor_name: "Default competitor",
    category: "Other",
    positioning: "Default positioning",
    build_vs_buy_talking_points: ["Build point"],
    displacement_questions: ["Displacement question"],
    evidence: ["Evidence point"],
    source_url: "https://example.com/default",
    created_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function hasFilter(
  query: RecordedQuery,
  op: Filter["op"],
  column: string,
  value: unknown,
): boolean {
  return query.filters.some((filter) =>
    filter.op === op && filter.column === column &&
    JSON.stringify(filter.value) === JSON.stringify(value)
  );
}

Deno.test("retriever does not query when neither classifier gate is enabled", async () => {
  const fake = makeFakeSupabase(() => ({ data: [], error: null }));
  const result = await retrieveSituationIntelligence({
    supabase: fake,
    userId: "user-1",
    account: { id: "account-1", vertical_id: "vertical-1" },
    situation: situation(),
  });

  assertEquals(fake.queries.length, 0);
  assertEquals(result.competitiveContext, "");
  assertEquals(result.verticalContext, "");
  assertEquals(result.telemetry.competitive.reason, "classifier_not_requested");
  assertEquals(result.telemetry.vertical.reason, "classifier_not_requested");
});

Deno.test("low classifier confidence fails closed even if both flags are true", async () => {
  const fake = makeFakeSupabase(() => {
    throw new Error("a low-confidence plan must never reach the database");
  });
  const result = await retrieveSituationIntelligence({
    supabase: fake,
    userId: "user-1",
    account: {
      id: "account-1",
      vertical_id: "vertical-1",
      industry: "Financial Services",
    },
    situation: situation({
      confidence: "low",
      competitive: true,
      vertical: true,
      names: ["Adjust"],
      hints: ["MMP"],
    }),
  });

  assertEquals(fake.queries.length, 0);
  assertEquals(result.telemetry.competitive.reason, "low_confidence");
  assertEquals(result.telemetry.vertical.reason, "low_confidence");
  assertEquals(result.telemetry.competitive.queried, false);
  assertEquals(result.telemetry.vertical.queried, false);
});

Deno.test("competitive retrieval scopes account risks and deterministically ranks a bounded global catalog", async () => {
  const catalog = [
    catalogRow({
      id: "branch",
      competitor_name: "Branch",
      category: "MMP",
      source_url: "https://example.com/branch",
      created_at: "2026-07-09T00:00:00Z",
    }),
    catalogRow({
      id: "appsflyer",
      competitor_name: "AppsFlyer",
      category: "MMP",
      source_url: "https://example.com/appsflyer",
      created_at: "2026-07-08T00:00:00Z",
    }),
    catalogRow({
      id: "adjust",
      competitor_name: "Adjust",
      category: "MMP",
      positioning: "Strong\u0000measurement position",
      source_url: "https://example.com/adjust",
      created_at: "2026-07-07T00:00:00Z",
    }),
    catalogRow({
      id: "unrelated",
      competitor_name: "Unrelated CRM",
      category: "CRM",
      positioning: "Unrelated account management content",
      source_url: "https://example.com/unrelated",
      created_at: "2026-07-10T00:00:00Z",
    }),
  ];
  const fake = makeFakeSupabase((query) => {
    if (query.table === "account_risks") {
      return {
        data: [{
          competitor: "Adjust",
          severity: 5,
          likelihood: 5,
          observed_at: "2026-07-09T00:00:00Z",
        }],
        error: null,
      };
    }
    if (query.table === "competitive_intel") {
      return { data: catalog, error: null };
    }
    throw new Error(`unexpected table ${query.table}`);
  });

  const result = await retrieveSituationIntelligence({
    supabase: fake,
    userId: "user-1",
    account: { id: "account-1" },
    situation: situation({
      competitive: true,
      names: ["AppsFlyer"],
      hints: ["MMP"],
      scopes: ["measurement"],
    }),
  });

  const riskQuery = fake.queries.find((query) =>
    query.table === "account_risks"
  );
  const catalogQuery = fake.queries.find((query) =>
    query.table === "competitive_intel"
  );
  assert(riskQuery);
  assert(catalogQuery);
  assert(hasFilter(riskQuery, "eq", "user_id", "user-1"));
  assert(hasFilter(riskQuery, "eq", "account_id", "account-1"));
  assert(hasFilter(riskQuery, "eq", "risk_type", "competitor_presence"));
  assert(hasFilter(
    riskQuery,
    "in",
    "status",
    ["identified", "monitoring", "mitigating", "realized"],
  ));
  assertEquals(
    riskQuery.orders.map((order) => order.column),
    ["severity", "likelihood", "observed_at"],
  );
  assertEquals(riskQuery.limit, 10);
  assertEquals(catalogQuery.limit, 100);
  assertEquals(catalogQuery.orders.map((order) => order.column), [
    "created_at",
  ]);
  assertEquals(
    catalogQuery.filters.some((filter) => filter.column === "user_id"),
    false,
    "competitive_intel is a global catalog and has no user_id column",
  );

  assertEquals(result.competitiveSources.map((source) => source.title), [
    "Adjust",
    "AppsFlyer",
    "Branch",
  ]);
  assert(
    result.competitiveContext.indexOf("Competitor: Adjust") <
      result.competitiveContext.indexOf("Competitor: AppsFlyer"),
  );
  assertEquals(result.competitiveContext.includes("Unrelated CRM"), false);
  assertEquals(result.competitiveContext.includes("\u0000"), false);
  assertEquals(result.telemetry.competitive.matched, 3);
  assertEquals(result.telemetry.competitive.reason, "matched");
});

Deno.test("competitive retrieval never opens the catalog without a named or category signal", async () => {
  const fake = makeFakeSupabase((query) => {
    if (query.table === "account_risks") return { data: [], error: null };
    throw new Error("catalog must not be queried without a signal");
  });
  const result = await retrieveSituationIntelligence({
    supabase: fake,
    userId: "user-1",
    account: { id: "account-1" },
    situation: situation({ competitive: true, scopes: ["competitive"] }),
  });

  assertEquals(
    fake.queries.filter((query) => query.table === "competitive_intel").length,
    0,
  );
  assertEquals(result.competitiveContext, "");
  assertEquals(
    result.telemetry.competitive.reason,
    "no_named_or_category_signal",
  );
  assertEquals(result.telemetry.competitive.queried, true);
});

Deno.test("competitive rendering caps rows, each record, and the whole block including truncation markers", async () => {
  const rows = Array.from({ length: 4 }, (_, index) =>
    catalogRow({
      id: `vendor-${index}`,
      competitor_name: `Vendor ${index}`,
      category: "MMP",
      positioning: `Position ${index} ${"x".repeat(3_000)}`,
      evidence: [{ body: "e".repeat(1_000) }, "second", "third", "fourth"],
      source_url: `https://example.com/vendor-${index}`,
      created_at: `2026-07-0${index + 1}T00:00:00Z`,
    }));
  const fake = makeFakeSupabase((query) => {
    if (query.table === "competitive_intel") return { data: rows, error: null };
    throw new Error(`unexpected table ${query.table}`);
  });
  const result = await retrieveSituationIntelligence({
    supabase: fake,
    userId: "user-1",
    account: null,
    situation: situation({ competitive: true, hints: ["MMP"] }),
  });

  const records = result.competitiveContext.split("\n\n");
  assert(result.competitiveContext.length <= 5_000);
  assert(records.length <= 3);
  assert(records.every((record) => record.length <= 1_800));
  assert(result.competitiveSources.length <= 3);
  assertStringIncludes(result.competitiveContext, "[…truncated]");
  assertEquals(result.telemetry.competitive.truncated, true);
});

Deno.test("competitive catalog errors fail soft with stable content-free telemetry", async () => {
  const fake = makeFakeSupabase((query) => {
    if (query.table === "competitive_intel") {
      return {
        data: null,
        error: { message: "password=secret internal database detail" },
      };
    }
    throw new Error(`unexpected table ${query.table}`);
  });
  const result = await retrieveSituationIntelligence({
    supabase: fake,
    userId: "user-1",
    account: null,
    situation: situation({ competitive: true, names: ["Adjust"] }),
  });

  assertEquals(result.competitiveContext, "");
  assertEquals(result.competitiveSources, []);
  assertEquals(result.telemetry.competitive.reason, "catalog_error");
  assertEquals(result.telemetry.competitive.error, "catalog_query_failed");
  assertEquals(JSON.stringify(result.telemetry).includes("password"), false);
  assertEquals(JSON.stringify(result.telemetry).includes("secret"), false);
});

Deno.test("vertical retrieval verifies account.vertical_id and scopes both owned tables", async () => {
  const fake = makeFakeSupabase((query, mode) => {
    if (query.table === "verticals" && mode === "maybeSingle") {
      return {
        data: { id: "vertical-finserv", name: "Financial Services" },
        error: null,
      };
    }
    if (query.table === "vertical_briefs" && mode === "maybeSingle") {
      return {
        data: {
          id: "brief-2",
          vertical_id: "vertical-finserv",
          version: 2,
          pov_deck_md: "# Industry POV\n\nVerified market framing.",
          rendered_at: "2026-07-09T12:30:00Z",
        },
        error: null,
      };
    }
    throw new Error(`unexpected ${query.table} ${mode}`);
  });
  const result = await retrieveSituationIntelligence({
    supabase: fake,
    userId: "user-1",
    account: {
      id: "account-1",
      vertical_id: "vertical-finserv",
      industry: "Ignored fallback",
    },
    situation: situation({ vertical: true }),
  });

  const verticalQuery = fake.queries.find((query) =>
    query.table === "verticals"
  );
  const briefQuery = fake.queries.find((query) =>
    query.table === "vertical_briefs"
  );
  assert(verticalQuery);
  assert(briefQuery);
  assert(hasFilter(verticalQuery, "eq", "user_id", "user-1"));
  assert(hasFilter(verticalQuery, "eq", "id", "vertical-finserv"));
  assert(hasFilter(briefQuery, "eq", "user_id", "user-1"));
  assert(hasFilter(briefQuery, "eq", "vertical_id", "vertical-finserv"));
  assert(hasFilter(briefQuery, "eq", "is_current", true));
  assert(
    briefQuery.filters.some((filter) =>
      filter.op === "not" && filter.column === "pov_deck_md" &&
      filter.secondary === "is" && filter.value === null
    ),
  );
  assertEquals(briefQuery.orders.map((order) => order.column), ["version"]);
  assertEquals(briefQuery.limit, 1);
  assertStringIncludes(
    result.verticalContext,
    "[Vertical: Financial Services | Brief v2 | Rendered: 2026-07-09]",
  );
  assertStringIncludes(result.verticalContext, "Verified market framing.");
  assertEquals(result.verticalSource, {
    id: "brief-2",
    title: "Financial Services POV",
    version: 2,
    renderedAt: "2026-07-09T12:30:00.000Z",
  });
  assertEquals(result.telemetry.vertical.matched, true);
});

Deno.test("vertical fallback uses only one normalized exact industry match", async () => {
  const fake = makeFakeSupabase((query, mode) => {
    if (query.table === "verticals" && mode === "many") {
      return {
        data: [
          { id: "finserv", name: "Financial Services" },
          { id: "health", name: "Healthcare" },
        ],
        error: null,
      };
    }
    if (query.table === "vertical_briefs" && mode === "maybeSingle") {
      return {
        data: {
          id: "brief-finserv",
          vertical_id: "finserv",
          version: 7,
          pov_deck_md: "Exact-match deck",
          rendered_at: "2026-07-10T00:00:00Z",
        },
        error: null,
      };
    }
    throw new Error(`unexpected ${query.table} ${mode}`);
  });
  const result = await retrieveSituationIntelligence({
    supabase: fake,
    userId: "user-1",
    account: { id: "account-1", industry: "  financial   services  " },
    situation: situation({ vertical: true }),
  });

  const verticalQuery = fake.queries.find((query) =>
    query.table === "verticals"
  );
  assert(verticalQuery);
  assert(hasFilter(verticalQuery, "eq", "user_id", "user-1"));
  assertEquals(
    verticalQuery.filters.some((filter) => filter.column === "name"),
    false,
    "industry fallback is matched locally and never uses fuzzy SQL",
  );
  assertEquals(verticalQuery.limit, 100);
  assertStringIncludes(result.verticalContext, "Exact-match deck");
});

Deno.test("ambiguous exact industry fallback never queries vertical_briefs", async () => {
  const fake = makeFakeSupabase((query) => {
    if (query.table === "verticals") {
      return {
        data: [
          { id: "finserv-a", name: "Financial Services" },
          { id: "finserv-b", name: " financial  services " },
        ],
        error: null,
      };
    }
    throw new Error("ambiguous vertical must not authorize a brief query");
  });
  const result = await retrieveSituationIntelligence({
    supabase: fake,
    userId: "user-1",
    account: { id: "account-1", industry: "Financial Services" },
    situation: situation({ vertical: true }),
  });

  assertEquals(
    fake.queries.filter((query) => query.table === "vertical_briefs").length,
    0,
  );
  assertEquals(result.verticalContext, "");
  assertEquals(result.telemetry.vertical.reason, "vertical_unmapped");
  assertEquals(result.telemetry.vertical.queried, true);
});

Deno.test("vertical output caps metadata, deck, and truncation marker at 5000 chars", async () => {
  const fake = makeFakeSupabase((query) => {
    if (query.table === "verticals") {
      return { data: { id: "vertical-1", name: "Healthcare" }, error: null };
    }
    if (query.table === "vertical_briefs") {
      return {
        data: {
          id: "brief-long",
          vertical_id: "vertical-1",
          version: 3,
          pov_deck_md: `# Long POV\n\n${"paragraph ".repeat(1_000)}`,
          rendered_at: "2026-07-10T00:00:00Z",
        },
        error: null,
      };
    }
    throw new Error(`unexpected table ${query.table}`);
  });
  const result = await retrieveSituationIntelligence({
    supabase: fake,
    userId: "user-1",
    account: { id: "account-1", vertical_id: "vertical-1" },
    situation: situation({ vertical: true }),
  });

  assert(result.verticalContext.length <= 5_000);
  assertStringIncludes(result.verticalContext, "[…truncated]");
  assertEquals(result.telemetry.vertical.truncated, true);
});

Deno.test("vertical lookup errors fail soft and never expose database details", async () => {
  const fake = makeFakeSupabase((query) => {
    if (query.table === "verticals") {
      return {
        data: null,
        error: { message: "postgres secret tenant detail" },
      };
    }
    throw new Error(`unexpected table ${query.table}`);
  });
  const result = await retrieveSituationIntelligence({
    supabase: fake,
    userId: "user-1",
    account: { id: "account-1", vertical_id: "vertical-1" },
    situation: situation({ vertical: true }),
  });

  assertEquals(result.verticalContext, "");
  assertEquals(result.verticalSource, null);
  assertEquals(result.telemetry.vertical.reason, "vertical_error");
  assertEquals(result.telemetry.vertical.error, "vertical_lookup_failed");
  assertEquals(JSON.stringify(result.telemetry).includes("postgres"), false);
  assertEquals(JSON.stringify(result.telemetry).includes("secret"), false);
});
