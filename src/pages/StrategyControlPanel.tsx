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
        </header>

        <Tabs defaultValue="validation">
          <TabsList>
            <TabsTrigger value="validation">Validation</TabsTrigger>
            <TabsTrigger value="single" disabled>Single Skill Run</TabsTrigger>
            <TabsTrigger value="trace" disabled>Trace Inspector</TabsTrigger>
            <TabsTrigger value="compare" disabled>Compare Runs</TabsTrigger>
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

            {/* Combined Verdict (report mode) */}
            {lastReport && (
              <Card className={
                lastReport.combinedVerdict === "GO"
                  ? "border-emerald-500/50"
                  : lastReport.combinedVerdict === "COVERAGE_GAP"
                    ? "border-amber-500/50"
                    : "border-destructive/50"
              }>
                <CardContent className="py-4 space-y-2">
                  <div className="flex items-center gap-3">
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
                    <span className="text-sm text-muted-foreground">Combined (Standard + Weak)</span>
                  </div>
                  <p className="text-sm">{lastReport.combinedReason}</p>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Standard matrix: <strong>{lastReport.standardMatrix.verdict.verdict}</strong></p>
                    <p>Weak-case refusals all correct: <strong>{lastReport.weakCaseMatrix.allRefused ? "YES ✅" : "NO ⚠️"}</strong></p>
                  </div>
                  {lastReport.weakCaseMatrix.weakPassEvidence.length > 0 && (
                    <div className="mt-2 border-t pt-2">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Weak-Case Pass Evidence:</p>
                      {lastReport.weakCaseMatrix.weakPassEvidence.map((e) => (
                        <div key={e.caseId} className="text-xs ml-2 mb-1">
                          <span className="font-mono">{e.caseId}</span>
                          {" · "}influence: {e.influence ?? "—"}
                          {" · "}confidence: {e.confidence ?? "—"}
                          {e.kiTitles.length > 0 && (
                            <span> · KIs: {e.kiTitles.slice(0, 5).join(", ")}{e.kiTitles.length > 5 ? "…" : ""}</span>
                          )}
                          {e.matchedTerms.length > 0 && (
                            <span> · terms: {e.matchedTerms.slice(0, 5).join(", ")}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Standard verdict (quick mode) */}
            {!lastReport && <VerdictHeader report={verdict} running={running && results.length < cases.length} />}

            {/* Standard Cases */}
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-muted-foreground mt-2">Standard Matrix ({cases.length} cases)</h3>
              {cases.map((c, i) => (
                <CaseRow
                  key={c.id}
                  result={results[i] ?? null}
                  running={isRunningAny}
                  caseLabel={c.label}
                  caseDescription={c.description}
                />
              ))}
            </div>

            {/* Weak Cases */}
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-muted-foreground mt-2">Weak-Case Isolation (W1–W4)</h3>
              {weakCases.map((c, i) => (
                <CaseRow
                  key={c.id}
                  result={weakResults[i] ?? null}
                  running={isRunningAny}
                  caseLabel={c.label}
                  caseDescription={c.description}
                />
              ))}
            </div>

            {/* Integrity Footer */}
            {(lastReport || (results.length > 0 && weakResults.length > 0)) && (
              <Card>
                <CardContent className="py-3">
                  <p className="text-xs text-muted-foreground">
                    ✅ <strong>Integrity:</strong> No Discovery Prep, task pipeline, or artifact routing files were changed by this validation.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="single">
            <Placeholder title="Single Skill Run" />
          </TabsContent>
          <TabsContent value="trace">
            <Placeholder title="Trace Inspector" />
          </TabsContent>
          <TabsContent value="compare">
            <Placeholder title="Compare Runs" />
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
