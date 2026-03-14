import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App.tsx";
import "./index.css";

console.log('[main] App module loaded successfully');

try {
  createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
  console.log('[main] React root mounted');
} catch (err) {
  console.error('[main] Fatal render error:', err);
  document.getElementById("root")!.innerHTML = `
    <div style="color:white;padding:24px;font-family:sans-serif;">
      <h1>App failed to load</h1>
      <pre style="font-size:12px;white-space:pre-wrap;">${err}</pre>
    </div>
  `;
}
