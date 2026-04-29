/**
 * VerdictHeader — top banner showing GO / COVERAGE GAP / NO-GO.
 */
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { VerdictReport } from "@/lib/strategy-control/verdict";

interface Props {
  report: VerdictReport | null;
  running: boolean;
}

export function VerdictHeader({ report, running }: Props) {
  if (running) {
    return (
      <Card className="border-primary/40">
        <CardContent className="py-4 flex items-center gap-3">
          <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">Running validation suite…</p>
        </CardContent>
      </Card>
    );
  }
  if (!report) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            Click <strong>Run Strategy Validation</strong> to execute all 7 cases.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isGo = report.verdict === "GO";
  const isGap = report.verdict === "COVERAGE_GAP";
  const isNoGo = report.verdict === "NO_GO";

  const Icon = isGo ? CheckCircle2 : isGap ? AlertTriangle : XCircle;
  const badgeVariant: "default" | "secondary" | "destructive" =
    isGo ? "default" : isGap ? "secondary" : "destructive";
  const ringClass = isGo
    ? "border-emerald-500/50"
    : isGap
      ? "border-amber-500/50"
      : "border-destructive/50";

  return (
    <Card className={ringClass}>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center gap-3">
          <Icon className="h-6 w-6" />
          <Badge variant={badgeVariant} className="text-base px-3 py-1">
            {report.verdict.replace("_", " ")}
          </Badge>
          <p className="text-sm text-muted-foreground">{report.reason}</p>
        </div>
        {report.details.length > 0 && (
          <ul className="text-xs text-muted-foreground list-disc pl-6 space-y-1">
            {report.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
        {isNoGo && (
          <p className="text-xs font-medium text-destructive">
            Phase 3.5 remains BLOCKED.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
