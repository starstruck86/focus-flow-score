/**
 * Strategy Global Instructions Engine — config persistence.
 *
 * Phase 1 scope: define shape, persist to localStorage, expose helpers + a
 * subscribe pattern (mirrors pinnedThreads.ts). NO prompt injection happens
 * in this phase — consumers will read this in Phase 2+.
 *
 * Design notes:
 *   • Storage key is versioned so a future schema bump can migrate cleanly.
 *   • Config is a single JSON blob (small, infrequently written).
 *   • All flags default OFF so adding this module is a no-op until the user
 *     turns the engine on in Strategy Settings.
 *   • The Discovery Prep SOP is seeded with editable raw text. Parsing is a
 *     deterministic, on-device pass — no AI call.
 */
import { DISCOVERY_PREP_SOP_SEED } from './discoveryPrepSopSeed';

const STORAGE_KEY = 'sv-strategy-config-v1';
const CONFIG_VERSION = 1;

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type StrategyTone = 'direct' | 'consultative' | 'executive';
export type StrategyDensity = 'concise' | 'balanced' | 'deep';
export type StrategyFormat = 'structured' | 'freeform';

export interface OutputPreferences {
  tone: StrategyTone;
  density: StrategyDensity;
  format: StrategyFormat;
  alwaysEndWithNextStep: boolean;
}

export interface LibraryBehavior {
  useRelevantLibraryByDefault: boolean;
  preferPlaybooksOverLooseKnowledgeItems: boolean;
  citeSourcesWhenUsed: boolean;
  neverInventMetrics: boolean;
  unknownsBecomeQuestions: boolean;
}

export interface DiscoveryPrepSopContract {
  enabled: boolean;
  rawSop: string;
  parsedAt?: string;
  nonNegotiables: string[];
  requiredInputs: string[];
  requiredOutputs: string[];
  researchWorkflow: string[];
  mandatoryChecks: string[];
  metricsProtocol: string[];
  pageOneCockpitRules: string[];
  formattingRules: string[];
  buildOrder: string[];
  qaChecklist: string[];
}

export interface StrategyGlobalInstructionsConfig {
  version: number;
  enabled: boolean;
  strictMode: boolean;
  selfCorrectOnce: boolean;
  globalInstructions: string;
  outputPreferences: OutputPreferences;
  libraryBehavior: LibraryBehavior;
  sopContracts: {
    discoveryPrepFullMode: DiscoveryPrepSopContract;
  };
  updatedAt: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────────────────────

function emptyParsedSop(): Omit<
  DiscoveryPrepSopContract,
  'enabled' | 'rawSop' | 'parsedAt'
> {
  return {
    nonNegotiables: [],
    requiredInputs: [],
    requiredOutputs: [],
    researchWorkflow: [],
    mandatoryChecks: [],
    metricsProtocol: [],
    pageOneCockpitRules: [],
    formattingRules: [],
    buildOrder: [],
    qaChecklist: [],
  };
}

export function defaultStrategyConfig(): StrategyGlobalInstructionsConfig {
  const now = new Date().toISOString();
  const seed = DISCOVERY_PREP_SOP_SEED;
  const parsedSeed = parseDiscoveryPrepSop(seed);
  return {
    version: CONFIG_VERSION,
    enabled: false,
    strictMode: false,
    selfCorrectOnce: false,
    globalInstructions: '',
    outputPreferences: {
      tone: 'direct',
      density: 'balanced',
      format: 'structured',
      alwaysEndWithNextStep: true,
    },
    libraryBehavior: {
      useRelevantLibraryByDefault: true,
      preferPlaybooksOverLooseKnowledgeItems: true,
      citeSourcesWhenUsed: true,
      neverInventMetrics: true,
      unknownsBecomeQuestions: true,
    },
    sopContracts: {
      discoveryPrepFullMode: {
        enabled: false,
        rawSop: seed,
        parsedAt: now,
        ...parsedSeed,
      },
    },
    updatedAt: now,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Storage I/O
// ──────────────────────────────────────────────────────────────────────────

function safeRead(): StrategyGlobalInstructionsConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return mergeWithDefaults(parsed as Partial<StrategyGlobalInstructionsConfig>);
  } catch {
    return null;
  }
}

function safeWrite(config: StrategyGlobalInstructionsConfig) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* quota / privacy — silently ignore */
  }
}

/** Shallow-merge a stored blob with defaults so missing keys get filled in. */
function mergeWithDefaults(
  partial: Partial<StrategyGlobalInstructionsConfig>,
): StrategyGlobalInstructionsConfig {
  const base = defaultStrategyConfig();
  const sopPartial = partial.sopContracts?.discoveryPrepFullMode ?? {};
  return {
    ...base,
    ...partial,
    version: CONFIG_VERSION,
    outputPreferences: { ...base.outputPreferences, ...(partial.outputPreferences ?? {}) },
    libraryBehavior: { ...base.libraryBehavior, ...(partial.libraryBehavior ?? {}) },
    sopContracts: {
      discoveryPrepFullMode: {
        ...base.sopContracts.discoveryPrepFullMode,
        ...sopPartial,
      },
    },
    updatedAt: partial.updatedAt ?? base.updatedAt,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

export function getStrategyConfig(): StrategyGlobalInstructionsConfig {
  return safeRead() ?? defaultStrategyConfig();
}

export function saveStrategyConfig(
  next: StrategyGlobalInstructionsConfig,
): StrategyGlobalInstructionsConfig {
  const stamped: StrategyGlobalInstructionsConfig = {
    ...next,
    version: CONFIG_VERSION,
    updatedAt: new Date().toISOString(),
  };
  safeWrite(stamped);
  notify(stamped);
  return stamped;
}

export function updateStrategyConfig(
  patch: Partial<StrategyGlobalInstructionsConfig>,
): StrategyGlobalInstructionsConfig {
  const current = getStrategyConfig();
  return saveStrategyConfig({ ...current, ...patch });
}

export function updateStrategyGlobalInstructions(
  text: string,
): StrategyGlobalInstructionsConfig {
  return updateStrategyConfig({ globalInstructions: text });
}

export function updateOutputPreferences(
  patch: Partial<OutputPreferences>,
): StrategyGlobalInstructionsConfig {
  const current = getStrategyConfig();
  return saveStrategyConfig({
    ...current,
    outputPreferences: { ...current.outputPreferences, ...patch },
  });
}

export function updateLibraryBehavior(
  patch: Partial<LibraryBehavior>,
): StrategyGlobalInstructionsConfig {
  const current = getStrategyConfig();
  return saveStrategyConfig({
    ...current,
    libraryBehavior: { ...current.libraryBehavior, ...patch },
  });
}

export function updateDiscoveryPrepSop(
  patch: Partial<DiscoveryPrepSopContract>,
): StrategyGlobalInstructionsConfig {
  const current = getStrategyConfig();
  return saveStrategyConfig({
    ...current,
    sopContracts: {
      discoveryPrepFullMode: {
        ...current.sopContracts.discoveryPrepFullMode,
        ...patch,
      },
    },
  });
}

/** Re-parse the raw SOP text and persist the structured contract. */
export function reparseDiscoveryPrepSop(): DiscoveryPrepSopContract {
  const current = getStrategyConfig();
  const parsed = parseDiscoveryPrepSop(
    current.sopContracts.discoveryPrepFullMode.rawSop,
  );
  const next: DiscoveryPrepSopContract = {
    ...current.sopContracts.discoveryPrepFullMode,
    ...parsed,
    parsedAt: new Date().toISOString(),
  };
  saveStrategyConfig({
    ...current,
    sopContracts: { discoveryPrepFullMode: next },
  });
  return next;
}

export function getDiscoveryPrepSopContract(): DiscoveryPrepSopContract {
  return getStrategyConfig().sopContracts.discoveryPrepFullMode;
}

export function isDiscoveryPrepSopEnabled(): boolean {
  const cfg = getStrategyConfig();
  return cfg.enabled && cfg.sopContracts.discoveryPrepFullMode.enabled;
}

export function isStrategyEngineEnabled(): boolean {
  return getStrategyConfig().enabled;
}

// ──────────────────────────────────────────────────────────────────────────
// Subscribe — multi-tab safe via storage event + in-memory listener set
// ──────────────────────────────────────────────────────────────────────────

type Listener = (cfg: StrategyGlobalInstructionsConfig) => void;
const listeners = new Set<Listener>();

function notify(cfg: StrategyGlobalInstructionsConfig) {
  listeners.forEach((cb) => {
    try {
      cb(cfg);
    } catch {
      /* listener failure should not break others */
    }
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    notify(getStrategyConfig());
  });
}

export function subscribeStrategyConfig(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ──────────────────────────────────────────────────────────────────────────
// SOP Parser — deterministic, on-device, no AI call
// ──────────────────────────────────────────────────────────────────────────

/**
 * Parse a free-text SOP into the structured contract shape. The parser is
 * heading-driven: it scans for known section headings (case-insensitive) and
 * collects the lines underneath each as bullet-style entries. Unknown
 * sections are ignored so users can paste extra prose without breaking
 * parsing.
 *
 * Bullet detection accepts: "-", "*", "•", "1.", "1)", or a leading hyphen.
 * Lines that don't look like bullets are kept whole (one entry per line).
 */
export function parseDiscoveryPrepSop(raw: string): Omit<
  DiscoveryPrepSopContract,
  'enabled' | 'rawSop' | 'parsedAt'
> {
  const out = emptyParsedSop();
  if (!raw || typeof raw !== 'string') return out;

  type SectionKey = keyof typeof out;
  const headingMap: Array<{ pattern: RegExp; key: SectionKey }> = [
    { pattern: /^non[-\s]?negotiables?\b/i,        key: 'nonNegotiables' },
    { pattern: /^required\s+inputs?\b/i,           key: 'requiredInputs' },
    { pattern: /^required\s+outputs?\b/i,          key: 'requiredOutputs' },
    { pattern: /^research\s+workflow\b/i,          key: 'researchWorkflow' },
    { pattern: /^mandatory\s+checks?\b/i,          key: 'mandatoryChecks' },
    { pattern: /^metrics?\s+protocol\b/i,          key: 'metricsProtocol' },
    { pattern: /^page[-\s]?1\s+cockpit\s+rules?\b/i, key: 'pageOneCockpitRules' },
    { pattern: /^page[-\s]?one\s+cockpit\s+rules?\b/i, key: 'pageOneCockpitRules' },
    { pattern: /^formatting\s+rules?\b/i,          key: 'formattingRules' },
    { pattern: /^build\s+order\b/i,                key: 'buildOrder' },
    { pattern: /^qa\s+checklist\b/i,               key: 'qaChecklist' },
  ];

  let active: SectionKey | null = null;
  const lines = raw.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Heading match? (allow trailing colon)
    const headingCandidate = line.replace(/[:\-–—]+$/, '').trim();
    const matched = headingMap.find((h) => h.pattern.test(headingCandidate));
    if (matched) {
      active = matched.key;
      continue;
    }

    if (!active) continue;

    // Bullet / numbered line stripping
    const cleaned = line
      .replace(/^[-*•]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim();
    if (cleaned) out[active].push(cleaned);
  }

  return out;
}
