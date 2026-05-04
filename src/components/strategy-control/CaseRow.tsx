/**
 * CaseRow — one row per validation case.
 *
 * Shows: status badge, case label, key signals, latency.
 * Expands to show full raw response JSON.
 */
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, CheckCircle2, XCircle, AlertTriangle, Clock } from "lucide-react";
import type { CaseResult } from "@/lib/strategy-control/runner";

interface Props {
  result: CaseResult | null;
  running: boolean;
  caseLabel: string;
  caseDescription: string;
  /** The exact payload body sent (for transparency). */
  sentBody?: Record<string, unknown>;
  /** Client-side assertion errors (e.g. Case 3a pre-exec checks). */
  assertionError?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pass: "PASS",
  fail: "FAIL",
  expected_refusal: "EXPECTED REFUSAL",
  coverage_gap: "COVERAGE GAP",
};

function statusBadge(status: string | null) {
  if (!status) return <Badge variant="outline">PENDING</Badge>;
  if (status === "pass") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
        <CheckCircle2 className="h-3 w-3 mr-1" />PASS
      </Badge>
    );
  }
  if (status === "expected_refusal") {
    return (
      <Badge className="bg-sky-500/15 text-sky-400 border-sky-500/30">
        <CheckCircle2 className="h-3 w-3 mr-1" />EXPECTED REFUSAL
      </Badge>
    );
  }
  if (status === "coverage_gap") {
    return (
      <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30">
        <AlertTriangle className="h-3 w-3 mr-1" />COVERAGE GAP
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <XCircle className="h-3 w-3 mr-1" />{STATUS_LABEL[status] ?? status.toUpperCase()}
    </Badge>
  );
}

function Signal({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="text-xs">
      <span className="text-muted-foreground">{label}:</span>{" "}
      <span className="font-mono">{value ?? "—"}</span>
    </div>
  );
}

export function CaseRow({ result, running, caseLabel, caseDescription }: Props) {
  const [open, setOpen] = useState(false);
  const status = result?.status ?? null;
  const sig = result?.signals;

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {running && !result ? (
              <Badge variant="outline" className="animate-pulse">
                <Clock className="h-3 w-3 mr-1" />RUNNING
              </Badge>
            ) : (
              statusBadge(status)
            )}
            <span className="text-sm font-medium">{caseLabel}</span>
            {result && (
              <span className="text-xs text-muted-foreground ml-auto">
                {result.latencyMs}ms
                {result.httpStatus !== null ? ` · HTTP ${result.httpStatus}` : ""}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{caseDescription}</p>
          {result && (
            <p className="text-xs mt-2">
              <span className="text-muted-foreground">reason:</span> {result.reason}
            </p>
          )}
          {sig && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 mt-2">
              <Signal label="source_mode" value={sig.source_mode} />
              <Signal label="confidence" value={sig.confidence} />
              <Signal label="gate" value={sig.gate_decision} />
              <Signal label="influence" value={sig.influence} />
              <Signal label="generic_risk" value={sig.generic_output_risk} />
              <Signal label="schema" value={sig.schema} />
              {sig.refusal_code && <Signal label="refusal" value={sig.refusal_code} />}
              {sig.dropped_client_keys.length > 0 && (
                <Signal
                  label="dropped"
                  value={sig.dropped_client_keys.join(", ")}
                />
              )}
              {sig.overrides_clamped.length > 0 && (
                <Signal
                  label="clamped"
                  value={sig.overrides_clamped.join(", ")}
                />
              )}
            </div>
          )}
          {sig && (
            <div className="mt-3 rounded border border-border/60 bg-muted/30 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Retrieval Expansion (Phase 3B)
                </span>
                <Badge
                  variant="outline"
                  className={
                    sig.expansion_enabled
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]"
                      : "bg-muted text-muted-foreground text-[10px]"
                  }
                >
                  expansion_enabled: {String(sig.expansion_enabled)}
                </Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 mt-2">
                <Signal
                  label="lexicon_version"
                  value={sig.lexicon_version}
                />
                <Signal
                  label="raw term_seeds"
                  value={sig.term_seeds.length ? sig.term_seeds.join(", ") : null}
                />
                <Signal
                  label="expanded_seeds"
                  value={
                    sig.expanded_seeds.length ? sig.expanded_seeds.join(", ") : null
                  }
                />
                <Signal
                  label="expansion_trace"
                  value={
                    sig.expansion_trace.length
                      ? sig.expansion_trace
                          .map(
                            (e) =>
                              `${e.expansion}←${e.source}/${e.rule}${e.fromInput ? `(${e.fromInput})` : ""}`,
                          )
                          .join(" · ")
                      : null
                  }
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {result && (
        <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
              <ChevronDown
                className={`h-3 w-3 mr-1 transition-transform ${open ? "rotate-180" : ""}`}
              />
              {open ? "Hide" : "Show"} full trace JSON
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <pre className="text-[11px] bg-muted/40 p-3 rounded overflow-auto max-h-96 font-mono">
              {JSON.stringify(result.raw, null, 2)}
            </pre>
            {result.error && (
              <p className="text-xs text-destructive mt-2">error: {result.error}</p>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  );
}
