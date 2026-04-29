/**
 * Skill Schema Validator — Phase 1 (inert).
 *
 * Pure validator that enforces the manifest contract. The most
 * important checks are the **library-first guarantees**:
 *
 *   • No static `resource_ids` / `playbook_ids` / `library_ids` keys.
 *   • Retrieval is expressed as a query plan with term bindings.
 *   • Term bindings must reference `${inputs.*}` (no literal seeds).
 *   • behaviorIntent and workspace are bounded enums.
 *   • Each skill carries a quality rubric with at least one mustHave
 *     and at least one genericMarker.
 */
import type {
  SkillBehaviorIntent,
  SkillDepth,
  SkillManifest,
  SkillSourceMode,
  SkillWorkspace,
} from './types';

const VALID_INTENTS: ReadonlySet<SkillBehaviorIntent> = new Set<SkillBehaviorIntent>([
  'conversation_strategy',
  'pov_synthesis',
  'research_brief',
  'idea_generation',
  'refine_message',
  'discovery_prep',
  'account_brief',
  'ninety_day_plan',
  'objection_handling',
  'stakeholder_map',
]);

const VALID_WORKSPACES: ReadonlySet<SkillWorkspace> = new Set<SkillWorkspace>([
  'brainstorm',
  'deep_research',
  'refine',
  'library',
  'artifacts',
  'projects',
  'work',
]);

const VALID_DEPTHS: ReadonlySet<SkillDepth> = new Set<SkillDepth>([
  'quick',
  'standard',
  'deep',
  'artifact',
]);

const VALID_SOURCE_MODES: ReadonlySet<SkillSourceMode> = new Set<SkillSourceMode>([
  'library_first',
  'library_required',
  'library_relevant',
]);

/** Forbidden manifest keys that would constitute a static library list. */
const FORBIDDEN_STATIC_KEYS = [
  'resource_ids',
  'resourceIds',
  'playbook_ids',
  'playbookIds',
  'library_ids',
  'libraryIds',
  'ki_ids',
  'kiIds',
  'static_resources',
  'hardcoded_resources',
];

const ID_RE = /^[a-z][a-z0-9-]*$/;
const BINDING_RE = /^\$\{inputs\.[a-zA-Z_][a-zA-Z0-9_]*\}$/;

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export function validateSkillManifest(manifest: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, issues: [{ path: '', message: 'manifest must be an object' }] };
  }
  const m = manifest as Record<string, unknown>;

  // Forbidden static keys (recursive shallow scan, top-level only — Phase 1).
  for (const key of FORBIDDEN_STATIC_KEYS) {
    if (key in m) {
      issues.push({
        path: key,
        message: `forbidden static-library key "${key}" — skills must use a dynamic retrieval plan`,
      });
    }
  }

  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) {
    issues.push({ path: 'id', message: 'id must be a kebab-case slug' });
  }
  if (typeof m.label !== 'string' || m.label.trim().length === 0) {
    issues.push({ path: 'label', message: 'label is required' });
  }
  if (typeof m.description !== 'string' || m.description.trim().length === 0) {
    issues.push({ path: 'description', message: 'description is required' });
  }
  if (m.version !== '1') {
    issues.push({ path: 'version', message: 'version must be "1" in Phase 1' });
  }
  if (typeof m.behaviorIntent !== 'string' || !VALID_INTENTS.has(m.behaviorIntent as SkillBehaviorIntent)) {
    issues.push({ path: 'behaviorIntent', message: 'behaviorIntent must be a known Strategy intent' });
  }
  if (typeof m.workspace !== 'string' || !VALID_WORKSPACES.has(m.workspace as SkillWorkspace)) {
    issues.push({ path: 'workspace', message: 'workspace must be a known WorkspaceKey' });
  }
  if (typeof m.depth !== 'string' || !VALID_DEPTHS.has(m.depth as SkillDepth)) {
    issues.push({ path: 'depth', message: 'depth must be quick|standard|deep|artifact' });
  }
  if (typeof m.sourceMode !== 'string' || !VALID_SOURCE_MODES.has(m.sourceMode as SkillSourceMode)) {
    issues.push({ path: 'sourceMode', message: 'sourceMode must be a known LibraryUse posture' });
  }

  // Retrieval plan — the load-bearing check.
  const retrieval = m.retrieval as Record<string, unknown> | undefined;
  if (!retrieval || typeof retrieval !== 'object') {
    issues.push({ path: 'retrieval', message: 'retrieval plan is required' });
  } else {
    const scopes = retrieval.scopes;
    if (!Array.isArray(scopes) || scopes.length === 0) {
      issues.push({ path: 'retrieval.scopes', message: 'at least one scope required' });
    }
    const bindings = retrieval.termBindings;
    if (!Array.isArray(bindings) || bindings.length === 0) {
      issues.push({ path: 'retrieval.termBindings', message: 'at least one term binding required' });
    } else {
      bindings.forEach((b, i) => {
        if (typeof b !== 'string' || !BINDING_RE.test(b)) {
          issues.push({
            path: `retrieval.termBindings[${i}]`,
            message: `term binding must match \${inputs.<name>} — got "${String(b)}"`,
          });
        }
      });
    }
    for (const forbidden of FORBIDDEN_STATIC_KEYS) {
      if (forbidden in retrieval) {
        issues.push({
          path: `retrieval.${forbidden}`,
          message: `forbidden static-library key inside retrieval plan`,
        });
      }
    }
  }

  // Output contract.
  const output = m.output as Record<string, unknown> | undefined;
  if (!output || typeof output !== 'object') {
    issues.push({ path: 'output', message: 'output contract is required' });
  } else if (!['prose', 'list', 'structured_artifact'].includes(output.shape as string)) {
    issues.push({ path: 'output.shape', message: 'output.shape must be prose|list|structured_artifact' });
  }

  // Rubric.
  const rubric = m.rubric as Record<string, unknown> | undefined;
  if (!rubric || typeof rubric !== 'object') {
    issues.push({ path: 'rubric', message: 'rubric is required' });
  } else {
    if (!Array.isArray(rubric.mustHave) || (rubric.mustHave as unknown[]).length === 0) {
      issues.push({ path: 'rubric.mustHave', message: 'at least one mustHave required' });
    }
    if (!Array.isArray(rubric.genericMarkers) || (rubric.genericMarkers as unknown[]).length === 0) {
      issues.push({ path: 'rubric.genericMarkers', message: 'at least one genericMarker required' });
    }
    if (typeof rubric.maxGenericMarkers !== 'number' || (rubric.maxGenericMarkers as number) < 0) {
      issues.push({ path: 'rubric.maxGenericMarkers', message: 'maxGenericMarkers must be >= 0' });
    }
  }

  return { ok: issues.length === 0, issues };
}

export function validateAllManifests(manifests: ReadonlyArray<SkillManifest>): ValidationResult {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const m of manifests) {
    const r = validateSkillManifest(m);
    for (const i of r.issues) {
      issues.push({ path: `${m?.id ?? '?'}.${i.path}`, message: i.message });
    }
    if (m?.id) {
      if (seen.has(m.id)) {
        issues.push({ path: m.id, message: 'duplicate skill id' });
      }
      seen.add(m.id);
    }
  }
  return { ok: issues.length === 0, issues };
}
