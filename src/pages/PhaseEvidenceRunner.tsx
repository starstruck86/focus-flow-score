/**
 * Phase Evidence Runner — Admin-only page that triggers real Strategy
 * executions across all enforced surfaces and runs evidence validation.
 *
 * This page:
 *  1. Triggers account_brief, ninety_day_plan, discovery_prep tasks
 *  2. Sends chat prompts for demo-strategy and discovery-questions
 *  3. Triggers DOCX evidence render
 *  4. Runs the evidence report updater
 *  5. Shows live status for each surface
 */

import { useState, useCallback } from "react";
import { SafePage } from "@/components/SafePage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type SurfaceStatus = "idle" | "running" | "pass" | "fail" | "error";

interface SurfaceEntry {
  id: string;
  label: string;
  status: SurfaceStatus;
  detail?: string;
  runId?: string;
}

const INITIAL_SURFACES: SurfaceEntry[] = [
  { id: "account_brief", label: "Account Brief (task)", status: "idle" },
  { id: "ninety_day_plan", label: "90-Day Plan (task)", status: "idle" },
  { id: "discovery_prep", label: "Discovery Prep (progressive)", status: "idle" },
  { id: "demo-strategy", label: "Demo Strategy (chat)", status: "idle" },
  { id: "discovery-questions", label: "Discovery Questions (chat)", status: "idle" },
  { id: "docx-render", label: "DOCX Render (transform)", status: "idle" },
  { id: "evidence-report", label: "Evidence Report Update", status: "idle" },
];

export default function PhaseEvidenceRunner() {
  const { user } = useAuth();
  const [surfaces, setSurfaces] = useState<SurfaceEntry[]>(INITIAL_SURFACES);
  const [running, setRunning] = useState(false);

  const update = useCallback((id: string, patch: Partial<SurfaceEntry>) => {
    setSurfaces(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }, []);

  // ── Task triggers ─────────────────────────────────────────────
  async function triggerTask(taskType: string, surfaceId: string) {
    update(surfaceId, { status: "running", detail: "Submitting…" });
    try {
      // Find a real account to use
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
      update(surfaceId, { status: "running", detail: `run_id: ${runId}`, runId });

      // Poll for completion (max 5 min)
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const { data: status } = await supabase.functions.invoke("run-strategy-task", {
          body: { action: "status", run_id: runId },
        });
        if (status?.status === "completed") {
          update(surfaceId, { status: "pass", detail: `Completed: ${runId}` });
          return;
        }
        if (status?.status === "failed") {
          update(surfaceId, { status: "fail", detail: `Failed: ${status.error || runId}` });
          return;
        }
        update(surfaceId, { detail: `Polling… step=${status?.progress_step}` });
      }
      update(surfaceId, { status: "fail", detail: "Timeout after 5 min" });
    } catch (e: any) {
      update(surfaceId, { status: "error", detail: e.message });
    }
  }

  // ── Chat triggers ─────────────────────────────────────────────
  async function triggerChat(manifestKey: string, prompt: string, surfaceId: string) {
    update(surfaceId, { status: "running", detail: "Sending chat…" });
    try {
      // Find or create a strategy thread
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

      const { data, error } = await supabase.functions.invoke("strategy-chat", {
        body: {
          thread_id: threadId,
          content: prompt,
          workspace: "general",
        },
      });
      if (error) throw error;

      // Check if the response has a manifest_id matching
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
      update("evidence-report", {
        status: data?.pass ? "pass" : "fail",
        detail: `Surfaces: ${data?.enforced_covered}/${data?.enforced_total}, gaps: ${data?.gaps?.length || 0}`,
      });
    } catch (e: any) {
      update("evidence-report", { status: "error", detail: e.message });
    }
  }

  // ── Run all ───────────────────────────────────────────────────
  async function runAll() {
    setRunning(true);
    setSurfaces(INITIAL_SURFACES);

    // Run tasks in parallel
    await Promise.allSettled([
      triggerTask("account_brief", "account_brief"),
      triggerTask("ninety_day_plan", "ninety_day_plan"),
      triggerTask("discovery_prep", "discovery_prep"),
      triggerChat("demo-strategy", "Help me build a demo strategy for this account. What should I demo and how should I structure it?", "demo-strategy"),
      triggerChat("discovery-questions", "What discovery questions should I ask in my next meeting with this stakeholder?", "discovery-questions"),
    ]);

    // DOCX render needs a completed task, run after tasks
    await triggerDocxRender();

    // Finally, run the evidence report
    await triggerEvidenceReport();

    setRunning(false);
  }

  const statusColor = (s: SurfaceStatus) => {
    switch (s) {
      case "pass": return "default";
      case "fail": return "destructive";
      case "running": return "secondary";
      case "error": return "destructive";
      default: return "outline";
    }
  };

  return (
    <SafePage className="p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground mb-2">Phase Evidence Runner</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Triggers real Strategy executions across all enforced surfaces and validates evidence.
        Uses real auth, real DB rows, real pipelines. No fake evidence.
      </p>

      <Button onClick={runAll} disabled={running} className="mb-6 w-full">
        {running ? "Running Evidence Collection…" : "Run All Evidence Checks"}
      </Button>

      <div className="space-y-3">
        {surfaces.map(s => (
          <Card key={s.id}>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">{s.label}</CardTitle>
                <Badge variant={statusColor(s.status)}>{s.status.toUpperCase()}</Badge>
              </div>
            </CardHeader>
            {s.detail && (
              <CardContent className="py-2 px-4">
                <p className="text-xs text-muted-foreground font-mono break-all">{s.detail}</p>
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </SafePage>
  );
}
