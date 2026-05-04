/**
 * Phase 3.5A — Output Evaluation Tab.
 *
 * Runs Strategy vs Baseline comparison for selected cases,
 * showing side-by-side outputs and deterministic scorecards.
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
import { ChevronDown, Play, Trophy, Minus, Eye } from "lucide-react";
import type { ValidationCase } from "@/lib/strategy-control/cases";
import {
  buildDefaultEvalCases,
  runEvaluation,
  type EvaluationResult,
  type EvaluationCase,
} from "@/lib/strategy-control/evaluationRunner";
import type { OutputScore } from "@/lib/strategy-control/outputScorer";

interface Props {
  cases: ReadonlyArray<ValidationCase>;
}

const TIER_COLORS: Record<string, string> = {
  strong: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  partial: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  weak: "bg-red-500/15 text-red-400 border-red-500/30",
};

const DIMS = ["specificity", "actionability", "structure", "evidence", "relevance"] as const;

function ScoreBar({ label, value, max = 5 }: { label: string; value: number; max?: number }) {
  const pct = (value / max) * 100;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-muted-foreground">{label}</span>
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
        <span className="text-lg font-mono font-bold">{score.total}/25</span>
      </div>
      {DIMS.map(d => (
        <ScoreBar key={d} label={d} value={score[d]} />
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

function EvalResultCard({ result, showWhy }: { result: EvaluationResult; showWhy: boolean }) {
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [baselineOpen, setBaselineOpen] = useState(false);
  const { comparison } = result;

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
          <WinnerBadge winner={comparison.winner} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Input summary */}
        <div className="text-xs font-mono bg-muted/30 rounded p-2 space-y-0.5">
          {result.inputTerms.length > 0 && (
            <div><span className="text-muted-foreground">Input terms:</span> {result.inputTerms.join(", ")}</div>
          )}
        </div>

        {/* Baseline contamination check */}
        {result.baseline.trace && (
          <div className={`text-xs rounded p-2 border ${
            result.baseline.trace.baseline_mode === "clean_baseline"
              ? "bg-emerald-500/10 border-emerald-500/30"
              : "bg-red-500/10 border-red-500/30"
          }`}>
            <div className="font-semibold mb-1">
              {result.baseline.trace.baseline_mode === "clean_baseline" ? "✅" : "⚠️"} Baseline Integrity
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

        {/* Scorecards side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-emerald-500/20 rounded-lg p-3">
            <ScoreCard label="Strategy (with library)" score={result.strategy.score} variant="strategy" />
          </div>
          <div className="border border-sky-500/20 rounded-lg p-3">
            <ScoreCard label="Baseline (no library)" score={result.baseline.score} variant="baseline" />
          </div>
        </div>

        {/* Reasoning */}
        <div className="text-sm bg-muted/20 rounded p-3">
          <span className="text-muted-foreground">Verdict:</span> {comparison.reasoning}
        </div>

        {/* Dimension breakdown */}
        <div className="grid grid-cols-5 gap-1 text-[10px] text-center">
          {DIMS.map(d => {
            const w = comparison.dimension_winners[d];
            const bg = w === "strategy" ? "bg-emerald-500/10" : w === "baseline" ? "bg-red-500/10" : "bg-muted/30";
            return (
              <div key={d} className={`rounded p-1.5 ${bg}`}>
                <div className="font-semibold capitalize">{d}</div>
                <div className="font-mono">{result.strategy.score[d]} vs {result.baseline.score[d]}</div>
                <div className="text-muted-foreground">{w}</div>
              </div>
            );
          })}
        </div>

        {/* Show Why toggle — KI influence + expansion impact */}
        {showWhy && (
          <div className="border-t pt-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Why Strategy {comparison.winner === "strategy" ? "Won" : comparison.winner === "baseline" ? "Lost" : "Tied"}
            </p>
            {result.strategy.caseResult.signals.influence && (
              <div className="text-xs">
                <span className="text-muted-foreground">Library influence:</span>{" "}
                <span className="font-mono">{result.strategy.caseResult.signals.influence}</span>
              </div>
            )}
            {result.strategy.caseResult.signals.expanded_seeds.length > 0 && (
              <div className="text-xs">
                <span className="text-muted-foreground">Expansion terms that mattered:</span>{" "}
                <span className="font-mono">{result.strategy.caseResult.signals.expanded_seeds.join(", ")}</span>
              </div>
            )}
            {result.strategy.caseResult.signals.confidence && (
              <div className="text-xs">
                <span className="text-muted-foreground">Retrieval confidence:</span>{" "}
                <span className="font-mono">{result.strategy.caseResult.signals.confidence}</span>
              </div>
            )}
            {comparison.winner === "baseline" && (
              <div className="text-xs text-amber-400">
                ⚠ Baseline outperformed Strategy. Check if library coverage is insufficient or output is too constrained.
              </div>
            )}
          </div>
        )}

        {/* Collapsible raw outputs */}
        <div className="space-y-2 border-t pt-3">
          <Collapsible open={strategyOpen} onOpenChange={setStrategyOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]">
                <ChevronDown className={`h-3 w-3 mr-1 transition-transform ${strategyOpen ? "rotate-180" : ""}`} />
                Strategy output ({result.strategy.text.split(/\s+/).length} words, {result.strategy.caseResult.latencyMs}ms)
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

  // Aggregate stats
  const strategyWins = results.filter(r => r.comparison.winner === "strategy").length;
  const baselineWins = results.filter(r => r.comparison.winner === "baseline").length;
  const ties = results.filter(r => r.comparison.winner === "tie").length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Output Superiority Evaluation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Runs the same inputs through Strategy (library-grounded) and Baseline (no library) paths,
            then scores both outputs deterministically on 5 dimensions.
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
            {progress && (
              <span className="text-xs text-muted-foreground animate-pulse">{progress}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Aggregate summary */}
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

      {/* Per-case results */}
      {results.map((r, i) => (
        <EvalResultCard key={i} result={r} showWhy={showWhy} />
      ))}
    </div>
  );
}
