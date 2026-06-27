/**
 * pwa-register — install the auto-updating service worker.
 *
 * Strategy: vite-plugin-pwa is configured with registerType: 'autoUpdate' plus
 * skipWaiting + clientsClaim, so a new SW takes control as soon as the page
 * loads. We additionally:
 *   - poll for updates on load and every 60s
 *   - when a new SW is waiting, call updateSW(true) which activates it and
 *     reloads the page exactly once. This guarantees a normal reload after a
 *     deploy always serves the latest build (no Private tab / clear cache).
 *
 * In dev or inside the Lovable editor preview iframe we skip registration to
 * avoid stale-cache headaches in tooling.
 */

const isPreviewHost = () => {
  try {
    const host = window.location.hostname;
    return (
      host.startsWith('id-preview--') ||
      host.startsWith('preview--') ||
      host.endsWith('.lovableproject.com') ||
      host === 'lovableproject.com' ||
      host.endsWith('.lovableproject-dev.com') ||
      host === 'lovableproject-dev.com'
    );
  } catch {
    return false;
  }
};

export async function registerPwa() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;
  if (window.self !== window.top) return; // skip in any iframe (Lovable preview)
  if (isPreviewHost()) return;

  try {
    const { registerSW } = await import('virtual:pwa-register');
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        // New build available — activate it and reload once.
        updateSW(true);
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        // Poll for updates every 60 seconds while the tab is open.
        setInterval(() => {
          registration.update().catch(() => {});
        }, 60_000);
      },
    });
  } catch (err) {
    console.warn('[pwa] registration failed:', err);
  }
}
