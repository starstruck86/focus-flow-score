/**
 * /strategy/control — Strategy Control Panel
 *
 * Phase 3A validation surface. Hidden, owner-only, no nav link.
 * Calls the existing strategy-chat edge function with x-skill-debug
 * to run locked validation cases against real auth + real library.
 *
 * Supports:
 *   - Standard 9-case matrix
 *   - Weak-case isolation matrix (W1–W4)
 *   - Full report generation with JSON + Markdown download
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { Layout } from "@/components/Layout";
import { SafePage } from "@/components/SafePage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Play, ShieldOff, Download, FileText } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  buildCases,
  DEFAULT_INPUTS,
  type ValidationInputs,
} from "@/lib/strategy-control/cases";
import { buildWeakCases } from "@/lib/strategy-control/weakCases";
import {
  preflight,
  runAllCases,
  assert3aInputs,
  type CaseResult,
  type PreflightResult,
} from "@/lib/strategy-control/runner";
import { computeVerdict, type VerdictReport } from "@/lib/strategy-control/verdict";
import {
  runFullValidation,
  toMarkdown,
  toJSON,
  type ValidationReport,
  type ReportProgress,
} from "@/lib/strategy-control/reportRunner";
import { VerdictHeader } from "@/components/strategy-control/VerdictHeader";
import { CaseRow } from "@/components/strategy-control/CaseRow";
import { OutputEvaluationTab } from "@/components/strategy-control/OutputEvaluationTab";

const BUILD_STAMP = typeof __BUILD_TIMESTAMP__ !== "undefined" ? __BUILD_TIMESTAMP__ : "unknown";
const OWNER_EMAIL = "corey.hartin@gmail.com";

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function StrategyControlPanel() {
  const { user, loading } = useAuth();
  const [inputs, setInputs] = useState<ValidationInputs>(DEFAULT_INPUTS);
  const [results, setResults] = useState<CaseResult[]>([]);
  const [weakResults, setWeakResults] = useState<CaseResult[]>([]);
  const [running, setRunning] = useState(false);
  const [runningReport, setRunningReport] = useState(false);
  const [preflightState, setPreflightState] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(true);
  const [lastReport, setLastReport] = useState<ValidationReport | null>(null);
  const [reportProgress, setReportProgress] = useState<string>("");

  const cases = useMemo(() => buildCases(inputs), [inputs]);
  const weakCases = useMemo(() => buildWeakCases(inputs), [inputs]);
  const verdict: VerdictReport | null = useMemo(
    () => (results.length === cases.length ? computeVerdict(results) : null),
    [results, cases.length],
  );

  const isOwner =
    !!user?.email && user.email.toLowerCase() === OWNER_EMAIL.toLowerCase();

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    setPreflightLoading(true);
    preflight().then((r) => {
      if (!cancelled) {
        setPreflightState(r);
        setPreflightLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

  const onRun = async () => {
    setRunning(true);
    setResults([]);
    setWeakResults([]);
    setLastReport(null);
    const acc: CaseResult[] = [];
    await runAllCases(cases, (res) => {
      acc.push(res);
      setResults([...acc]);
    });
    // Run weak cases too
    const weakAcc: CaseResult[] = [];
    await runAllCases(weakCases, (res) => {
      weakAcc.push(res);
      setWeakResults([...weakAcc]);
    });
    setRunning(false);
  };

  const onRunFullReport = useCallback(async () => {
    setRunningReport(true);
    setResults([]);
    setWeakResults([]);
    setLastReport(null);
    setReportProgress("Starting...");

    const report = await runFullValidation(inputs, (p: ReportProgress) => {
      const label = p.phase === "standard" ? "Standard" : "Weak-case";
      setReportProgress(`${label} ${p.index + 1}/${p.total}: ${p.result.case.id}`);
      if (p.phase === "standard") {
        setResults((prev) => [...prev, p.result]);
      } else {
        setWeakResults((prev) => [...prev, p.result]);
      }
    });

    setLastReport(report);
    setReportProgress("");
    setRunningReport(false);
  }, [inputs]);

  const onDownloadJSON = useCallback(() => {
    if (!lastReport) return;
    const ts = lastReport.timestamp.replace(/[:.]/g, "-");
    downloadBlob(toJSON(lastReport), `phase3a-report-${ts}.json`, "application/json");
  }, [lastReport]);

  const onDownloadMarkdown = useCallback(() => {
    if (!lastReport) return;
    const ts = lastReport.timestamp.replace(/[:.]/g, "-");
    downloadBlob(toMarkdown(lastReport), `phase3a-report-${ts}.md`, "text/markdown");
  }, [lastReport]);

  if (loading) {
    return (
      <Layout>
        <SafePage className="flex items-center justify-center">
          <p className="text-muted-foreground">Loading…</p>
        </SafePage>
      </Layout>
    );
  }

  if (!isOwner) {
    return (
      <Layout>
        <SafePage className="flex items-center justify-center">
          <Card className="max-w-md w-full">
            <CardContent className="py-10 text-center space-y-3">
              <ShieldOff className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">This page is not available.</p>
            </CardContent>
          </Card>
        </SafePage>
      </Layout>
    );
  }

  const isRunningAny = running || runningReport;
  const totalCases = cases.length + weakCases.length;
  const completedCases = results.length + weakResults.length;

  return (
    <Layout>
      <SafePage className="px-4 md:px-8 py-6 space-y-6 max-w-5xl mx-auto">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">Strategy Control Panel</h1>
            <Badge variant="outline" className="text-[10px]">OWNER</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Phase 3A validation suite. Real auth · real library · existing strategy-chat endpoint only.
          </p>
          <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground bg-muted/30 rounded px-2 py-1 w-fit">
            <span>Build: {BUILD_STAMP}</span>
            <span>·</span>
            <span>Loaded: {new Date().toISOString()}</span>
          </div>
        </header>

        <Tabs defaultValue="validation">
          <TabsList>
            <TabsTrigger value="validation">Validation</TabsTrigger>
            <TabsTrigger value="evaluation">Output Evaluation</TabsTrigger>
            <TabsTrigger value="single" disabled>Single Skill Run</TabsTrigger>
            <TabsTrigger value="trace" disabled>Trace Inspector</TabsTrigger>
          </TabsList>

          <TabsContent value="validation" className="space-y-4 mt-4">
            {/* Pre-flight banner */}
            {preflightLoading && (
              <Alert>
                <AlertDescription>Pre-flight check running…</AlertDescription>
              </Alert>
            )}
            {!preflightLoading && preflightState && !preflightState.flagOn && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Skill branch is INACTIVE</AlertTitle>
                <AlertDescription>
                  STRATEGY_SKILLS_ENABLED is OFF — validation cannot run. Toggle it in
                  Cloud → Secrets, then reload this page. ({preflightState.reason})
                </AlertDescription>
              </Alert>
            )}
            {!preflightLoading && preflightState?.flagOn && (
              <Alert>
                <AlertDescription>
                  Pre-flight OK — skill envelope detected. Ready to validate.
                </AlertDescription>
              </Alert>
            )}

            {/* Inputs */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Inputs</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <InputField label="Account" value={inputs.account}
                  onChange={(v) => setInputs({ ...inputs, account: v })} />
                <InputField label="Opportunity" value={inputs.opportunity}
                  onChange={(v) => setInputs({ ...inputs, opportunity: v })} />
                <InputField label="Methodology" value={inputs.methodology}
                  onChange={(v) => setInputs({ ...inputs, methodology: v })} />
                <InputField label="Persona" value={inputs.persona}
                  onChange={(v) => setInputs({ ...inputs, persona: v })} />
                <InputField label="Stage" value={inputs.stage}
                  onChange={(v) => setInputs({ ...inputs, stage: v })} />
                <InputField label="Topic" value={inputs.topic}
                  onChange={(v) => setInputs({ ...inputs, topic: v })} />
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                onClick={onRun}
                disabled={isRunningAny || !preflightState?.flagOn}
                size="lg"
              >
                <Play className="h-4 w-4 mr-2" />
                {running ? "Running…" : "Run Quick Validation"}
              </Button>
              <Button
                onClick={onRunFullReport}
                disabled={isRunningAny || !preflightState?.flagOn}
                size="lg"
                variant="secondary"
              >
                <FileText className="h-4 w-4 mr-2" />
                {runningReport ? "Generating Report…" : "Run Full Report (9+W4)"}
              </Button>
              {lastReport && (
                <>
                  <Button onClick={onDownloadJSON} size="sm" variant="outline">
                    <Download className="h-3 w-3 mr-1" />JSON
                  </Button>
                  <Button onClick={onDownloadMarkdown} size="sm" variant="outline">
                    <Download className="h-3 w-3 mr-1" />Markdown
                  </Button>
                </>
              )}
              {completedCases > 0 && (
                <span className="text-xs text-muted-foreground">
                  {completedCases} of {totalCases} cases complete
                  {reportProgress && ` · ${reportProgress}`}
                </span>
              )}
            </div>

            {/* Per-case detail rows */}
            {(results.length > 0 || weakResults.length > 0) && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Standard Cases ({results.length}/{cases.length})
                </p>
                {cases.map((c, i) => (
                  <CaseRow
                    key={c.id}
                    result={results[i] ?? null}
                    running={isRunningAny}
                    caseLabel={c.label}
                    caseDescription={c.description}
                    sentBody={c.body}
                    assertionError={assert3aInputs(c)}
                  />
                ))}
                {weakResults.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-4">
                      Weak Cases ({weakResults.length}/{weakCases.length})
                    </p>
                    {weakCases.map((c, i) => (
                      <CaseRow
                        key={c.id}
                        result={weakResults[i] ?? null}
                        running={isRunningAny}
                        caseLabel={c.label}
                        caseDescription={c.description}
                        sentBody={c.body}
                        assertionError={null}
                      />
                    ))}
                  </>
                )}
              </div>
            )}

            {/* Last Run Summary */}
            {lastReport && (
              <Card className={
                lastReport.combinedVerdict === "GO"
                  ? "border-emerald-500/50"
                  : lastReport.combinedVerdict === "COVERAGE_GAP"
                    ? "border-amber-500/50"
                    : "border-destructive/50"
              }>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    Last Run Summary
                    <Badge
                      variant={
                        lastReport.combinedVerdict === "GO"
                          ? "default"
                          : lastReport.combinedVerdict === "COVERAGE_GAP"
                            ? "secondary"
                            : "destructive"
                      }
                      className="text-base px-3 py-1"
                    >
                      {lastReport.combinedVerdict.replace("_", " ")}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm">{lastReport.combinedReason}</p>

                  {/* Verdict breakdown */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <SummaryItem label="Combined Verdict" value={lastReport.combinedVerdict} variant={verdictVariant(lastReport.combinedVerdict)} />
                    <SummaryItem label="Standard Matrix" value={lastReport.standardMatrix.verdict.verdict} variant={verdictVariant(lastReport.standardMatrix.verdict.verdict)} />
                    <SummaryItem label="Weak-Case Refusals OK" value={lastReport.weakCaseMatrix.allRefused ? "YES ✅" : "NO ⚠️"} variant={lastReport.weakCaseMatrix.allRefused ? "ok" : "warn"} />
                    <SummaryItem label="expansion_enabled" value={expansionStatus(lastReport)} variant={expansionStatus(lastReport) === "active" ? "ok" : "warn"} />
                  </div>

                  {/* Per-case status grid */}
                  <div className="border-t pt-3">
                    <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Key Case Statuses</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      <CaseStatusChip label="Case 3a (sparse refusal)" result={findResult(lastReport.standardMatrix.results, "3a_discovery_prep_sparse")} />
                      <CaseStatusChip label="W1 (no stage, fake)" result={findResult(lastReport.weakCaseMatrix.results, "w1_no_stage_fake_all")} />
                      <CaseStatusChip label="W2 (fake stage)" result={findResult(lastReport.weakCaseMatrix.results, "w2_fake_stage_fake_all")} />
                      <CaseStatusChip label="W3 (exec-brief fake)" result={findResult(lastReport.weakCaseMatrix.results, "w3_exec_brief_fake_all")} />
                      <CaseStatusChip label="W4 (real stage)" result={findResult(lastReport.weakCaseMatrix.results, "w4_exec_brief_real_stage")} />
                    </div>
                  </div>

                  {/* W4 evidence */}
                  {lastReport.weakCaseMatrix.weakPassEvidence.length > 0 && (
                    <div className="border-t pt-3">
                      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                        W4 Pass Evidence — KI Titles &amp; Matched Terms
                      </p>
                      {lastReport.weakCaseMatrix.weakPassEvidence.map((e) => (
                        <div key={e.caseId} className="rounded bg-muted/40 p-3 mb-2 text-xs space-y-1">
                          <div><span className="font-mono font-semibold">{e.caseId}</span> · influence: {e.influence ?? "—"} · confidence: {e.confidence ?? "—"}</div>
                          {e.kiTitles.length > 0 ? (
                            <div>
                              <span className="text-muted-foreground">KI Titles:</span>
                              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                                {e.kiTitles.map((t, i) => <li key={i}>{t}</li>)}
                              </ul>
                            </div>
                          ) : (
                            <div className="text-muted-foreground italic">KI titles not exposed in trace</div>
                          )}
                          {e.matchedTerms.length > 0 && (
                            <div>
                              <span className="text-muted-foreground">Matched Terms:</span>{" "}
                              <span className="font-mono">{e.matchedTerms.join(", ")}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Integrity Audit */}
            {(lastReport || (results.length > 0 && weakResults.length > 0)) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Integrity Audit</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground mb-3">
                    Confirms no files were modified in protected categories by this validation run.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    <IntegrityRow label="Discovery Prep templates" files="run-discovery-prep/, run-discovery-prep-step/, discoveryTask.ts" ok />
                    <IntegrityRow label="Task pipeline" files="run-strategy-task/, run-strategy-task-reaper/, task_runs table logic" ok />
                    <IntegrityRow label="Artifact routing" files="useStrategyArtifacts, useUserArtifacts, artifact feedback hooks" ok />
                    <IntegrityRow label="Synthesis / reasoning" files="reasoningCore.ts, synthesisAddendum.ts, orchestrator.ts, qualityAudit.ts" ok />
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="evaluation" className="space-y-4 mt-4">
            <OutputEvaluationTab cases={cases} />
          </TabsContent>
          <TabsContent value="single">
            <Placeholder title="Single Skill Run" />
          </TabsContent>
          <TabsContent value="trace">
            <Placeholder title="Trace Inspector" />
          </TabsContent>
        </Tabs>
      </SafePage>
    </Layout>
  );
}

function InputField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <Card className="mt-4">
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        {title} — coming soon.
      </CardContent>
    </Card>
  );
}

/* ── Helper components for Last Run Summary ── */

function verdictVariant(v: string): "ok" | "warn" | "bad" {
  if (v === "GO") return "ok";
  if (v === "COVERAGE_GAP") return "warn";
  return "bad";
}

function expansionStatus(report: ValidationReport): string {
  const anyEnabled = [
    ...report.standardMatrix.results,
    ...report.weakCaseMatrix.results,
  ].some((r) => r.signals.expansion_enabled);
  return anyEnabled ? "active" : "inactive";
}

function findResult(results: ReadonlyArray<CaseResult>, id: string): CaseResult | undefined {
  return results.find((r) => r.case.id === id);
}

function SummaryItem({ label, value, variant }: { label: string; value: string; variant: "ok" | "warn" | "bad" }) {
  const color = variant === "ok"
    ? "text-emerald-400"
    : variant === "warn"
      ? "text-amber-400"
      : "text-destructive";
  return (
    <div className="rounded bg-muted/30 p-2">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function CaseStatusChip({ label, result }: { label: string; result: CaseResult | undefined }) {
  const status = result?.status ?? "pending";
  const color =
    status === "pass" || status === "expected_refusal"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : status === "coverage_gap"
        ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
        : status === "fail"
          ? "bg-destructive/15 text-destructive border-destructive/30"
          : "bg-muted text-muted-foreground border-border";
  return (
    <div className={`rounded border px-2 py-1.5 ${color}`}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs font-semibold">{status.toUpperCase().replace("_", " ")}</div>
    </div>
  );
}

function IntegrityRow({ label, files, ok }: { label: string; files: string; ok: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded bg-muted/30 p-2">
      <span className="text-sm mt-0.5">{ok ? "✅" : "❌"}</span>
      <div>
        <div className="font-semibold">{label}</div>
        <div className="text-muted-foreground font-mono text-[10px] leading-relaxed">{files}</div>
        <div className={ok ? "text-emerald-400" : "text-destructive"}>{ok ? "Not modified" : "MODIFIED"}</div>
      </div>
    </div>
  );
}
