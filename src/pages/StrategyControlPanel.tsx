/**
 * /strategy/control — Strategy Control Panel
 *
 * Phase 3A validation surface. Hidden, owner-only, no nav link.
 * Calls the existing strategy-chat edge function with x-skill-debug
 * to run 7 locked validation cases against real auth + real library.
 *
 * Constraints honored:
 *   - No edge function changes
 *   - No DB changes
 *   - No persistence
 *   - No synthesis injection
 *   - No artifact handoff
 *   - Default Strategy path untouched
 */
import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { SafePage } from "@/components/SafePage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Play, ShieldOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  buildCases,
  DEFAULT_INPUTS,
  type ValidationInputs,
} from "@/lib/strategy-control/cases";
import {
  preflight,
  runAllCases,
  type CaseResult,
  type PreflightResult,
} from "@/lib/strategy-control/runner";
import { computeVerdict, type VerdictReport } from "@/lib/strategy-control/verdict";
import { VerdictHeader } from "@/components/strategy-control/VerdictHeader";
import { CaseRow } from "@/components/strategy-control/CaseRow";

const OWNER_EMAIL = "corey.hartin@gmail.com";

export default function StrategyControlPanel() {
  const { user, loading } = useAuth();
  const [inputs, setInputs] = useState<ValidationInputs>(DEFAULT_INPUTS);
  const [results, setResults] = useState<CaseResult[]>([]);
  const [running, setRunning] = useState(false);
  const [preflightState, setPreflightState] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(true);

  const cases = useMemo(() => buildCases(inputs), [inputs]);
  const verdict: VerdictReport | null = useMemo(
    () => (results.length === cases.length ? computeVerdict(results) : null),
    [results, cases.length],
  );

  const isOwner =
    !!user?.email && user.email.toLowerCase() === OWNER_EMAIL.toLowerCase();

  // Pre-flight on mount (only if owner)
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
    const acc: CaseResult[] = [];
    await runAllCases(cases, (res) => {
      acc.push(res);
      setResults([...acc]);
    });
    setRunning(false);
  };

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

            {/* Action */}
            <div className="flex items-center gap-3">
              <Button
                onClick={onRun}
                disabled={running || !preflightState?.flagOn}
                size="lg"
              >
                <Play className="h-4 w-4 mr-2" />
                {running ? "Running…" : "Run Strategy Validation"}
              </Button>
              {results.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {results.length} of {cases.length} cases complete
                </span>
              )}
            </div>

            {/* Verdict */}
            <VerdictHeader report={verdict} running={running && results.length < cases.length} />

            {/* Cases */}
            <div className="space-y-2">
              {cases.map((c, i) => (
                <CaseRow
                  key={c.id}
                  result={results[i] ?? null}
                  running={running}
                  caseLabel={c.label}
                  caseDescription={c.description}
                />
              ))}
            </div>
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
