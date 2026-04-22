/**
 * Cycle 1 Canary Result Parser — deterministic, client-side, order-independent.
 *
 * Header detection scans the entire input, locates every known section header
 * regardless of order, then slices each section's body using the next header
 * (by position) as the delimiter. No LLM. Never throws.
 */
import type {
  ParsedCanary,
  ParsedStep,
  SqlBlock,
  LaneMix,
  FlagState,
} from './types';

type SectionKey =
  | 'STEPS'
  | 'DUPLICATES_SQL'
  | 'FAILURES_SQL'
  | 'LANE_MIX_SQL'
  | 'OBSERVATIONS'
  | 'FLAG_STATE';

interface HeaderHit {
  key: SectionKey;
  /** index where the header *line* starts */
  start: number;
  /** index where the body begins (right after the header line) */
  bodyStart: number;
}

/**
 * Header patterns. Each pattern matches at start-of-line and consumes the
 * rest of that line (so FLAG STATE can carry its value inline). Order-
 * independent: we scan globally and sort hits by position later.
 */
const HEADER_PATTERNS: Array<{ key: SectionKey; re: RegExp }> = [
  { key: 'STEPS',          re: /^[ \t]*STEPS[ \t]*:[ \t]*$/gim },
  { key: 'DUPLICATES_SQL', re: /^[ \t]*DUPLICATES[ \t]+SQL[ \t]*:[ \t]*$/gim },
  { key: 'FAILURES_SQL',   re: /^[ \t]*FAILURES[ \t]+SQL[ \t]*:[ \t]*$/gim },
  { key: 'LANE_MIX_SQL',   re: /^[ \t]*LANE[ \t]+MIX[ \t]+SQL[ \t]*:[ \t]*$/gim },
  { key: 'OBSERVATIONS',   re: /^[ \t]*OBSERVATIONS[ \t]*:[ \t]*$/gim },
  // FLAG STATE may carry its value on the same line; capture the whole line.
  { key: 'FLAG_STATE',     re: /^[ \t]*FLAG[ \t]+STATE[ \t]*:?.*$/gim },
];

const SECTION_DISPLAY: Record<SectionKey, string> = {
  STEPS: 'STEPS',
  DUPLICATES_SQL: 'DUPLICATES SQL',
  FAILURES_SQL: 'FAILURES SQL',
  LANE_MIX_SQL: 'LANE MIX SQL',
  OBSERVATIONS: 'OBSERVATIONS',
  FLAG_STATE: 'FLAG STATE',
};

/** Locate every header anywhere in the input. */
function findHeaders(input: string): HeaderHit[] {
  const hits: HeaderHit[] = [];
  for (const { key, re } of HEADER_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      const start = m.index;
      // bodyStart is end of the matched header line (skip past the newline)
      const lineEnd = input.indexOf('\n', m.index + m[0].length);
      const bodyStart = lineEnd === -1 ? input.length : lineEnd + 1;
      hits.push({ key, start, bodyStart });
      // Re-anchor lastIndex so global search keeps moving forward.
      if (re.lastIndex === m.index) re.lastIndex += 1;
    }
  }
  // Sort by file position so we can slice bodies between consecutive hits.
  hits.sort((a, b) => a.start - b.start);
  return hits;
}

/**
 * Build a map of section -> body. If a section appears multiple times, the
 * first occurrence wins (operator template should not repeat sections).
 */
function sliceSections(input: string, hits: HeaderHit[]): Partial<Record<SectionKey, string>> {
  const out: Partial<Record<SectionKey, string>> = {};
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i];
    const next = hits[i + 1];
    const end = next ? next.start : input.length;
    let body: string;
    if (cur.key === 'FLAG_STATE') {
      // FLAG STATE keeps its inline content too — slice from header start
      // through the next header so we don't lose the value.
      body = input.slice(cur.start, end);
    } else {
      body = input.slice(cur.bodyStart, end);
    }
    if (out[cur.key] === undefined) out[cur.key] = body;
  }
  return out;
}

const STEP_LINE_RE = /^\s*([1-8])\s*:\s*(pass|fail)\b\s*[\(\-–—:]?\s*(.*?)\s*\)?\s*$/i;

function parseSteps(body: string | undefined, warnings: string[]): ParsedStep[] {
  if (body === undefined) return [];
  const seen = new Set<number>();
  const steps: ParsedStep[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = STEP_LINE_RE.exec(line);
    if (!m) {
      warnings.push(`Unparseable step line: "${line}"`);
      continue;
    }
    const n = parseInt(m[1], 10);
    if (seen.has(n)) continue;
    seen.add(n);
    const status = m[2].toLowerCase() === 'pass' ? 'pass' : 'fail';
    const note = (m[3] ?? '').trim() || null;
    steps.push({ n, status, note });
  }
  steps.sort((a, b) => a.n - b.n);
  return steps;
}

const LANE_COMBINED_RE =
  /direct\s*=\s*(\d+)[\s,;]*assisted\s*=\s*(\d+)[\s,;]*deep_work\s*=\s*(\d+)/i;
const LANE_SINGLE_RE = /(direct|assisted|deep_work)\s*=\s*(\d+)/gi;

function parseLaneMix(body: string | undefined, warnings: string[]): LaneMix | null {
  if (body === undefined) return null;
  const m = LANE_COMBINED_RE.exec(body);
  if (m) {
    return {
      direct: parseInt(m[1], 10),
      assisted: parseInt(m[2], 10),
      deep_work: parseInt(m[3], 10),
    };
  }
  // Order-tolerant fallback.
  const found: Partial<LaneMix> = {};
  let hit: RegExpExecArray | null;
  LANE_SINGLE_RE.lastIndex = 0;
  while ((hit = LANE_SINGLE_RE.exec(body)) !== null) {
    const key = hit[1].toLowerCase() as keyof LaneMix;
    found[key] = parseInt(hit[2], 10);
  }
  if (
    typeof found.direct === 'number' &&
    typeof found.assisted === 'number' &&
    typeof found.deep_work === 'number'
  ) {
    return found as LaneMix;
  }
  warnings.push('Lane mix could not be parsed');
  return null;
}

const EMPTY_BODY_RE = /^(empty|none|no rows?|0 rows?|—|-)?$/i;

function parseSqlBlock(body: string | undefined): SqlBlock {
  if (body === undefined) return { empty: false, raw: null };
  const trimmed = body.trim();
  if (trimmed.length === 0 || EMPTY_BODY_RE.test(trimmed)) {
    return { empty: true, raw: trimmed.length === 0 ? null : trimmed };
  }
  return { empty: false, raw: trimmed };
}

const FLAG_RE = /ROUTER_AUTO_PROMOTE\s*=\s*(0|1)\b/i;

function parseFlagState(body: string | undefined, warnings: string[]): FlagState {
  if (body === undefined) {
    warnings.push('Section "FLAG STATE" not found');
    return { auto_promote: null };
  }
  const m = FLAG_RE.exec(body);
  if (!m) {
    warnings.push('FLAG STATE present but ROUTER_AUTO_PROMOTE not parseable');
    return { auto_promote: null };
  }
  return { auto_promote: m[1] === '1' ? 1 : 0 };
}

function parseObservations(body: string | undefined): string | null {
  if (body === undefined) return null;
  const t = body.trim();
  return t.length > 0 ? t : null;
}

/**
 * Main entry. Never throws. Always returns a ParsedCanary, with any issues
 * surfaced via parse_warnings.
 */
export function parseCanaryResults(input: string): ParsedCanary {
  const warnings: string[] = [];
  const safeInput = typeof input === 'string' ? input : '';
  const hits = findHeaders(safeInput);
  const sections = sliceSections(safeInput, hits);

  // Emit warnings for missing sections (FLAG_STATE warning is emitted inside
  // parseFlagState so we don't double-warn).
  const requiredSections: SectionKey[] = [
    'STEPS',
    'DUPLICATES_SQL',
    'FAILURES_SQL',
    'LANE_MIX_SQL',
    'OBSERVATIONS',
  ];
  for (const key of requiredSections) {
    if (sections[key] === undefined) {
      warnings.push(`Section "${SECTION_DISPLAY[key]}" not found`);
    }
  }

  const steps = safeRun(() => parseSteps(sections.STEPS, warnings), warnings, 'STEPS', []);
  const duplicates = safeRun(
    () => parseSqlBlock(sections.DUPLICATES_SQL),
    warnings,
    'DUPLICATES SQL',
    { empty: false, raw: null } as SqlBlock,
  );
  const failures = safeRun(
    () => parseSqlBlock(sections.FAILURES_SQL),
    warnings,
    'FAILURES SQL',
    { empty: false, raw: null } as SqlBlock,
  );
  const lane_mix = safeRun(
    () => parseLaneMix(sections.LANE_MIX_SQL, warnings),
    warnings,
    'LANE MIX SQL',
    null,
  );
  const observations = safeRun(
    () => parseObservations(sections.OBSERVATIONS),
    warnings,
    'OBSERVATIONS',
    null,
  );
  const flag_state = safeRun(
    () => parseFlagState(sections.FLAG_STATE, warnings),
    warnings,
    'FLAG STATE',
    { auto_promote: null } as FlagState,
  );

  return {
    steps,
    duplicates,
    failures,
    lane_mix,
    observations,
    flag_state,
    parse_warnings: warnings,
  };
}

function safeRun<T>(fn: () => T, warnings: string[], label: string, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    warnings.push(`Failed to parse ${label}: ${(e as Error)?.message ?? 'unknown error'}`);
    return fallback;
  }
}
