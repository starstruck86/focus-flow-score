/**
 * Session Durability — Local persistence for in-progress Dojo & Learn sessions.
 *
 * Saves state after every meaningful transition so nothing is lost
 * on refresh, tab close, or network drop.
 *
 * Uses localStorage with simple JSON. No heavy architecture.
 */

const DOJO_KEY = 'qc_dojo_session_state';
const LEARN_KEY = 'qc_learn_session_state';
const WRITE_QUEUE_KEY = 'qc_pending_writes';
const LANE_KEY = 'qc_active_lane';

// ── Active practice lane ───────────────────────────────────────────

export interface ActiveLane {
  anchor: string;           // e.g. 'opening_cold_call'
  label: string;            // e.g. 'Cold Calling'
  skillFocus: string;       // primary skill being tracked
  repsThisSession: number;  // how many reps completed in this continuous session
  recentScores: number[];   // last N scores in this lane (max 10)
  startedAt: number;
  lastRepAt: number;
  focusPattern?: string;    // current sub-skill target
  subSkillTarget?: string;  // human-readable sub-skill name
}

export function saveActiveLane(lane: ActiveLane): void {
  try {
    localStorage.setItem(LANE_KEY, JSON.stringify({ ...lane, lastRepAt: Date.now() }));
  } catch { /* noop */ }
}

export function loadActiveLane(): ActiveLane | null {
  try {
    const raw = localStorage.getItem(LANE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveLane;
    // Expire after 4 hours of inactivity
    if (Date.now() - parsed.lastRepAt > 4 * 60 * 60 * 1000) {
      clearActiveLane();
      return null;
    }
    return parsed;
  } catch {
    clearActiveLane();
    return null;
  }
}

export function clearActiveLane(): void {
  try { localStorage.removeItem(LANE_KEY); } catch { /* noop */ }
}

export function updateLaneAfterRep(score: number): ActiveLane | null {
  const lane = loadActiveLane();
  if (!lane) return null;
  lane.repsThisSession++;
  lane.recentScores = [score, ...lane.recentScores].slice(0, 10);
  lane.lastRepAt = Date.now();
  saveActiveLane(lane);
  return lane;
}

// ── Dojo session state ─────────────────────────────────────────

export interface DojoLocalState {
  sessionId: string; // client-generated before DB write
  scenario: {
    title: string;
    skillFocus: string;
    context: string;
    objection: string;
  };
  phase: string;
  transcribedText: string;
  retryCount: number;
  lastScore: number | null;
  lastFeedback: string | null;
  sessionType: string;
  mode: string;
  savedAt: number;
  dbSessionId: string | null; // set after successful DB write
}

export function saveDojoState(state: DojoLocalState): void {
  try {
    localStorage.setItem(DOJO_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch { /* full or unavailable */ }
}

export function loadDojoState(): DojoLocalState | null {
  try {
    const raw = localStorage.getItem(DOJO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DojoLocalState;
    // Expire after 2 hours
    if (Date.now() - parsed.savedAt > 2 * 60 * 60 * 1000) {
      clearDojoState();
      return null;
    }
    return parsed;
  } catch {
    clearDojoState();
    return null;
  }
}

export function clearDojoState(): void {
  try { localStorage.removeItem(DOJO_KEY); } catch { /* noop */ }
}

// ── Learn session state ────────────────────────────────────────

export interface LearnLocalState {
  lessonId: string;
  currentSectionIndex: number;
  phase: string; // teaching, waiting_mc, waiting_open, grading, handoff, complete
  mcAnswers: Record<string, string>;
  mcScore: number;
  openAnswer: string;
  completedSectionIds: string[];
  savedAt: number;
}

export function saveLearnState(state: LearnLocalState): void {
  try {
    localStorage.setItem(LEARN_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch { /* full or unavailable */ }
}

export function loadLearnState(): LearnLocalState | null {
  try {
    const raw = localStorage.getItem(LEARN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LearnLocalState;
    if (Date.now() - parsed.savedAt > 2 * 60 * 60 * 1000) {
      clearLearnState();
      return null;
    }
    return parsed;
  } catch {
    clearLearnState();
    return null;
  }
}

export function clearLearnState(): void {
  try { localStorage.removeItem(LEARN_KEY); } catch { /* noop */ }
}

// ── Pending write queue (idempotent) ───────────────────────────

export interface PendingWrite {
  turnId: string; // client-generated UUID — ensures idempotency
  table: string;
  action: 'insert' | 'update';
  data: Record<string, any>;
  timestamp: number;
  retries: number;
}

export function getPendingWrites(): PendingWrite[] {
  try {
    return JSON.parse(localStorage.getItem(WRITE_QUEUE_KEY) || '[]');
  } catch { return []; }
}

function savePendingWrites(writes: PendingWrite[]): void {
  try {
    localStorage.setItem(WRITE_QUEUE_KEY, JSON.stringify(writes));
  } catch { /* noop */ }
}

export function enqueuePendingWrite(write: Omit<PendingWrite, 'timestamp' | 'retries'>): void {
  const writes = getPendingWrites();
  // Idempotency: skip if turnId already queued
  if (writes.some(w => w.turnId === write.turnId)) return;
  writes.push({ ...write, timestamp: Date.now(), retries: 0 });
  savePendingWrites(writes);
}

export function removePendingWrite(turnId: string): void {
  const writes = getPendingWrites().filter(w => w.turnId !== turnId);
  savePendingWrites(writes);
}

export function incrementWriteRetry(turnId: string): void {
  const writes = getPendingWrites().map(w =>
    w.turnId === turnId ? { ...w, retries: w.retries + 1 } : w
  ).filter(w => w.retries < 20); // drop only after 20 retries (generous for long offline)
  savePendingWrites(writes);
}

// ── Resume check ───────────────────────────────────────────────

export interface ResumeInfo {
  type: 'dojo' | 'learn' | 'lane';
  label: string;
  path: string;
  state?: Record<string, any>;
  lane?: ActiveLane;
}

export function checkForResumableSessions(): ResumeInfo | null {
  const dojo = loadDojoState();
  if (dojo && dojo.phase !== 'complete') {
    return {
      type: 'dojo',
      label: `Dojo: ${dojo.scenario.title}`,
      path: '/dojo/session',
      state: {
        scenario: dojo.scenario,
        skillFocus: dojo.scenario.skillFocus,
        mode: dojo.mode,
        sessionType: dojo.sessionType,
        resuming: true,
      },
    };
  }

  // Check for active lane (user was drilling continuously and left)
  const lane = loadActiveLane();
  if (lane && lane.repsThisSession > 0) {
    return {
      type: 'lane',
      label: `Continue ${lane.label} (${lane.repsThisSession} reps, avg ${lane.recentScores.length > 0 ? Math.round(lane.recentScores.reduce((a, b) => a + b, 0) / lane.recentScores.length) : '—'})`,
      path: '/dojo',
      lane,
    };
  }

  const learn = loadLearnState();
  if (learn && learn.phase !== 'complete') {
    return {
      type: 'learn',
      label: 'In-progress lesson',
      path: `/learn/${learn.lessonId}`,
      state: { resuming: true },
    };
  }

  return null;
}

export function hasPendingWrites(): boolean {
  return getPendingWrites().length > 0;
}
