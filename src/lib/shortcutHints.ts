// Shortcut coaching — static map of destination → one-line hint.
// Trigger: user reaches this destination ≥3 times in the last 14 days WITHOUT
// coming from an oneHopSources path. Show once, then never again.
export type ShortcutHint = {
  /** Stable key persisted to user_settings.shown_hints */
  key: string;
  /** Route path that triggers the hint on arrival */
  destination: string;
  /** One-line coaching copy */
  copy: string;
  /**
   * Routes that qualify as an easy one-hop entry to the destination.
   * Arrivals whose from_path matches (prefix) any of these DO NOT count
   * toward the trigger threshold.
   * Direct/PWA entries (from_path null or '/') are also treated as one-hop.
   */
  oneHopSources: string[];
};

export const SHORTCUT_HINTS: ShortcutHint[] = [
  {
    key: 'car-mode-longpress-v1',
    destination: '/car-mode',
    copy: 'Long-press the Dynamic icon on your home screen to jump straight to Car Mode.',
    oneHopSources: [],
  },
  {
    key: 'grade-voice-gamefilm-v1',
    destination: '/grade',
    copy: "Say 'game film' to Dave to jump here.",
    oneHopSources: [],
  },
  {
    key: 'quota-strip-tap-v1',
    destination: '/quota',
    copy: 'The quota strip on Desk taps through to here.',
    oneHopSources: ['/work'],
  },
  {
    key: 'gates-in-train-skills-v1',
    destination: '/gates',
    copy: 'Gates live in Train → Skills.',
    oneHopSources: ['/train-hub', '/train'],
  },
];

export function findHintForPath(path: string): ShortcutHint | undefined {
  return SHORTCUT_HINTS.find(h => h.destination === path);
}

export function isOneHop(fromPath: string | null | undefined, hint: ShortcutHint): boolean {
  if (!fromPath || fromPath === '/') return true;
  return hint.oneHopSources.some(src => fromPath === src || fromPath.startsWith(src + '/'));
}
