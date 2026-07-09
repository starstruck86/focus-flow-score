/**
 * Phase 3.5B — Output Evaluation Tab.
 *
 * Runs Strategy (real LLM synthesis) vs Baseline comparison,
 * showing side-by-side outputs and 6-dimension scorecards.
 */
import { useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Play, Trophy, Minus, Eye, Download } from "lucide-react";
import type { ValidationCase } from "@/lib/strategy-control/cases";
import { buildDefaultEvalCases, runEvaluation, type EvaluationResult } from "@/lib/strategy-control/evaluationRunner";
import type { OutputScore } from "@/lib/strategy-control/outputScorer";
import { BASELINE_PROMPT_VERSION } from "@/lib/strategy-control/baselineGenerator";

interface Props {
  cases: ReadonlyArray<ValidationCase>;
}

const TIER_COLORS: Record<string, string> = {
  strong: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  partial: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  weak: "bg-red-500/15 text-red-400 border-red-500/30",
};

const DIMS = ["specificity", "actionability", "structure", "evidence", "relevance", "business_impact"] as const;

function ScoreBar({ label, value, max = 5 }: { label: string; value: number; max?: number }) {
  const pct = (value / max) * 100;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 text-muted-foreground">{label}</span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-6 text-right font-mono">{value}</span>
    </div>
  );
}

function ScoreCard({ label, score, variant }: { label: string; score: OutputScore; variant: "strategy" | "baseline" }) {
  const color = variant === "strategy" ? "text-emerald-400" : "text-sky-400";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={`text-sm font-semibold ${color}`}>{label}</span>
        <span className="text-lg font-mono font-bold">{score.total}/30</span>
      </div>
      {DIMS.map(d => (
        <ScoreBar key={d} label={d.replace("_", " ")} value={score[d]} />
      ))}
    </div>
  );
}

function WinnerBadge({ winner }: { winner: "strategy" | "baseline" | "tie" }) {
  if (winner === "strategy") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-sm px-3 py-1">
        <Trophy className="h-3.5 w-3.5 mr-1" /> Strategy Wins
      </Badge>
    );
  }
  if (winner === "baseline") {
    return (
      <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-sm px-3 py-1">
        <Trophy className="h-3.5 w-3.5 mr-1" /> Baseline Wins
      </Badge>
    );
  }
  return (
    <Badge className="bg-muted text-muted-foreground text-sm px-3 py-1">
      <Minus className="h-3.5 w-3.5 mr-1" /> Tie
    </Badge>
  );
}

import {
  isBaselineContaminated,
  buildExportCase,
  computeAggregates,
} from "./outputEvaluationLogic";

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJSON(results: EvaluationResult[]) {
  const payload = {
    export_timestamp: new Date().toISOString(),
    prompt_version: BASELINE_PROMPT_VERSION,
    aggregate: computeAggregates(results),
    cases: results.map(buildExportCase),
  };
  downloadFile(JSON.stringify(payload, null, 2), `eval-${Date.now()}.json`, "application/json");
}

function exportMarkdown(results: EvaluationResult[]) {
  const clean = results.filter(r => !isBaselineContaminated(r));
  const sWins = clean.filter(r => r.comparison.winner === "strategy").length;
  const bWins = clean.filter(r => r.comparison.winner === "baseline").length;
  const ties = clean.filter(r => r.comparison.winner === "tie").length;
  const lines: string[] = [
    "# Output Evaluation Report",
    "",
    `**Exported:** ${new Date().toISOString()}`,
    `**Prompt Version:** ${BASELINE_PROMPT_VERSION}`,
    `**Total Cases:** ${results.length} (${clean.length} valid, ${results.length - clean.length} contaminated)`,
    `**Aggregate:** Strategy ${sWins} · Baseline ${bWins} · Tie ${ties}`,
    "",
  ];

  for (const r of results) {
    const contaminated = isBaselineContaminated(r);
    lines.push(`## ${r.evalCase.tier.toUpperCase()} — ${r.evalCase.case.label}`);
    lines.push(`- **Status:** ${contaminated ? "EVALUATION_INVALID" : r.strategy.trace.output_valid ? "VALID" : "STRATEGY_OUTPUT_INVALID"}`);
    lines.push(`- **Case ID:** ${r.evalCase.case.id}`);
    lines.push(`- **Strategy Source:** ${r.strategy.trace.source}`);
    lines.push(`- **Strategy Prompt Version:** ${r.strategy.trace.prompt_version}`);
    lines.push(`- **Strategy Model:** ${r.strategy.trace.model}`);
    lines.push(`- **Baseline Prompt Version:** ${BASELINE_PROMPT_VERSION}`);
    lines.push("");
    lines.push("### Strategy Trace");
    lines.push(`- Library hits: ${r.strategy.trace.library_hits.length}`);
    lines.push(`- Gate: ${r.strategy.trace.gate_decision}`);
    lines.push(`- Output valid: ${r.strategy.trace.output_valid}`);
    if (r.strategy.trace.library_hits.length > 0) {
      lines.push(`- Hits: ${r.strategy.trace.library_hits.map(h => h.title).join(", ")}`);
    }
    lines.push("");
    lines.push("### Baseline Integrity");
    lines.push(`- Mode: ${r.baseline.trace.baseline_mode}`);
    lines.push(`- Model: ${r.baseline.trace.model}`);
    lines.push(`- Context used: ${r.baseline.trace.baseline_context_used}`);
    lines.push(`- Library used: ${r.baseline.trace.baseline_library_used}`);
    lines.push(`- Memory used: ${r.baseline.trace.baseline_memory_used}`);
    lines.push("");
    lines.push("### Baseline Prompts");
    lines.push("**System Prompt:**");
    lines.push("```");
    lines.push(r.baseline.result.systemPrompt ?? "(unavailable)");
    lines.push("```");
    lines.push("**User Prompt:**");
    lines.push("```");
    lines.push(r.baseline.result.userPrompt ?? "(unavailable)");
    lines.push("```");
    lines.push("");

    if (!contaminated && r.strategy.trace.output_valid) {
      lines.push("### Scores");
      lines.push(`- Strategy: ${r.strategy.score.total}/30`);
      lines.push(`- Baseline: ${r.baseline.score.total}/30`);
      lines.push(`- Winner: ${r.comparison.winner}`);
      lines.push(`- Reasoning: ${r.comparison.reasoning}`);
      lines.push("");
    } else if (contaminated) {
      lines.push("*Scores suppressed — baseline contaminated.*");
      lines.push("");
    } else {
      lines.push("*Scores suppressed — Strategy output invalid (raw JSON/envelope).*");
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  downloadFile(lines.join("\n"), `eval-${Date.now()}.md`, "text/markdown");
}

function EvalResultCard({ result, showWhy }: { result: EvaluationResult; showWhy: boolean }) {
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [baselineOpen, setBaselineOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [strategyInspectorOpen, setStrategyInspectorOpen] = useState(false);
  const { comparison } = result;
  const contaminated = isBaselineContaminated(result);
  const strategyInvalid = !result.strategy.trace.output_valid;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Badge className={TIER_COLORS[result.evalCase.tier] ?? ""}>
              {result.evalCase.tier.toUpperCase()}
            </Badge>
            <CardTitle className="text-sm">{result.evalCase.case.label}</CardTitle>
          </div>
          {contaminated ? (
            <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-sm px-3 py-1">
              ⛔ CONTAMINATED
            </Badge>
          ) : strategyInvalid ? (
            <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-sm px-3 py-1">
              ⚠ STRATEGY OUTPUT INVALID
            </Badge>
          ) : (
            <WinnerBadge winner={comparison.winner} />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Strategy source + trace summary */}
        <div className="text-xs font-mono bg-muted/30 rounded p-2 space-y-0.5">
          <div><span className="text-muted-foreground">Strategy source:</span> {result.strategy.trace.source}</div>
          <div><span className="text-muted-foreground">Model:</span> {result.strategy.trace.model}</div>
          <div><span className="text-muted-foreground">Prompt version:</span> {result.strategy.trace.prompt_version}</div>
          <div><span className="text-muted-foreground">Gate:</span> {result.strategy.trace.gate_decision}</div>
          <div><span className="text-muted-foreground">Library hits:</span> {result.strategy.trace.library_hits.length}</div>
          {result.inputTerms.length > 0 && (
            <div><span className="text-muted-foreground">Input terms:</span> {result.inputTerms.join(", ")}</div>
          )}
        </div>

        {/* Strategy output invalid hard-fail */}
        {strategyInvalid && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded p-3 text-sm text-amber-400 font-semibold">
            Strategy output invalid — text is missing or raw JSON/envelope. Cannot score.
          </div>
        )}

        {/* Baseline contamination check */}
        {result.baseline.trace && (
          <div className={`text-xs rounded p-2 border ${
            contaminated
              ? "bg-red-500/10 border-red-500/30"
              : "bg-emerald-500/10 border-emerald-500/30"
          }`}>
            <div className="font-semibold mb-1">
              {contaminated ? "⛔" : "✅"} Baseline Integrity
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono">
              <div>mode: {result.baseline.trace.baseline_mode}</div>
              <div>model: {result.baseline.trace.model}</div>
              <div>context: {String(result.baseline.trace.baseline_context_used)}</div>
              <div>library: {String(result.baseline.trace.baseline_library_used)}</div>
              <div>memory: {String(result.baseline.trace.baseline_memory_used)}</div>
            </div>
          </div>
        )}

        {contaminated && (
          <div className="bg-red-500/10 border border-red-500/40 rounded p-3 text-sm text-red-400 font-semibold">
            Baseline contaminated — evaluation invalid. Scores are suppressed.
          </div>
        )}

        {/* Strategy Request Inspector */}
        <Collapsible open={strategyInspectorOpen} onOpenChange={setStrategyInspectorOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]">
              <ChevronDown className={`h-3 w-3 mr-1 transition-transform ${strategyInspectorOpen ? "rotate-180" : ""}`} />
              Strategy Request Inspector
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-2 text-[11px] font-mono bg-muted/20 p-3 rounded">
              <div>
                <span className="text-muted-foreground font-semibold">System Prompt:</span>
                <pre className="whitespace-pre-wrap mt-1 bg-muted/30 p-2 rounded max-h-64 overflow-auto">{result.strategy.systemPrompt || "(unavailable)"}</pre>
              </div>
              <div>
                <span className="text-muted-foreground font-semibold">User Prompt:</span>
                <pre className="whitespace-pre-wrap mt-1 bg-muted/30 p-2 rounded">{result.strategy.userPrompt || "(unavailable)"}</pre>
              </div>
              {result.strategy.trace.library_hits.length > 0 && (
                <div>
                  <span className="text-muted-foreground font-semibold">Library Hits:</span>
                  <ul className="mt-1 space-y-0.5">
                    {result.strategy.trace.library_hits.map((h, i) => (
                      <li key={i}>[{h.kind === "knowledge_item" ? "KI" : "PB"}:{h.id.slice(0, 8)}] {h.title}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Baseline Request Inspector */}
        <Collapsible open={inspectorOpen} onOpenChange={setInspectorOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]">
              <ChevronDown className={`h-3 w-3 mr-1 transition-transform ${inspectorOpen ? "rotate-180" : ""}`} />
              Baseline Request Inspector
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-2 text-[11px] font-mono bg-muted/20 p-3 rounded">
              <div>
                <span className="text-muted-foreground font-semibold">System Prompt:</span>
                <pre className="whitespace-pre-wrap mt-1 bg-muted/30 p-2 rounded">{result.baseline.result.systemPrompt ?? "(unavailable)"}</pre>
              </div>
              <div>
                <span className="text-muted-foreground font-semibold">User Prompt:</span>
                <pre className="whitespace-pre-wrap mt-1 bg-muted/30 p-2 rounded">{result.baseline.result.userPrompt ?? "(unavailable)"}</pre>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Scorecards — only if NOT contaminated AND Strategy output is valid */}
        {!contaminated && !strategyInvalid && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-emerald-500/20 rounded-lg p-3">
                <ScoreCard label="Strategy (synthesized)" score={result.strategy.score} variant="strategy" />
              </div>
              <div className="border border-sky-500/20 rounded-lg p-3">
                <ScoreCard label="Baseline (no library)" score={result.baseline.score} variant="baseline" />
              </div>
            </div>

            <div className="text-sm bg-muted/20 rounded p-3">
              <span className="text-muted-foreground">Verdict:</span> {comparison.reasoning}
            </div>

            <div className="grid grid-cols-6 gap-1 text-[10px] text-center">
              {DIMS.map(d => {
                const w = comparison.dimension_winners[d];
                const bg = w === "strategy" ? "bg-emerald-500/10" : w === "baseline" ? "bg-red-500/10" : "bg-muted/30";
                return (
                  <div key={d} className={`rounded p-1.5 ${bg}`}>
                    <div className="font-semibold capitalize">{d.replace("_", " ")}</div>
                    <div className="font-mono">{result.strategy.score[d]} vs {result.baseline.score[d]}</div>
                    <div className="text-muted-foreground">{w}</div>
                  </div>
                );
              })}
            </div>

            {showWhy && (
              <div className="border-t pt-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Why Strategy {comparison.winner === "strategy" ? "Won" : comparison.winner === "baseline" ? "Lost" : "Tied"}
                </p>
                <div className="text-xs">
                  <span className="text-muted-foreground">Library hits:</span>{" "}
                  <span className="font-mono">{result.strategy.trace.library_hits.length} ({result.strategy.trace.library_hits.map(h => h.title).slice(0, 3).join(", ")}{result.strategy.trace.library_hits.length > 3 ? "…" : ""})</span>
                </div>
                {result.strategy.trace.expansion_trace.length > 0 && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Expansion terms:</span>{" "}
                    <span className="font-mono">{result.strategy.trace.expansion_trace.map(e => e.term).join(", ")}</span>
                  </div>
                )}
                <div className="text-xs">
                  <span className="text-muted-foreground">Gate decision:</span>{" "}
                  <span className="font-mono">{result.strategy.trace.gate_decision}</span>
                </div>
                {comparison.winner === "baseline" && (
                  <div className="text-xs text-amber-400">
                    ⚠ Baseline outperformed Strategy. Check if library coverage is insufficient or synthesis prompt needs tuning.
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Collapsible raw outputs */}
        <div className="space-y-2 border-t pt-3">
          <Collapsible open={strategyOpen} onOpenChange={setStrategyOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]">
                <ChevronDown className={`h-3 w-3 mr-1 transition-transform ${strategyOpen ? "rotate-180" : ""}`} />
                Strategy output ({result.strategy.text.split(/\s+/).length} words, {result.strategy.trace.synthesis_latency_ms}ms)
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="text-[11px] bg-emerald-500/5 p-3 rounded overflow-auto max-h-64 font-mono whitespace-pre-wrap">
                {result.strategy.text || "(empty)"}
              </pre>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible open={baselineOpen} onOpenChange={setBaselineOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]">
                <ChevronDown className={`h-3 w-3 mr-1 transition-transform ${baselineOpen ? "rotate-180" : ""}`} />
                Baseline output ({result.baseline.text.split(/\s+/).length} words, {result.baseline.result.latencyMs}ms)
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="text-[11px] bg-sky-500/5 p-3 rounded overflow-auto max-h-64 font-mono whitespace-pre-wrap">
                {result.baseline.text || "(empty)"}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </CardContent>
    </Card>
  );
}

export function OutputEvaluationTab({ cases }: Props) {
  const [results, setResults] = useState<EvaluationResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [showWhy, setShowWhy] = useState(false);

  const evalCases = useMemo(() => buildDefaultEvalCases(cases), [cases]);

  const onRun = useCallback(async () => {
    setRunning(true);
    setResults([]);
    const acc: EvaluationResult[] = [];

    for (let i = 0; i < evalCases.length; i++) {
      const ec = evalCases[i];
      setProgress(`Running ${ec.tier} case (${i + 1}/${evalCases.length})…`);
      const result = await runEvaluation(ec, (phase) => {
        setProgress(`${ec.tier} · ${phase}…`);
      });
      acc.push(result);
      setResults([...acc]);
    }

    setProgress("");
    setRunning(false);
  }, [evalCases]);

  const clean = results.filter(r => !isBaselineContaminated(r) && r.strategy.trace.output_valid);
  const invalid = results.filter(r => isBaselineContaminated(r) || !r.strategy.trace.output_valid);
  const strategyWins = clean.filter(r => r.comparison.winner === "strategy").length;
  const baselineWins = clean.filter(r => r.comparison.winner === "baseline").length;
  const ties = clean.filter(r => r.comparison.winner === "tie").length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Output Superiority Evaluation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Runs the same inputs through Strategy (library-grounded synthesis) and Baseline (no library) paths,
            then scores both outputs deterministically on 6 dimensions.
          </p>
          <div className="text-xs text-muted-foreground">
            Cases: {evalCases.map(ec => `${ec.tier} (${ec.case.id})`).join(" · ")}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={onRun} disabled={running} size="lg">
              <Play className="h-4 w-4 mr-2" />
              {running ? "Running Evaluation…" : "Run Output Evaluation"}
            </Button>
            {results.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowWhy(!showWhy)}
              >
                <Eye className="h-3 w-3 mr-1" />
                {showWhy ? "Hide" : "Show"} Why Strategy Won
              </Button>
            )}
            {results.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => exportJSON(results)}>
                <Download className="h-3 w-3 mr-1" /> JSON
              </Button>
            )}
            {results.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => exportMarkdown(results)}>
                <Download className="h-3 w-3 mr-1" /> Markdown
              </Button>
            )}
            {progress && (
              <span className="text-xs text-muted-foreground animate-pulse">{progress}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card className={
          strategyWins > baselineWins
            ? "border-emerald-500/50"
            : baselineWins > strategyWins
              ? "border-red-500/50"
              : "border-amber-500/50"
        }>
          <CardContent className="py-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="text-sm font-semibold">
                Aggregate: Strategy {strategyWins} · Baseline {baselineWins} · Tie {ties}
                {invalid.length > 0 && (
                  <span className="text-red-400 ml-2">({invalid.length} invalid/contaminated, excluded)</span>
                )}
              </div>
              <Badge
                className={
                  strategyWins > baselineWins
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-base px-4 py-1"
                    : baselineWins > strategyWins
                      ? "bg-red-500/15 text-red-400 border-red-500/30 text-base px-4 py-1"
                      : "bg-amber-500/15 text-amber-400 border-amber-500/30 text-base px-4 py-1"
                }
              >
                {strategyWins > baselineWins
                  ? "STRATEGY SUPERIOR"
                  : baselineWins > strategyWins
                    ? "BASELINE SUPERIOR"
                    : "INCONCLUSIVE"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {results.map((r, i) => (
        <EvalResultCard key={i} result={r} showWhy={showWhy} />
      ))}
    </div>
  );
}
