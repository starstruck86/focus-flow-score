/**
 * DEV-ONLY: Scans the DOM for common safe-area violations.
 * Logs warnings to console — never blocks builds or throws.
 *
 * Checked patterns:
 *  1. Elements with `min-h-screen` that lack safe-area top padding
 *  2. Page-level `sticky top-0` without safe-area offset
 *
 * Run once after initial render (e.g. in main.tsx via setTimeout).
 */
export function runSafeAreaDevAudit() {
  if (import.meta.env.PROD) return;

  const schedule = typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 200);
  schedule(() => {
    // 1. min-h-screen without safe-area
    document.querySelectorAll('[class*="min-h-screen"]').forEach((el) => {
      const cls = el.className;
      const hasSafeArea =
        cls.includes('safe-area-inset-top') ||
        cls.includes('SafePage') ||
        el.closest('[class*="safe-area-inset-top"]');
      if (!hasSafeArea) {
        console.warn(
          '[safe-area-audit] min-h-screen without safe-area padding detected:',
          el,
        );
      }
    });

    // 2. sticky top-0 at page level (not inside a scroll container)
    document.querySelectorAll('.sticky.top-0').forEach((el) => {
      const parent = el.parentElement;
      const isInsideScroll =
        parent &&
        (parent.scrollHeight > parent.clientHeight ||
          getComputedStyle(parent).overflow !== 'visible');
      if (!isInsideScroll) {
        console.warn(
          '[safe-area-audit] sticky top-0 without safe-area offset (possibly page-level):',
          el,
        );
      }
    });
  }) ?? setTimeout(() => runSafeAreaDevAudit(), 2000);
}
