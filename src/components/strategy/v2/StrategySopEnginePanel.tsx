/**
 * StrategySopEnginePanel — Strategy Settings: Universal SOP Engine (Phase 1).
 *
 * Phase 1 scope: UI + persistence only. NO prompt injection happens. Edits
 * write to localStorage via strategyConfig (universal contracts).
 *
 * Layout: 3-tab panel (Global · Workspaces · Tasks). Each contract is
 * rendered as a card with:
 *   • enable toggle
 *   • name
 *   • raw instructions textarea
 *   • library rules (5 toggles)
 *   • enforcement (strict / self-correct / required sections)
 *
 * The Discovery Prep task SOP is the same data the legacy
 * GlobalInstructionsPanel surfaces; edits here mirror back to the legacy
 * `discoveryPrepFullMode` field automatically.
 */
import { useEffect, useMemo, useState } from 'react';
import { Globe2, Layers, Wrench, ShieldCheck, BookOpenCheck } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  getStrategyConfig,
  subscribeStrategyConfig,
  updateGlobalSop,
  updateWorkspaceSop,
  updateTaskSop,
  STRATEGY_WORKSPACE_SOP_KEYS,
  STRATEGY_TASK_SOP_KEYS,
  type StrategyGlobalInstructionsConfig,
  type StrategySopContract,
  type StrategyWorkspaceSopKey,
  type StrategyTaskSopKey,
} from '@/lib/strategy/strategyConfig';

// ──────────────────────────────────────────────────────────────────────────
// Labels
// ──────────────────────────────────────────────────────────────────────────

const WORKSPACE_LABELS: Record<StrategyWorkspaceSopKey, string> = {
  brainstorm: 'Brainstorm',
  deep_research: 'Deep Research',
  refine: 'Refine',
  library: 'Library',
  artifacts: 'Artifacts',
  projects: 'Projects',
  work: 'Work',
};

const TASK_LABELS: Record<StrategyTaskSopKey, string> = {
  discovery_prep: 'Discovery Prep',
  deal_review: 'Deal Review',
  account_research: 'Account Research',
  recap_email: 'Recap Email',
  roi_model: 'ROI Model',
};

// ──────────────────────────────────────────────────────────────────────────
// Tiny helpers
// ──────────────────────────────────────────────────────────────────────────

function emptyContract(name: string): StrategySopContract {
  return {
    enabled: false,
    name,
    rawInstructions: '',
    parsedSections: {},
    libraryRules: {
      preferTemplates: false,
      preferPlaybooks: false,
      citeSources: true,
      neverInventMetrics: true,
      unknownsBecomeQuestions: true,
    },
    enforcement: { strict: false, selfCorrectOnce: false, requiredSections: [] },
    updatedAt: new Date().toISOString(),
  };
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

// ──────────────────────────────────────────────────────────────────────────
// Generic SOP card
// ──────────────────────────────────────────────────────────────────────────

interface SopCardProps {
  /** Stable id used for testIDs only. */
  id: string;
  defaultName: string;
  contract: StrategySopContract;
  onChange: (patch: Partial<StrategySopContract>) => void;
  /** Visual hint (workspace tag, task chip, etc.). */
  badge?: string;
}

function SopCard({ id, defaultName, contract, onChange, badge }: SopCardProps) {
  const [nameLocal, setNameLocal] = useState(contract.name);
  const [rawLocal, setRawLocal] = useState(contract.rawInstructions);
  const [requiredSectionsLocal, setRequiredSectionsLocal] = useState(
    (contract.enforcement?.requiredSections ?? []).join(', '),
  );

  useEffect(() => { setNameLocal(contract.name); }, [contract.name]);
  useEffect(() => { setRawLocal(contract.rawInstructions); }, [contract.rawInstructions]);
  useEffect(() => {
    setRequiredSectionsLocal((contract.enforcement?.requiredSections ?? []).join(', '));
  }, [contract.enforcement?.requiredSections]);

  const lib = contract.libraryRules ?? emptyContract(defaultName).libraryRules!;
  const enf = contract.enforcement ?? emptyContract(defaultName).enforcement!;

  return (
    <section
      className="rounded-xl p-4 sm:p-5"
      style={{
        background: 'hsl(var(--sv-paper-2, var(--sv-paper)))',
        border: '1px solid hsl(var(--sv-line))',
      }}
      data-testid={`sop-card-${id}`}
    >
      <header className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3
              className="text-[14px] font-semibold leading-tight"
              style={{ color: 'hsl(var(--sv-ink))' }}
            >
              {contract.name || defaultName}
            </h3>
            {badge && (
              <span
                className="px-1.5 py-0.5 rounded text-[10.5px] font-medium"
                style={{ background: 'hsl(var(--sv-line) / 0.6)', color: 'hsl(var(--sv-muted))' }}
              >
                {badge}
              </span>
            )}
          </div>
          <p className="text-[11.5px]" style={{ color: 'hsl(var(--sv-muted))' }}>
            Stored only — Phase 1 does not change model behavior yet.
          </p>
        </div>
        <Switch
          checked={contract.enabled}
          onCheckedChange={(v) => onChange({ enabled: v })}
          data-testid={`sop-enable-${id}`}
        />
      </header>

      <div className="space-y-4">
        {/* Name */}
        <div>
          <Label className="text-[12px] font-medium block mb-1" style={{ color: 'hsl(var(--sv-ink))' }}>
            Name
          </Label>
          <Input
            value={nameLocal}
            onChange={(e) => setNameLocal(e.target.value)}
            onBlur={() => { if (nameLocal !== contract.name) onChange({ name: nameLocal }); }}
            placeholder={defaultName}
            className="h-8 text-[13px]"
            data-testid={`sop-name-${id}`}
          />
        </div>

        {/* Raw instructions */}
        <div>
          <Label className="text-[12px] font-medium" style={{ color: 'hsl(var(--sv-ink))' }}>
            Raw instructions
          </Label>
          <p className="text-[11px] mb-2" style={{ color: 'hsl(var(--sv-muted))' }}>
            Behavior, structure, formatting, or process. Free-form. Saved on blur.
          </p>
          <Textarea
            value={rawLocal}
            onChange={(e) => setRawLocal(e.target.value)}
            onBlur={() => { if (rawLocal !== contract.rawInstructions) onChange({ rawInstructions: rawLocal }); }}
            placeholder="e.g. Open with the recommendation. Always cite KIs by id. Never invent metrics."
            className="min-h-[140px] text-[12.5px] leading-relaxed font-mono"
            data-testid={`sop-raw-${id}`}
          />
        </div>

        {/* Library rules */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <BookOpenCheck className="h-3.5 w-3.5" style={{ color: 'hsl(var(--sv-clay))' }} />
            <span
              className="text-[11px] uppercase tracking-wide font-semibold"
              style={{ color: 'hsl(var(--sv-muted))' }}
            >
              Library rules
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
            <ToggleRow
              label="Prefer templates"
              checked={lib.preferTemplates}
              onChange={(v) => onChange({ libraryRules: { ...lib, preferTemplates: v } })}
            />
            <ToggleRow
              label="Prefer playbooks"
              checked={lib.preferPlaybooks}
              onChange={(v) => onChange({ libraryRules: { ...lib, preferPlaybooks: v } })}
            />
            <ToggleRow
              label="Cite sources"
              checked={lib.citeSources}
              onChange={(v) => onChange({ libraryRules: { ...lib, citeSources: v } })}
            />
            <ToggleRow
              label="Never invent metrics"
              checked={lib.neverInventMetrics}
              onChange={(v) => onChange({ libraryRules: { ...lib, neverInventMetrics: v } })}
            />
            <ToggleRow
              label="Unknowns become questions"
              checked={lib.unknownsBecomeQuestions}
              onChange={(v) => onChange({ libraryRules: { ...lib, unknownsBecomeQuestions: v } })}
            />
          </div>
        </div>

        {/* Enforcement */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <ShieldCheck className="h-3.5 w-3.5" style={{ color: 'hsl(var(--sv-clay))' }} />
            <span
              className="text-[11px] uppercase tracking-wide font-semibold"
              style={{ color: 'hsl(var(--sv-muted))' }}
            >
              Enforcement
            </span>
          </div>
          <div className="space-y-2.5">
            <ToggleRow
              label="Strict mode"
              description="Validate required sections before output (Phase 4 will enforce)."
              checked={enf.strict}
              onChange={(v) => onChange({ enforcement: { ...enf, strict: v } })}
            />
            <ToggleRow
              label="Self-correct once"
              description="If validation fails, attempt one silent correction."
              checked={enf.selfCorrectOnce}
              onChange={(v) => onChange({ enforcement: { ...enf, selfCorrectOnce: v } })}
            />
            <div>
              <Label
                className="text-[12px] font-medium block mb-1"
                style={{ color: 'hsl(var(--sv-ink))' }}
              >
                Required sections
              </Label>
              <p className="text-[11px] mb-1.5" style={{ color: 'hsl(var(--sv-muted))' }}>
                Comma-separated. Used by future validators to gate output.
              </p>
              <Input
                value={requiredSectionsLocal}
                onChange={(e) => setRequiredSectionsLocal(e.target.value)}
                onBlur={() => {
                  const next = requiredSectionsLocal
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const prev = enf.requiredSections ?? [];
                  if (next.join('|') !== prev.join('|')) {
                    onChange({ enforcement: { ...enf, requiredSections: next } });
                  }
                }}
                placeholder="e.g. cockpit, thesis, next_steps"
                className="h-8 text-[12.5px]"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Main panel
// ──────────────────────────────────────────────────────────────────────────

export function StrategySopEnginePanel() {
  const [cfg, setCfg] = useState<StrategyGlobalInstructionsConfig>(() => getStrategyConfig());
  useEffect(() => subscribeStrategyConfig(setCfg), []);

  const globalContract = cfg.sopContracts.global ?? emptyContract('Global Strategy SOP');

  const enabledCount = useMemo(() => {
    let n = 0;
    if (cfg.sopContracts.global?.enabled) n += 1;
    for (const k of STRATEGY_WORKSPACE_SOP_KEYS) {
      if (cfg.sopContracts.workspaces[k]?.enabled) n += 1;
    }
    for (const k of STRATEGY_TASK_SOP_KEYS) {
      if (cfg.sopContracts.tasks[k]?.enabled) n += 1;
    }
    return n;
  }, [cfg]);

  return (
    <section className="space-y-4" data-testid="strategy-sop-engine">
      <header className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'hsl(var(--sv-clay) / 0.12)', color: 'hsl(var(--sv-clay))' }}
        >
          <Layers className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2
            className="text-[15px] font-semibold leading-tight"
            style={{ color: 'hsl(var(--sv-ink))' }}
          >
            Strategy SOP Engine
          </h2>
          <p className="text-[12px] mt-0.5" style={{ color: 'hsl(var(--sv-muted))' }}>
            Define how Strategy behaves at three levels — Global, Workspace, Task.
            <span
              className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium"
              style={{ background: 'hsl(var(--sv-line) / 0.6)', color: 'hsl(var(--sv-muted))' }}
            >
              Phase 1 · Stored
            </span>
            <span className="ml-1.5 text-[11.5px]" style={{ color: 'hsl(var(--sv-muted))' }}>
              {enabledCount} active
            </span>
          </p>
        </div>
      </header>

      <Tabs defaultValue="global" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="global" className="text-[12.5px] gap-1.5">
            <Globe2 className="h-3.5 w-3.5" /> Global
          </TabsTrigger>
          <TabsTrigger value="workspaces" className="text-[12.5px] gap-1.5">
            <Layers className="h-3.5 w-3.5" /> Workspaces
          </TabsTrigger>
          <TabsTrigger value="tasks" className="text-[12.5px] gap-1.5">
            <Wrench className="h-3.5 w-3.5" /> Tasks
          </TabsTrigger>
        </TabsList>

        <TabsContent value="global" className="mt-4">
          <SopCard
            id="global"
            defaultName="Global Strategy SOP"
            contract={globalContract}
            onChange={(patch) => updateGlobalSop(patch)}
            badge="applies to every turn"
          />
        </TabsContent>

        <TabsContent value="workspaces" className="mt-4 space-y-4">
          {STRATEGY_WORKSPACE_SOP_KEYS.map((key) => {
            const c = cfg.sopContracts.workspaces[key] ?? emptyContract(`${WORKSPACE_LABELS[key]} SOP`);
            return (
              <SopCard
                key={key}
                id={`ws-${key}`}
                defaultName={`${WORKSPACE_LABELS[key]} SOP`}
                contract={c}
                badge={WORKSPACE_LABELS[key]}
                onChange={(patch) => updateWorkspaceSop(key, patch)}
              />
            );
          })}
        </TabsContent>

        <TabsContent value="tasks" className="mt-4 space-y-4">
          {STRATEGY_TASK_SOP_KEYS.map((key) => {
            const c = cfg.sopContracts.tasks[key] ?? emptyContract(`${TASK_LABELS[key]} SOP`);
            return (
              <SopCard
                key={key}
                id={`task-${key}`}
                defaultName={`${TASK_LABELS[key]} SOP`}
                contract={c}
                badge={TASK_LABELS[key]}
                onChange={(patch) => updateTaskSop(key, patch)}
              />
            );
          })}
        </TabsContent>
      </Tabs>
    </section>
  );
}

export default StrategySopEnginePanel;
