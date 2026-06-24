No code changes — read-only diagnostic answer.

**Most recent `[v2-flag]` line from `strategy-chat` logs:**

`[v2-flag] env_present=true env_len=17 enabled=false` @ 2026-06-24T13:29:45.913Z

- **enabled = false** → V1 mode-lock path is live. V2 reasoning is OFF.
- **env_present = true**, **env_len = 17** → the `STRATEGY_V2_REASONING` secret IS set, value is 17 chars. None of the accepted truthy tokens (`true`/`1`/`on`/`yes`) are 17 chars, so the value is something non-truthy (e.g. `false`, `disabled`, a descriptive string). `isV2Enabled()` is reading it correctly and evaluating to OFF.

Same invocation corroborates V1: `path:"v1"`, `mode=general`, `routing=mode_general_freeform_openai_precision`, `task:"chat_general"` → gpt-4o via V1 chat path (not the V2 orchestrator).

**To enable V2 (when you want to):** set the `STRATEGY_V2_REASONING` secret value to exactly `true` (or `1` / `on` / `yes`). No code edit required — wiring is already in place.

Tell me whether you want to (a) flip the flag to `true`, (b) inspect/log the actual secret value for confirmation, or (c) take no action.