/**
 * threadCleanup — shared heuristic for "junk" threads that should be hidden
 * from default views (Work command center, sidebar rail, per-surface fallbacks).
 *
 * Only the "Needs Cleanup" filter in the Work command center should ever
 * surface these. Anything else MUST call `isCleanupThread` and skip them by
 * default — otherwise debug/regression/benchmark threads pollute the OS view.
 */
import type { StrategyThread } from '@/types/strategy';
import { isUntitledTitle } from './threadNaming';

/** True when the thread looks like test/debug/regression/benchmark/scratch junk. */
export function isCleanupThread(t: StrategyThread): boolean {
  const raw = t.title || '';
  const title = raw.toLowerCase();
  // Bracketed diagnostic / debug / canary tags at the start of the title.
  if (/^\[(diagnostic|debug|test|qa|canary|regression|benchmark|wip|scratch|tmp|temp)\]/i.test(raw)) return true;
  // Common dev prefixes: p<digits>- / phase<digits>- / debug- etc.
  if (/^(p\d+[-_]|phase\d+[-_]|test[-_]|debug[-_]|qa[-_]|canary[-_]|regression[-_]|benchmark[-_]|scratch[-_]|wip[-_])/i.test(title)) return true;
  // Substring match for clear junk markers — looser than \b...\b so things
  // like "p26-testB" / "regression-A" / "debugRun" all get hidden.
  if (/(test|debug|regression|benchmark|scratch|sandbox|wip)/i.test(title)) return true;
  // Untitled-style placeholders that never got a real prompt.
  if (isUntitledTitle(t.title)) return true;
  return false;
}
