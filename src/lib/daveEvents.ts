// Centralized Dave event dispatching for DB→UI sync

/** Dispatch after Dave updates daily_journal_entries metrics */
export function emitMetricsUpdated(detail?: Record<string, any>) {
  window.dispatchEvent(new CustomEvent('dave-metrics-updated', { detail }));
}

/** Dispatch after Dave mutates a CRM table (accounts, tasks, etc.) */
export function emitDataChanged(table: string) {
  window.dispatchEvent(new CustomEvent('dave-data-changed', { detail: { table } }));
}
