## Read-only investigation result

**Deployed-function list API:** not available in this session's toolset (only deploy/delete/logs/curl exist). Reported source ↔ `function_configs` comparison instead.

- Source functions (`supabase/functions/`, excl. `_shared`): **118**
- `public.function_configs` rows: **62**
- Match: **No** — configs is a strict subset; 56 source functions have no config row, 0 config rows lack source.

No code changes proposed. Next-step options if you want to close the gap:
1. Provide `supabase functions list` output (or a Management API token) so I can diff against truly-deployed set, not source.
2. Author a migration adding `function_configs` rows for the 56 missing functions (requires model/provider decisions per function).
3. Leave as-is (configs intentionally scoped to AI-model-routed functions only).

Awaiting your direction on which, if any, to pursue.