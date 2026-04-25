/**
 * GlobalInstructionsPanel — Strategy Settings: Global Instructions Engine.
 *
 * Phase 1 scope: UI + persistence ONLY. No prompt injection. Edits write to
 * localStorage via strategyConfig.ts. Existing AI behavior is unchanged.
 *
 * Layout: 4 stacked cards (Global Behavior / Discovery Prep SOP / Library
 * Behavior / Enforcement). Each card auto-saves on field change so users
 * never see a "save" trap.
 */
import { useEffect, useMemo, useState } from 'react';
import { Settings2, Sparkles, Target, ShieldCheck, BookOpenCheck, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  getStrategyConfig,
  subscribeStrategyConfig,
  updateStrategyConfig,
  updateStrategyGlobalInstructions,
  updateOutputPreferences,
  updateLibraryBehavior,
  updateDiscoveryPrepSop,
  reparseDiscoveryPrepSop,
  type StrategyGlobalInstructionsConfig,
  type StrategyTone,
  type StrategyDensity,
  type StrategyFormat,
} from '@/lib/strategy/strategyConfig';

// ──────────────────────────────────────────────────────────────────────────
// Tiny presentational primitives — kept in-file to avoid noise
// ──────────────────────────────────────────────────────────────────────────

function Card(props: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const Icon = props.icon;
  return (
    <section
      className="rounded-xl p-4 sm:p-5"
      style={{
        background: 'hsl(var(--sv-paper-2, var(--sv-paper)))',
        border: '1px solid hsl(var(--sv-line))',
      }}
    >
      <header className="flex items-start gap-3 mb-4">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'hsl(var(--sv-clay) / 0.12)', color: 'hsl(var(--sv-clay))' }}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2
            className="text-[14px] font-semibold leading-tight"
            style={{ color: 'hsl(var(--sv-ink))' }}
          >
            {props.title}
          </h2>
          {props.subtitle && (
            <p className="text-[12px] mt-0.5" style={{ color: 'hsl(var(--sv-muted))' }}>
              {props.subtitle}
            </p>
          )}
        </div>
      </header>
      <div className="space-y-4">{props.children}</div>
    </section>
  );
}

function ToggleRow(props: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label className="text-[12.5px] font-medium" style={{ color: 'hsl(var(--sv-ink))' }}>
          {props.label}
        </Label>
        {props.description && (
          <p className="text-[11.5px] mt-0.5" style={{ color: 'hsl(var(--sv-muted))' }}>
            {props.description}
          </p>
        )}
      </div>
      <Switch
        checked={props.checked}
        onCheckedChange={props.onChange}
        disabled={props.disabled}
        data-testid={props.testId}
      />
    </div>
  );
}

function SegmentedControl<T extends string>(props: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={props.ariaLabel}
      className="inline-flex rounded-lg p-0.5"
      style={{ background: 'hsl(var(--sv-line) / 0.5)' }}
    >
      {props.options.map((opt) => {
        const active = opt.value === props.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => props.onChange(opt.value)}
            className="px-2.5 py-1 text-[12px] rounded-md transition"
            style={{
              background: active ? 'hsl(var(--sv-paper))' : 'transparent',
              color: active ? 'hsl(var(--sv-ink))' : 'hsl(var(--sv-muted))',
              fontWeight: active ? 600 : 500,
              boxShadow: active ? '0 1px 2px hsl(var(--sv-ink) / 0.06)' : 'none',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ParsedSection(props: { label: string; entries: string[] }) {
  if (!props.entries.length) {
    return (
      <div>
        <div
          className="text-[11px] uppercase tracking-wide font-semibold mb-1"
          style={{ color: 'hsl(var(--sv-muted))' }}
        >
          {props.label}
        </div>
        <div className="text-[12px] italic" style={{ color: 'hsl(var(--sv-muted))' }}>
          (none parsed)
        </div>
      </div>
    );
  }
  return (
    <div>
      <div
        className="text-[11px] uppercase tracking-wide font-semibold mb-1"
        style={{ color: 'hsl(var(--sv-muted))' }}
      >
        {props.label} <span className="opacity-60">({props.entries.length})</span>
      </div>
      <ul className="space-y-0.5 list-disc pl-4">
        {props.entries.map((e, i) => (
          <li key={i} className="text-[12.5px] leading-snug" style={{ color: 'hsl(var(--sv-ink))' }}>
            {e}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Main panel
// ──────────────────────────────────────────────────────────────────────────

export function GlobalInstructionsPanel() {
  const [cfg, setCfg] = useState<StrategyGlobalInstructionsConfig>(() => getStrategyConfig());
  // Local mirrors so typing stays snappy; we flush on blur (not on every keystroke).
  const [globalText, setGlobalText] = useState(cfg.globalInstructions);
  const [sopText, setSopText] = useState(cfg.sopContracts.discoveryPrepFullMode.rawSop);

  useEffect(() => {
    const unsub = subscribeStrategyConfig((next) => {
      setCfg(next);
      setGlobalText(next.globalInstructions);
      setSopText(next.sopContracts.discoveryPrepFullMode.rawSop);
    });
    return unsub;
  }, []);

  const sop = cfg.sopContracts.discoveryPrepFullMode;

  // Auto-save handlers ------------------------------------------------------
  const setEnabled = (v: boolean) => updateStrategyConfig({ enabled: v });
  const setStrict = (v: boolean) => updateStrategyConfig({ strictMode: v });
  const setSelfCorrect = (v: boolean) => updateStrategyConfig({ selfCorrectOnce: v });

  const flushGlobal = () => {
    if (globalText !== cfg.globalInstructions) {
      updateStrategyGlobalInstructions(globalText);
    }
  };
  const flushSop = () => {
    if (sopText !== sop.rawSop) {
      updateDiscoveryPrepSop({ rawSop: sopText });
    }
  };

  const onParseSop = () => {
    // Persist any unsaved edits first, then re-parse.
    if (sopText !== sop.rawSop) {
      updateDiscoveryPrepSop({ rawSop: sopText });
    }
    reparseDiscoveryPrepSop();
    toast.success('SOP parsed', {
      description: 'Discovery Prep SOP contract updated.',
    });
  };

  const parsedTotal = useMemo(
    () =>
      sop.nonNegotiables.length +
      sop.requiredInputs.length +
      sop.requiredOutputs.length +
      sop.researchWorkflow.length +
      sop.mandatoryChecks.length +
      sop.metricsProtocol.length +
      sop.pageOneCockpitRules.length +
      sop.formattingRules.length +
      sop.buildOrder.length +
      sop.qaChecklist.length,
    [sop],
  );

  return (
    <div className="space-y-4">
      {/* Section header ---------------------------------------------------- */}
      <header className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'hsl(var(--sv-clay) / 0.12)', color: 'hsl(var(--sv-clay))' }}
        >
          <Settings2 className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2
            className="text-[15px] font-semibold leading-tight"
            style={{ color: 'hsl(var(--sv-ink))' }}
          >
            Strategy Global Instructions Engine
          </h2>
          <p className="text-[12px] mt-0.5" style={{ color: 'hsl(var(--sv-muted))' }}>
            Controls how Strategy behaves across chat, workspaces, pills, artifacts, and
            workflows.
            <span
              className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium"
              style={{
                background: 'hsl(var(--sv-line) / 0.6)',
                color: 'hsl(var(--sv-muted))',
              }}
            >
              Phase 2 · Chat live
            </span>
          </p>
        </div>
      </header>

      {/* 1. Global Behavior ----------------------------------------------- */}
      <Card
        icon={Sparkles}
        title="Global Behavior"
        subtitle="What Strategy should always do — applied broadly across surfaces."
      >
        <ToggleRow
          label="Enable Global Instructions"
          description="Master switch for the engine. When off, nothing is applied."
          checked={cfg.enabled}
          onChange={setEnabled}
          testId="strategy-engine-enable"
        />

        <div>
          <Label className="text-[12.5px] font-medium" style={{ color: 'hsl(var(--sv-ink))' }}>
            What should Strategy always do?
          </Label>
          <p className="text-[11.5px] mb-2" style={{ color: 'hsl(var(--sv-muted))' }}>
            Behavior, not task process. Pills define tasks. Library defines evidence.
          </p>
          <Textarea
            value={globalText}
            onChange={(e) => setGlobalText(e.target.value)}
            onBlur={flushGlobal}
            placeholder="e.g. Be direct. Lead with the recommendation. Cite sources when used. Never invent metrics. Always end with a single concrete next step."
            className="min-h-[140px] text-[13px] leading-relaxed"
            data-testid="strategy-global-instructions"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-[12px] font-medium block mb-1.5" style={{ color: 'hsl(var(--sv-ink))' }}>
              Tone
            </Label>
            <SegmentedControl<StrategyTone>
              ariaLabel="Tone"
              value={cfg.outputPreferences.tone}
              options={[
                { value: 'direct', label: 'Direct' },
                { value: 'consultative', label: 'Consultative' },
                { value: 'executive', label: 'Executive' },
              ]}
              onChange={(v) => updateOutputPreferences({ tone: v })}
            />
          </div>
          <div>
            <Label className="text-[12px] font-medium block mb-1.5" style={{ color: 'hsl(var(--sv-ink))' }}>
              Density
            </Label>
            <SegmentedControl<StrategyDensity>
              ariaLabel="Density"
              value={cfg.outputPreferences.density}
              options={[
                { value: 'concise', label: 'Concise' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'deep', label: 'Deep' },
              ]}
              onChange={(v) => updateOutputPreferences({ density: v })}
            />
          </div>
          <div>
            <Label className="text-[12px] font-medium block mb-1.5" style={{ color: 'hsl(var(--sv-ink))' }}>
              Format
            </Label>
            <SegmentedControl<StrategyFormat>
              ariaLabel="Format"
              value={cfg.outputPreferences.format}
              options={[
                { value: 'structured', label: 'Structured' },
                { value: 'freeform', label: 'Freeform' },
              ]}
              onChange={(v) => updateOutputPreferences({ format: v })}
            />
          </div>
          <div className="flex items-end">
            <ToggleRow
              label="Always end with Next Step"
              checked={cfg.outputPreferences.alwaysEndWithNextStep}
              onChange={(v) => updateOutputPreferences({ alwaysEndWithNextStep: v })}
            />
          </div>
        </div>
      </Card>

      {/* 2. Discovery Prep SOP -------------------------------------------- */}
      <Card
        icon={Target}
        title="Discovery Prep SOP"
        subtitle="Process contract for Discovery Prep — applied only when that workflow runs."
      >
        <ToggleRow
          label="Enable Discovery Prep Full Mode SOP"
          description="When off, the SOP is stored but not applied."
          checked={sop.enabled}
          onChange={(v) => updateDiscoveryPrepSop({ enabled: v })}
          testId="discovery-sop-enable"
        />

        <div>
          <Label className="text-[12.5px] font-medium" style={{ color: 'hsl(var(--sv-ink))' }}>
            Paste SOP
          </Label>
          <p className="text-[11.5px] mb-2" style={{ color: 'hsl(var(--sv-muted))' }}>
            Use section headings (Non-Negotiables, Required Inputs, Build Order, etc.). Bullets,
            numbers, and dashes are all parsed.
          </p>
          <Textarea
            value={sopText}
            onChange={(e) => setSopText(e.target.value)}
            onBlur={flushSop}
            placeholder="NON-NEGOTIABLES&#10;- ...&#10;&#10;REQUIRED INPUTS&#10;- ..."
            className="min-h-[260px] text-[12.5px] leading-relaxed font-mono"
            data-testid="discovery-sop-raw"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="text-[11.5px]" style={{ color: 'hsl(var(--sv-muted))' }}>
              {sop.parsedAt ? (
                <>Parsed {parsedTotal} entries · last parsed {new Date(sop.parsedAt).toLocaleString()}</>
              ) : (
                <>Not yet parsed.</>
              )}
            </div>
            <Button
              size="sm"
              onClick={onParseSop}
              data-testid="discovery-sop-parse"
              className="h-8 text-[12px] gap-1.5"
            >
              <ClipboardList className="h-3.5 w-3.5" />
              Parse SOP into enforceable contract
            </Button>
          </div>
        </div>

        <div
          className="rounded-lg p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3"
          style={{
            background: 'hsl(var(--sv-paper))',
            border: '1px dashed hsl(var(--sv-line))',
          }}
          data-testid="discovery-sop-preview"
        >
          <ParsedSection label="Non-Negotiables"          entries={sop.nonNegotiables} />
          <ParsedSection label="Required Inputs"          entries={sop.requiredInputs} />
          <ParsedSection label="Required Outputs"         entries={sop.requiredOutputs} />
          <ParsedSection label="Research Workflow"        entries={sop.researchWorkflow} />
          <ParsedSection label="Mandatory Checks"         entries={sop.mandatoryChecks} />
          <ParsedSection label="Metrics Protocol"         entries={sop.metricsProtocol} />
          <ParsedSection label="Page-1 Cockpit Rules"     entries={sop.pageOneCockpitRules} />
          <ParsedSection label="Formatting Rules"         entries={sop.formattingRules} />
          <ParsedSection label="Build Order"              entries={sop.buildOrder} />
          <ParsedSection label="QA Checklist"             entries={sop.qaChecklist} />
        </div>
      </Card>

      {/* 3. Library Behavior ---------------------------------------------- */}
      <Card
        icon={BookOpenCheck}
        title="Library Behavior"
        subtitle="How Strategy uses your library, playbooks, and KIs."
      >
        <ToggleRow
          label="Use relevant library by default"
          checked={cfg.libraryBehavior.useRelevantLibraryByDefault}
          onChange={(v) => updateLibraryBehavior({ useRelevantLibraryByDefault: v })}
        />
        <ToggleRow
          label="Prefer playbooks / templates / examples over loose KIs"
          checked={cfg.libraryBehavior.preferPlaybooksOverLooseKnowledgeItems}
          onChange={(v) => updateLibraryBehavior({ preferPlaybooksOverLooseKnowledgeItems: v })}
        />
        <ToggleRow
          label="Cite library / source when used"
          checked={cfg.libraryBehavior.citeSourcesWhenUsed}
          onChange={(v) => updateLibraryBehavior({ citeSourcesWhenUsed: v })}
        />
        <ToggleRow
          label="Never invent metrics"
          description="AOV, LTV, CAC, churn, margin, conversion — never guessed."
          checked={cfg.libraryBehavior.neverInventMetrics}
          onChange={(v) => updateLibraryBehavior({ neverInventMetrics: v })}
        />
        <ToggleRow
          label="Convert unknowns into discovery questions"
          checked={cfg.libraryBehavior.unknownsBecomeQuestions}
          onChange={(v) => updateLibraryBehavior({ unknownsBecomeQuestions: v })}
        />
      </Card>

      {/* 4. Enforcement --------------------------------------------------- */}
      <Card
        icon={ShieldCheck}
        title="Enforcement"
        subtitle="Validation behavior. Applies only to matching workflows, not every chat."
      >
        <ToggleRow
          label="Strict Mode"
          description="Validates required task sections before output."
          checked={cfg.strictMode}
          onChange={setStrict}
          testId="strategy-strict-mode"
        />
        <ToggleRow
          label="Self-correct once before returning"
          description="If validation fails, attempt one silent self-correction."
          checked={cfg.selfCorrectOnce}
          onChange={setSelfCorrect}
          testId="strategy-self-correct"
        />
        <p className="text-[11.5px]" style={{ color: 'hsl(var(--sv-muted))' }}>
          Strict mode validates required task sections before output. It only applies to matching
          workflows (e.g. Discovery Prep), not every chat turn.
        </p>
      </Card>
    </div>
  );
}

export default GlobalInstructionsPanel;
