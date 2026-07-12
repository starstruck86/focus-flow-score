## Read-only production control-plane audit — feasibility plan

Before executing, I need to flag hard tool-surface limits so the deliverable isn't misrepresented. This is a **feasibility assessment**, not the audit itself.

### What the available tool surface CAN retrieve (read-only)

1. **`version` function runtime attestation** — via `supabase--curl_edge_functions GET /version`. Returns: `release_id`, `source_commit`, `deployment_id`, `region`, `proof_scope`, `verified`. This is the only production-surface evidence of a deployed bundle available to me.
2. **Edge function logs** — via `supabase--edge_function_logs` (per function slug). Confirms the function is live and serving; does not expose bundle contents or version numbers.
3. **Repository (GitHub main) source** — I can read the working tree at the current synced HEAD (`447c00f6…`) and compute SHA-256 per file + a deterministic tree digest.
4. **Supabase project metadata** — `supabase--project_info` (project-level only, not function-version metadata).

### What the tool surface CANNOT retrieve

The audit asks for items only the Supabase Management API exposes, and I do not have a tool that calls it:

- **Function version number, deployment ID (for `strategy-chat` / `analyze-call` / `mcp`), created/updated timestamps, region, `verify_jwt` setting** — no tool exposes `GET /v1/projects/{ref}/functions/{slug}`. Only the `version` function self-reports its own `deployment_id` via its response body (by design — that's the whole point of that function).
- **Deployed file-path list per function** — the Management API's function-body endpoint returns the bundled entrypoint, not a multi-file listing with per-file digests. There is no tool wired to that endpoint in this environment.
- **Per-file SHA-256 of deployed sources** — same reason; not retrievable.
- **Deterministic tree digest of the deployed bundle** — cannot be computed without (b) and (c).
- **Unified diff deployed-vs-repo** — cannot be produced without the deployed source tree.

Consequence: item 6 (drift detection) cannot be answered from the deployed side except for `version`, where the `release_id`/`source_commit` in its runtime response can be compared to `supabase/functions/_shared/release.json` at commit `447c00f6…`. For `strategy-chat`, `analyze-call`, and `mcp` there is **no bundle-level ground truth accessible to me** — only "the function responds" and "logs show recent invocations."

### Control questions A/B/C — answerable now from platform knowledge

- **A. External `SUPABASE_ACCESS_TOKEN` deploying to a Lovable-managed project:** A user-scoped PAT minted from the Supabase dashboard (Account → Access Tokens) plus `supabase functions deploy --project-ref <ref>` will technically deploy if the token belongs to a member of the org owning the project. For Lovable-managed projects the org is owned by Lovable; the end user does not have a Supabase dashboard login on that org, so they cannot mint such a token themselves. It is possible only if Lovable adds the user (or a service account) to the underlying org as a member — which is not a self-serve setting.
- **B. Disabling Lovable's own deploy path:** There is no user-exposed toggle to revoke Lovable's ability to deploy edge functions to a Lovable-managed project. The Lovable agent uses privileged internal credentials against the same Supabase project; those credentials are not gated by any tenant-visible setting.
- **C. Exact control / current setting:** None exists. A true CI deployment monopoly is **not achievable** while the project remains Lovable-managed. It becomes achievable only by migrating to a user-owned Supabase project (the migration path previously assessed), at which point the user controls org membership and can restrict deploy tokens.

### Proposed deliverable (given the above)

I will produce a report with three clearly-labeled sections:

1. **Deployed-side evidence (Management plane / runtime):**
   - `version`: full runtime attestation JSON + comparison to `release.json` at `447c00f6…`.
   - `strategy-chat`, `analyze-call`, `mcp`: liveness + recent-log evidence only. Explicitly state "function-version number, deployment ID, verify_jwt, region, file-path list, per-file digests, tree digest: **not retrievable via available tool surface**."
2. **Repository-side evidence (GitHub main `447c00f6…`):**
   - Per-function file-path list, per-file SHA-256, deterministic tree digest (sorted path + digest pairs, SHA-256 of the concatenation).
3. **Drift assessment:**
   - `version`: computable (release_id/source_commit match check).
   - Other three: **not computable** with current tools; explicitly stated, not guessed.
4. **Control questions A/B/C:** answered as above.

### Question for you before I proceed

This is a research/audit task, not an implementation task, so plan mode is technically the wrong lane — but I also want to confirm the scope before switching to build mode and burning tool calls:

**Do you accept the deliverable as scoped above** (i.e., `version` gets a real deployed-vs-repo drift check; the other three get liveness + repo-side digests only, with an explicit "management-plane bundle retrieval not available" statement), **or do you want me to stop and escalate that the audit as literally specified is unsatisfiable with the current tool surface?**

If you accept the scoped deliverable, approve this plan and I'll execute the read-only calls in build mode and return the report.
