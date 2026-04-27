/**
 * /strategy/debug — W8 Strategy Debug Panel
 *
 * Read-only inspector for the full Strategy reasoning pipeline
 * (W3 → W7.5) on a per-message or per-task-run basis.
 *
 * Doctrine:
 *   - Read-only. Never writes, never re-runs generation.
 *   - Degrades gracefully when metadata blocks are missing.
 *   - Renders raw JSON via expanders for forensic inspection.
 *   - Source data: strategy_messages.content_json / task_runs.meta.
 */
import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  type LayerStatus,
  type LayerSummary,
  parseChatMessageTelemetry,
  parseTaskRunTelemetry,
  type StrategyTelemetrySummary,
} from "@/lib/strategy/debug/parseStrategyTelemetry";
import {
  type SchemaHealthSummary,
  type SchemaReport,
  type SchemaStatus,
  validateChatMessageSchema,
  validateTaskRunSchema,
} from "@/lib/strategy/debug/schemaValidators";
import {
  compareSchemaHealth,
  type PersistedSchemaHealth,
  readPersistedSchemaHealth,
} from "@/lib/strategy/debug/persistedSchemaHealth";
import {
  type DriftHistorySummary,
  summarizeDriftHistory,
} from "@/lib/strategy/debug/driftHistory";
import { useApprovalCheck } from "@/hooks/useApprovalCheck";

type RecordKind = "message" | "run";

interface FetchedRow {
  kind: RecordKind;
  id: string;
  createdAt: string | null;
  meta: unknown;
  /** Anything else worth showing at the top of the panel. */
  context: Record<string, unknown>;
}

// ─── UI primitives ───────────────────────────────────────────────

function StatusGlyph({ status }: { status: LayerStatus }) {
  if (status === "ran") {
    return <CheckCircle2 className="h-4 w-4 text-primary" />;
  }
  if (status === "skipped") {
    return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
  if (status === "failed") {
    return <XCircle className="h-4 w-4 text-destructive" />;
  }
  return <Clock className="h-4 w-4 text-muted-foreground/60" />;
}

function StatusBadge({ status }: { status: LayerStatus }) {
  const variant: Record<LayerStatus, "default" | "secondary" | "destructive" | "outline"> = {
    ran: "default",
    skipped: "secondary",
    failed: "destructive",
    missing: "outline",
  };
  return (
    <Badge variant={variant[status]} className="text-[10px] uppercase">
      {status}
    </Badge>
  );
}

function JsonExpander({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  if (data === null || data === undefined) {
    return (
      <p className="text-xs text-muted-foreground italic">no payload</p>
    );
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
          <ChevronDown
            className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          />
          {open ? "Hide JSON" : "Show JSON"}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-2 max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-[11px] font-mono leading-relaxed">
          {JSON.stringify(data, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function LayerRow({ layer }: { layer: LayerSummary }) {
  return (
    <div className="rounded-md border bg-card/40 p-3">
      <div className="flex items-start gap-3">
        <StatusGlyph status={layer.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono text-muted-foreground">
              {layer.wave}
            </span>
            <span className="font-medium text-sm">{layer.label}</span>
            <StatusBadge status={layer.status} />
          </div>
          <p className="text-xs text-muted-foreground mt-1 break-words">
            {layer.summary}
          </p>
          <div className="mt-2">
            <JsonExpander data={layer.raw} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryBadges({
  summary,
}: {
  summary: StrategyTelemetrySummary;
}) {
  const { badges } = summary;
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="outline" className="gap-1">
        STANDARD:{" "}
        <span className="font-mono">
          {badges.standardContextInjected === null
            ? "—"
            : badges.standardContextInjected
            ? "injected"
            : "skipped"}
        </span>
      </Badge>
      <Badge variant="outline" className="gap-1">
        CALIBRATION:{" "}
        <span className="font-mono">{badges.calibrationVerdict ?? "—"}</span>
      </Badge>
      <Badge
        variant={badges.gateFailures > 0 ? "destructive" : "outline"}
        className="gap-1"
      >
        Gate fails: {badges.gateFailures}
      </Badge>
      <Badge
        variant={badges.citationIssues > 0 ? "destructive" : "outline"}
        className="gap-1"
      >
        Citation issues: {badges.citationIssues}
      </Badge>
      <Badge variant="outline" className="gap-1">
        Escalations: {badges.escalationCount}
      </Badge>
    </div>
  );
}

// ─── Schema health (W9) ──────────────────────────────────────────

function SchemaStatusBadge({ status }: { status: SchemaStatus }) {
  const variant: Record<
    SchemaStatus,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    valid: "default",
    missing: "outline",
    malformed: "destructive",
  };
  return (
    <Badge variant={variant[status]} className="text-[10px] uppercase">
      {status}
    </Badge>
  );
}

function SchemaReportRow({ report }: { report: SchemaReport }) {
  const hasUnknown = report.unknownFields.length > 0;
  return (
    <div className="rounded-md border bg-card/30 p-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono text-muted-foreground">
          {report.wave}
        </span>
        <span className="font-medium text-xs">{report.label}</span>
        <SchemaStatusBadge status={report.status} />
        {hasUnknown && (
          <Badge
            variant="secondary"
            className="text-[10px] gap-1"
          >
            +{report.unknownFields.length} unknown
          </Badge>
        )}
      </div>
      {(report.missingFields.length > 0 ||
        report.invalidFields.length > 0 ||
        report.notes.length > 0 ||
        hasUnknown) && (
        <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
          {report.missingFields.length > 0 && (
            <p>
              <span className="font-mono text-destructive">missing:</span>{" "}
              {report.missingFields.join(", ")}
            </p>
          )}
          {report.invalidFields.length > 0 && (
            <p>
              <span className="font-mono text-destructive">invalid:</span>{" "}
              {report.invalidFields.join(", ")}
            </p>
          )}
          {hasUnknown && (
            <p>
              <span className="font-mono text-foreground/80">unknown:</span>{" "}
              {report.unknownFields.join(", ")}
            </p>
          )}
          {report.notes.map((n, i) => (
            <p key={i} className="italic">
              {n}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function SchemaHealthCard({ health }: { health: SchemaHealthSummary }) {
  const { totals, reports } = health;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          Schema Health
          <Badge variant="outline" className="text-[10px]">
            read-only
          </Badge>
        </CardTitle>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="default" className="gap-1">
            valid: {totals.valid}
          </Badge>
          <Badge variant="outline" className="gap-1">
            missing: {totals.missing}
          </Badge>
          <Badge
            variant={totals.malformed > 0 ? "destructive" : "outline"}
            className="gap-1"
          >
            malformed: {totals.malformed}
          </Badge>
          <Badge variant="secondary" className="gap-1">
            unknown fields: {totals.unknownFieldWarnings}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {reports.map((r) => (
          <SchemaReportRow key={r.key} report={r} />
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Panels ──────────────────────────────────────────────────────

function RecordPanel({ row }: { row: FetchedRow | null }) {
  const summary = useMemo<StrategyTelemetrySummary | null>(() => {
    if (!row) return null;
    return row.kind === "message"
      ? parseChatMessageTelemetry(row.meta)
      : parseTaskRunTelemetry(row.meta);
  }, [row]);

  const health = useMemo<SchemaHealthSummary | null>(() => {
    if (!row) return null;
    return row.kind === "message"
      ? validateChatMessageSchema(row.meta)
      : validateTaskRunSchema(row.meta);
  }, [row]);

  if (!row) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Enter a strategy_messages id or task_runs id above to inspect its
          reasoning pipeline.
        </CardContent>
      </Card>
    );
  }

  if (!summary) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {row.kind === "message" ? "Chat Message" : "Task Run"}
            <span className="text-xs font-mono text-muted-foreground">
              {row.id}
            </span>
          </CardTitle>
          {row.createdAt && (
            <p className="text-xs text-muted-foreground">
              {new Date(row.createdAt).toLocaleString()}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <SummaryBadges summary={summary} />
          {Object.keys(row.context).length > 0 && (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-medium mb-1">Context</p>
              <pre className="text-[11px] font-mono">
                {JSON.stringify(row.context, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Pipeline Timeline ({summary.layers.length} layers)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {summary.layers.map((layer) => (
            <LayerRow key={layer.key} layer={layer} />
          ))}
        </CardContent>
      </Card>

      {health && <SchemaHealthCard health={health} />}
      {row && (() => {
        const persisted = readPersistedSchemaHealth(row.meta);
        if (!persisted) {
          return (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Persisted Schema Health (W10)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  No persisted <code>schema_health</code> on this row — falling back to live W9 validation above.
                </p>
              </CardContent>
            </Card>
          );
        }
        const drift = health
          ? compareSchemaHealth(
              persisted,
              health.totals,
              health.reports.filter((r) => r.status === "malformed").map((r) => r.key),
            )
          : { drifted: false, reasons: [] };
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                Persisted Schema Health (W10)
                <Badge variant={persisted.status === "drift" ? "destructive" : persisted.status === "validator_error" ? "destructive" : "default"} className="text-[10px] uppercase">
                  {persisted.status}
                </Badge>
                {drift.drifted && (
                  <Badge variant="destructive" className="text-[10px] uppercase">drift vs live</Badge>
                )}
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">
                stamped {persisted.validated_at} · schema {persisted.schema_version}
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant="default">valid: {persisted.totals.valid}</Badge>
                <Badge variant="outline">missing: {persisted.totals.missing}</Badge>
                <Badge variant={persisted.totals.malformed > 0 ? "destructive" : "outline"}>
                  malformed: {persisted.totals.malformed}
                </Badge>
                <Badge variant="secondary">unknown fields: {persisted.totals.unknownFieldWarnings}</Badge>
              </div>
              {persisted.malformed_keys.length > 0 && (
                <p className="text-[11px]"><span className="font-mono text-destructive">malformed:</span> {persisted.malformed_keys.join(", ")}</p>
              )}
              {drift.drifted && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 space-y-1">
                  <p className="text-[11px] font-medium">Drift vs live validation:</p>
                  {drift.reasons.map((r, i) => (
                    <p key={i} className="text-[11px] font-mono text-muted-foreground">{r}</p>
                  ))}
                </div>
              )}
              {persisted.error && (
                <p className="text-[11px] text-destructive">validator error: {persisted.error}</p>
              )}
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}

// ─── Recent rows sidebar ─────────────────────────────────────────

interface RecentItem {
  id: string;
  createdAt: string | null;
  label: string;
}

function RecentList({
  title,
  items,
  loading,
  onPick,
}: {
  title: string;
  items: RecentItem[];
  loading: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {loading && (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
        {!loading && items.length === 0 && (
          <p className="text-xs text-muted-foreground">No recent rows.</p>
        )}
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => onPick(it.id)}
            className="w-full text-left px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors"
          >
            <p className="text-xs font-mono truncate">{it.id}</p>
            <p className="text-[10px] text-muted-foreground truncate">
              {it.label}
              {it.createdAt
                ? ` · ${new Date(it.createdAt).toLocaleTimeString()}`
                : ""}
            </p>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────

export default function StrategyDebug() {
  const approvalStatus = useApprovalCheck();
  const approvalLoading = approvalStatus === "loading";
  const allowed = approvalStatus === "approved" || approvalStatus === "skipped";
  const [tab, setTab] = useState<RecordKind>("message");
  const [idInput, setIdInput] = useState("");
  const [row, setRow] = useState<FetchedRow | null>(null);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [recentMessages, setRecentMessages] = useState<RecentItem[]>([]);
  const [recentRuns, setRecentRuns] = useState<RecentItem[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);

  const [history, setHistory] = useState<{
    chat: DriftHistorySummary;
    task: DriftHistorySummary;
  } | null>(null);

  const loadRecent = async () => {
    setRecentLoading(true);
    try {
      const [{ data: msgs }, { data: runs }] = await Promise.all([
        supabase
          .from("strategy_messages")
          .select("id, created_at, role, message_type, content_json")
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("task_runs")
          .select("id, created_at, task_type, status, meta")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      const safeMsgs = msgs ?? [];
      const safeRuns = runs ?? [];
      setRecentMessages(
        safeMsgs.slice(0, 15).map((m: any) => ({
          id: m.id,
          createdAt: m.created_at,
          label: `${m.role ?? "?"} · ${m.message_type ?? ""}`,
        })),
      );
      setRecentRuns(
        safeRuns.slice(0, 15).map((r: any) => ({
          id: r.id,
          createdAt: r.created_at,
          label: `${r.task_type ?? "?"} · ${r.status ?? ""}`,
        })),
      );
      setHistory({
        chat: summarizeDriftHistory(
          "chat",
          safeMsgs.map((m: any) => m.content_json),
        ),
        task: summarizeDriftHistory(
          "task",
          safeRuns.map((r: any) => r.meta),
        ),
      });
    } finally {
      setRecentLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  const fetchRow = async (id: string, kind: RecordKind) => {
    setFetching(true);
    setFetchErr(null);
    setRow(null);
    try {
      if (kind === "message") {
        const { data, error } = await supabase
          .from("strategy_messages")
          .select(
            "id, created_at, role, message_type, model_used, provider_used, content_json",
          )
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          setFetchErr("No strategy_messages row with that id.");
          return;
        }
        setRow({
          kind: "message",
          id: data.id,
          createdAt: data.created_at,
          meta: data.content_json,
          context: {
            role: data.role,
            message_type: data.message_type,
            model: data.model_used,
            provider: data.provider_used,
          },
        });
      } else {
        const { data, error } = await supabase
          .from("task_runs")
          .select(
            "id, created_at, task_type, status, account_id, opportunity_id, meta",
          )
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          setFetchErr("No task_runs row with that id.");
          return;
        }
        setRow({
          kind: "run",
          id: data.id,
          createdAt: data.created_at,
          meta: data.meta,
          context: {
            task_type: data.task_type,
            status: data.status,
            account_id: data.account_id,
            opportunity_id: data.opportunity_id,
          },
        });
      }
    } catch (e: any) {
      setFetchErr(e?.message ?? "Failed to load row.");
    } finally {
      setFetching(false);
    }
  };

  if (approvalLoading) {
    return (
      <Layout>
        <div className="p-8 text-sm text-muted-foreground">Loading…</div>
      </Layout>
    );
  }

  if (!allowed) {
    return (
      <Layout>
        <div className="p-8 max-w-xl mx-auto">
          <Card>
            <CardContent className="p-6 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <p className="text-sm">
                Strategy Debug is restricted to approved users.
              </p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">Strategy Debug Panel</h1>
            <p className="text-xs text-muted-foreground">
              Read-only inspector for W3–W7.5 reasoning telemetry.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadRecent}
            className="gap-1"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
        </div>

        <Card>
          <CardContent className="p-3 flex flex-col md:flex-row gap-2 md:items-center">
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as RecordKind)}
              className="md:w-auto"
            >
              <TabsList>
                <TabsTrigger value="message">Chat Message</TabsTrigger>
                <TabsTrigger value="run">Task Run</TabsTrigger>
              </TabsList>
            </Tabs>
            <Input
              placeholder={
                tab === "message"
                  ? "strategy_messages.id (uuid)"
                  : "task_runs.id (uuid)"
              }
              value={idInput}
              onChange={(e) => setIdInput(e.target.value)}
              className="font-mono text-xs"
            />
            <Button
              onClick={() => fetchRow(idInput.trim(), tab)}
              disabled={!idInput.trim() || fetching}
              size="sm"
            >
              {fetching ? "Loading…" : "Inspect"}
            </Button>
          </CardContent>
        </Card>

        {fetchErr && (
          <Card>
            <CardContent className="p-3 flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {fetchErr}
            </CardContent>
          </Card>
        )}

        <div className="grid md:grid-cols-[1fr_280px] gap-4">
          <RecordPanel row={row} />
          <div className="space-y-4">
            <RecentList
              title="Recent messages"
              items={recentMessages}
              loading={recentLoading}
              onPick={(id) => {
                setTab("message");
                setIdInput(id);
                fetchRow(id, "message");
              }}
            />
            <RecentList
              title="Recent task runs"
              items={recentRuns}
              loading={recentLoading}
              onPick={(id) => {
                setTab("run");
                setIdInput(id);
                fetchRow(id, "run");
              }}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}
