/**
 * Phase Evidence Runner — Admin-only page that triggers real Strategy
 * executions across all enforced surfaces and runs evidence validation.
 *
 * Phase 3 additions:
 *  - Evidence acquisition retry loop (max 3 retries per surface)
 *  - Adaptive retry with deriveRetryMode
 *  - Real-time pipeline inspection (provider, batch, elapsed time)
 *  - Extended polling for progressive tasks (discovery_prep: 25 min)
 *  - Root-cause evidence report
 */

import { useState, useCallback } from "react";
import { SafePage } from "@/components/SafePage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type SurfaceStatus = "idle" | "running" | "pass" | "fail" | "error" | "retrying";
type RetryMode = "normal" | "chunked" | "low_token" | "rescue_only";

interface SurfaceEntry {
  id: string;
  label: string;
  status: SurfaceStatus;
  detail?: string;
  runId?: string;
  retryCount: number;
  retryMode?: RetryMode;
  diagnosticsHistory: string[];
  pipelineState?: {
    elapsed_s: number;
    progress_step: string;
    provider?: string;
    batch_info?: string;
    remediation_mode?: string;
  };
}

const MAX_RETRIES = 3;

// Polling configuration per task type
const POLL_CONFIG: Record<string, { max_polls: number; interval_ms: number }> = {
  discovery_prep: { max_polls: 300, interval_ms: 5000 },  // 25 min
  account_brief: { max_polls: 90, interval_ms: 5000 },    // 7.5 min
  ninety_day_plan: { max_polls: 90, interval_ms: 5000 },  // 7.5 min
};
const DEFAULT_POLL = { max_polls: 60, interval_ms: 5000 }; // 5 min

function deriveRetryMode(attempt: number, previousMode?: RetryMode): RetryMode {
  if (attempt <= 1) return "normal";
  if (!previousMode || previousMode === "normal") return "chunked";
  if (previousMode === "chunked") return "low_token";
  return "rescue_only";
}

function retryModeLabel(mode: RetryMode): string {
  switch (mode) {
    case "normal": return "Normal generation";
    case "chunked": return "Section-chunked generation";
    case "low_token": return "Low-token chunked generation";
    case "rescue_only": return "Final rescue attempt";
  }
}

function parseProgressStep(step: string): { batch_info?: string; provider?: string } {
  const batchMatch = step.match(/batch_(\d+)_of_(\d+)/);
  if (batchMatch) {
    return { batch_info: `Batch ${batchMatch[1]}/${batchMatch[2]}` };
  }
  return {};
}

const INITIAL_SURFACES: SurfaceEntry[] = [
  { id: "account_brief", label: "Account Brief (task)", status: "idle", retryCount: 0, diagnosticsHistory: [] },
  { id: "ninety_day_plan", label: "90-Day Plan (task)", status: "idle", retryCount: 0, diagnosticsHistory: [] },
  { id: "discovery_prep", label: "Discovery Prep (progressive)", status: "idle", retryCount: 0, diagnosticsHistory: [] },
  { id: "demo-strategy", label: "Demo Strategy (chat)", status: "idle", retryCount: 0, diagnosticsHistory: [] },
  { id: "discovery-questions", label: "Discovery Questions (chat)", status: "idle", retryCount: 0, diagnosticsHistory: [] },
  { id: "docx-render", label: "DOCX Render (transform)", status: "idle", retryCount: 0, diagnosticsHistory: [] },
  { id: "evidence-report", label: "Evidence Report Update", status: "idle", retryCount: 0, diagnosticsHistory: [] },
];

export default function PhaseEvidenceRunner() {
  const { user } = useAuth();
  const [surfaces, setSurfaces] = useState<SurfaceEntry[]>(INITIAL_SURFACES);
  const [running, setRunning] = useState(false);

  const update = useCallback((id: string, patch: Partial<SurfaceEntry>) => {
    setSurfaces(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }, []);

  // ── Task triggers with adaptive retry loop ────────────────────
  async function triggerTaskWithRetry(taskType: string, surfaceId: string) {
    let retryCount = 0;
    let currentMode: RetryMode = "normal";
    const diagnosticsHistory: string[] = [];

    while (retryCount <= MAX_RETRIES) {
      const isRetry = retryCount > 0;
      currentMode = deriveRetryMode(retryCount, isRetry ? currentMode : undefined);

      update(surfaceId, {
        status: isRetry ? "retrying" : "running",
        detail: isRetry
          ? `Retry ${retryCount}/${MAX_RETRIES} — ${retryModeLabel(currentMode)}`
          : `Starting — ${retryModeLabel(currentMode)}`,
        retryCount,
        retryMode: currentMode,
        diagnosticsHistory,
      });

      const startTime = Date.now();

      try {
        const { data: accounts } = await supabase
          .from("accounts" as any)
          .select("id, name")
          .limit(1)
          .single();

        const companyName = (accounts as any)?.name || "Acme Corp";

        const { data, error } = await supabase.functions.invoke("run-strategy-task", {
          body: {
            action: "generate",
            task_type: taskType,
            inputs: { company_name: companyName },
          },
        });
        if (error) throw error;
        const runId = data?.run_id;
        update(surfaceId, {
          status: isRetry ? "retrying" : "running",
          detail: `run_id: ${runId} — ${retryModeLabel(currentMode)}`,
          runId,
          retryMode: currentMode,
        });

        // Poll for completion with task-specific timeout
        const pollCfg = POLL_CONFIG[taskType] || DEFAULT_POLL;
        let finalStatus = "timeout";
        let finalDetail = "";
        for (let i = 0; i < pollCfg.max_polls; i++) {
          await new Promise(r => setTimeout(r, pollCfg.interval_ms));
          const elapsed_s = Math.round((Date.now() - startTime) / 1000);

          const { data: status } = await supabase.functions.invoke("run-strategy-task", {
            body: { action: "status", run_id: runId },
          });

          const progressStep = status?.progress_step || "unknown";
          const parsed = parseProgressStep(progressStep);

          // Update pipeline state for real-time inspection
          update(surfaceId, {
            detail: `Polling… step=${progressStep} (attempt ${retryCount + 1}, ${elapsed_s}s)`,
            pipelineState: {
              elapsed_s,
              progress_step: progressStep,
              provider: parsed.provider,
              batch_info: parsed.batch_info,
              remediation_mode: retryModeLabel(currentMode),
            },
          });

          if (status?.status === "completed") {
            const { data: row } = await supabase
              .from("task_runs" as any)
              .select("meta")
              .eq("id", runId)
              .single();
            const meta = (row as any)?.meta;
            const gatePass = meta?.artifact_gate?.pass === true;
            if (gatePass) {
              update(surfaceId, {
                status: "pass",
                detail: `✅ Completed with gate pass: ${runId} (${elapsed_s}s, ${retryModeLabel(currentMode)})`,
                runId,
                retryCount,
                retryMode: currentMode,
                diagnosticsHistory,
                pipelineState: undefined,
              });
              return; // SUCCESS — exit retry loop
            }
            const diags = meta?.artifact_gate?.diagnostics ?? [];
            const diagStr = diags.map((d: any) => `${d.dimension}:${d.requirement}:${d.reason}`).join("; ");
            diagnosticsHistory.push(`attempt${retryCount}[${currentMode}]: completed but gate_pass=false — ${diagStr}`);
            finalStatus = "gate_fail_on_complete";
            finalDetail = diagStr;
            break;
          }
          if (status?.status === "failed") {
            const { data: row } = await supabase
              .from("task_runs" as any)
              .select("meta, error")
              .eq("id", runId)
              .single();
            const meta = (row as any)?.meta;
            const error_msg = status.error || (row as any)?.error || "failed";
            const diags = meta?.artifact_gate?.diagnostics ?? [];
            const diagStr = diags.map((d: any) => `${d.dimension}:${d.requirement}:${d.reason}`).join("; ");
            const failureType = error_msg.includes("timeout") || error_msg.includes("timed out")
              ? "timeout" : "authoring_error";
            diagnosticsHistory.push(`attempt${retryCount}[${currentMode}]: ${failureType} — ${error_msg.slice(0, 200)} — ${diagStr}`);
            finalStatus = "failed";
            finalDetail = error_msg;
            break;
          }
        }

        if (finalStatus === "timeout") {
          const elapsed_s = Math.round((Date.now() - startTime) / 1000);
          diagnosticsHistory.push(`attempt${retryCount}[${currentMode}]: timeout after ${elapsed_s}s`);
        }

        // Should we retry?
        if (currentMode === "rescue_only") {
          // Final mode exhausted — fail honestly
          update(surfaceId, {
            status: "fail",
            detail: `Failed after ${retryCount + 1} attempts (all retry modes exhausted). Last: ${finalDetail}`,
            retryCount,
            retryMode: currentMode,
            diagnosticsHistory,
            pipelineState: undefined,
          });
          return;
        }

        if (retryCount < MAX_RETRIES) {
          retryCount++;
          update(surfaceId, {
            status: "retrying",
            detail: `${finalStatus}: ${finalDetail}. Evolving to ${retryModeLabel(deriveRetryMode(retryCount, currentMode))}…`,
            retryCount,
            diagnosticsHistory,
            pipelineState: undefined,
          });
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        // Max retries exhausted
        update(surfaceId, {
          status: "fail",
          detail: `Failed after ${MAX_RETRIES + 1} attempts. Last: ${finalDetail}`,
          retryCount,
          retryMode: currentMode,
          diagnosticsHistory,
          pipelineState: undefined,
        });
        return;
      } catch (e: any) {
        diagnosticsHistory.push(`attempt${retryCount}[${currentMode}]: ${e.message}`);
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        update(surfaceId, {
          status: "error",
          detail: `Error after ${MAX_RETRIES + 1} attempts: ${e.message}`,
          retryCount,
          retryMode: currentMode,
          diagnosticsHistory,
          pipelineState: undefined,
        });
        return;
      }
    }
  }

  // ── Chat triggers ─────────────────────────────────────────────
  async function triggerChat(manifestKey: string, prompt: string, surfaceId: string) {
    update(surfaceId, { status: "running", detail: "Sending chat…" });
    const payload = {
      threadId: "",
      content: prompt,
      workspace: "work",
    };
    try {
      const { data: threads } = await supabase
        .from("strategy_threads")
        .select("id")
        .order("created_at", { ascending: false })
        .limit(1);

      let threadId = threads?.[0]?.id;
      if (!threadId) {
        const { data: newThread } = await supabase
          .from("strategy_threads")
          .insert({ user_id: user!.id, title: `Evidence: ${manifestKey}` })
          .select("id")
          .single();
        threadId = newThread?.id;
      }
      payload.threadId = threadId;

      const { data, error } = await supabase.functions.invoke("strategy-chat", {
        body: payload,
      });

      if (error) {
        const ctx = (error as any).context;
        let bodyText = "";
        let status = "";
        if (ctx && typeof ctx.json === "function") {
          try { bodyText = JSON.stringify(await ctx.json()); } catch { /* ignore */ }
        } else if (ctx && typeof ctx.text === "function") {
          try { bodyText = await ctx.text(); } catch { /* ignore */ }
        }
        if (ctx?.status) status = String(ctx.status);
        const detail = [
          `HTTP ${status || "?"}`,
          bodyText ? `body: ${bodyText}` : "",
          `msg: ${error.message}`,
        ].filter(Boolean).join(" | ");
        update(surfaceId, { status: "error", detail });
        return;
      }

      const messageId = data?.message_id || data?.id;
      update(surfaceId, {
        status: data ? "pass" : "fail",
        detail: `message_id: ${messageId || "unknown"}, manifest: ${data?.manifest_id || "check DB"}`,
      });
    } catch (e: any) {
      update(surfaceId, { status: "error", detail: e.message });
    }
  }

  // ── DOCX render trigger ───────────────────────────────────────
  async function triggerDocxRender() {
    update("docx-render", { status: "running", detail: "Finding latest task draft…" });
    try {
      const { data, error } = await supabase.functions.invoke("strategy-evidence-render", {
        body: { action: "docx_render" },
      });
      if (error) throw error;
      update("docx-render", {
        status: data?.output_id ? "pass" : "fail",
        detail: `output_id: ${data?.output_id || "none"}, latency: ${data?.latency_ms || 0}ms`,
      });
    } catch (e: any) {
      update("docx-render", { status: "error", detail: e.message });
    }
  }

  // ── Evidence report updater ───────────────────────────────────
  async function triggerEvidenceReport() {
    update("evidence-report", { status: "running", detail: "Generating report…" });
    try {
      const { data, error } = await supabase.functions.invoke("strategy-evidence-render", {
        body: { action: "generate_report" },
      });
      if (error) throw error;

      const gaps = data?.gaps ?? [];
      const gapDetails = gaps.map((g: any) => {
        const rootCause = g.latest_error || g.failure_reason || "no evidence";
        return `${g.surface}: ${rootCause}`;
      }).join("; ");

      update("evidence-report", {
        status: data?.pass ? "pass" : "fail",
        detail: data?.pass
          ? `✅ All ${data?.enforced_total} surfaces covered`
          : `${data?.enforced_covered}/${data?.enforced_total} surfaces. Gaps: ${gapDetails}`,
      });
    } catch (e: any) {
      update("evidence-report", { status: "error", detail: e.message });
    }
  }

  // ── Run all ───────────────────────────────────────────────────
  async function runAll() {
    setRunning(true);
    setSurfaces(INITIAL_SURFACES);

    await Promise.allSettled([
      triggerTaskWithRetry("account_brief", "account_brief"),
      triggerTaskWithRetry("ninety_day_plan", "ninety_day_plan"),
      triggerTaskWithRetry("discovery_prep", "discovery_prep"),
      triggerChat("demo-strategy", "Help me build a demo strategy for this account. What should I demo and how should I structure it?", "demo-strategy"),
      triggerChat("discovery-questions", "What discovery questions should I ask in my next meeting with this stakeholder?", "discovery-questions"),
    ]);

    await triggerDocxRender();
    await triggerEvidenceReport();

    setRunning(false);
  }

  const statusColor = (s: SurfaceStatus) => {
    switch (s) {
      case "pass": return "default" as const;
      case "fail": return "destructive" as const;
      case "running": return "secondary" as const;
      case "retrying": return "secondary" as const;
      case "error": return "destructive" as const;
      default: return "outline" as const;
    }
  };

  return (
    <SafePage className="p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground mb-2">Phase Evidence Runner</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Triggers real Strategy executions across all enforced surfaces with adaptive retry.
        Max {MAX_RETRIES} retries per surface. Retry modes escalate: normal → chunked → low_token → rescue.
        Discovery prep polls up to 25 min. Uses real auth, real DB rows, real pipelines.
      </p>

      <Button onClick={runAll} disabled={running} className="mb-6 w-full">
        {running ? "Running Evidence Collection…" : "Run All Evidence Checks (with retry)"}
      </Button>

      <div className="space-y-3">
        {surfaces.map(s => (
          <Card key={s.id}>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">{s.label}</CardTitle>
                <div className="flex items-center gap-2">
                  {s.retryCount > 0 && (
                    <span className="text-xs text-muted-foreground">
                      attempt {s.retryCount + 1}
                    </span>
                  )}
                  {s.retryMode && s.retryMode !== "normal" && (
                    <Badge variant="outline" className="text-[10px]">
                      {s.retryMode}
                    </Badge>
                  )}
                  <Badge variant={statusColor(s.status)}>{s.status.toUpperCase()}</Badge>
                </div>
              </div>
            </CardHeader>
            {(s.detail || s.pipelineState || s.diagnosticsHistory.length > 0) && (
              <CardContent className="py-2 px-4 space-y-1">
                {s.detail && (
                  <p className="text-xs text-muted-foreground font-mono break-all">{s.detail}</p>
                )}
                {s.pipelineState && (
                  <div className="text-xs text-muted-foreground font-mono bg-muted/50 rounded p-2 space-y-0.5">
                    <div>⏱ {s.pipelineState.elapsed_s}s elapsed</div>
                    <div>📍 {s.pipelineState.progress_step}</div>
                    {s.pipelineState.batch_info && <div>📦 {s.pipelineState.batch_info}</div>}
                    {s.pipelineState.remediation_mode && <div>🔄 {s.pipelineState.remediation_mode}</div>}
                  </div>
                )}
                {s.diagnosticsHistory.length > 0 && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Diagnostics history ({s.diagnosticsHistory.length})</summary>
                    <ul className="mt-1 space-y-0.5 font-mono">
                      {s.diagnosticsHistory.map((d, i) => (
                        <li key={i} className="break-all">{d}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </SafePage>
  );
}
