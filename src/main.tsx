import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initCrashSentinel } from "./lib/crashSentinel";
import App from "./App.tsx";
import "./index.css";

// Initialize crash sentinel BEFORE React renders
initCrashSentinel();

console.log('[main] App module loaded successfully');

function renderFatalFallback(err: unknown) {
  const root = document.getElementById("root");
  if (!root) return;
  // Safe text-only fallback — no innerHTML with dynamic content
  root.textContent = '';
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'color:white;padding:24px;font-family:sans-serif;';
  const h1 = document.createElement('h1');
  h1.textContent = 'App failed to load';
  const pre = document.createElement('pre');
  pre.style.cssText = 'font-size:12px;white-space:pre-wrap;margin-top:12px;';
  pre.textContent = err instanceof Error ? err.message : String(err);
  const btn = document.createElement('button');
  btn.textContent = 'Reload';
  btn.style.cssText = 'margin-top:16px;padding:8px 16px;border-radius:6px;background:#3b82f6;color:white;border:none;cursor:pointer;';
  btn.onclick = () => window.location.reload();
  wrapper.appendChild(h1);
  wrapper.appendChild(pre);
  wrapper.appendChild(btn);
  root.appendChild(wrapper);
}

try {
  createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
  console.log('[main] React root mounted');
  // DEV-ONLY: audit for safe-area violations after first paint
  if (import.meta.env.DEV) {
    import('./lib/safeAreaDevWarning').then(m => setTimeout(m.runSafeAreaDevAudit, 3000));
  }
} catch (err) {
  console.error('[main] Fatal render error:', err);
  renderFatalFallback(err);
}
