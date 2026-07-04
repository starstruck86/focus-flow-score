/**
 * Theme layer — swappable engagement-layer skin.
 *
 * Employer-independence rule: the visual theme is DATA, not identity.
 * Swap themes by changing this ONE line. All components consume CSS
 * variables defined per `data-theme` selector in src/index.css.
 *
 * Themes:
 *   • 'branch'     — Branch.io official 2026 palette (ACTIVE)
 *   • 'instrument' — the prior "Instrument" dark palette, preserved verbatim
 */
export type ThemeName = 'branch' | 'instrument';

/** Single source of truth for the active theme. */
export const ACTIVE_THEME: ThemeName = 'branch';

/** Applies the active theme to <html data-theme="..."> on boot. */
export function initTheme(theme: ThemeName = ACTIVE_THEME): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}
