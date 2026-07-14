# Repository-local runtime migration inventory

Scope: static repository inspection only on 2026-07-14. No remote Supabase/Lovable system, database, secret store, production endpoint, or data was queried or changed. Secret values are intentionally omitted. Repository paths and line numbers are the evidence boundary.

## Executive findings

- There are 120 deployable Edge Function directories plus supabase/functions/_shared. Every deployable directory has index.ts.
- supabase/config.toml records verify_jwt=true for 5 functions and false for 37. Three named sections omit verify_jwt, and 75 directories have no function section. Thus 78 functions have no explicit repository JWT boolean; the effective deployed setting is not repository-provable and must be captured/recreated explicitly.
- The existing docs/phase2-function-inventory.json is stale: it says generated 2026-04-11 and contains 75 functions (lines 3, 12, 636), versus 120 current directories.
- The tracked supabase/dynamic_staging_schema.sql is a generated/derived schema snapshot, not a chronological migration. It contains nine pg_cron schedules plus hardcoded project URLs and credential-like literals. Values are not reproduced here. It must never be treated as an executable restore plan or secret source.
- SQL migrations enable pg_cron/pg_net repeatedly, but only one current cron.schedule call (ops_sentinel_v1) is present in chronological migrations. Most scheduled jobs exist only in the derived schema snapshot, docs, or runtime expectations.
- Auth, OAuth client/provider configuration, SMTP, actual cron state/timezone/headers, n8n, deployed Edge Function versions/settings, secret values, and actual Storage contents cannot be derived from this repository.
- Git tracks .env. It contains Supabase binding names. Values were not recorded in this report; migration work should avoid copying the file blindly and should review whether tracking it is intentional.

## Edge Functions and verify_jwt

Evidence: directories under supabase/functions; settings in supabase/config.toml:1-142.

Summary:

- Explicit true (5): analyze-sentiment, car-mode-score, dave-health-check, dojo-score, drill-review.
- Explicit false (37): batch-actionize, batch-extract-kis, classify-resource, conversion-math, daily-digest, dave-conversation-token, discover-contacts, elevenlabs-stt, elevenlabs-tts-stream, enrich-account, enrich-resource-content, extract-tactics, extract-tasks, generate-time-blocks, grade-mock-call, import-podcast, import-youtube-playlist, journal-nudge, log-workday-focus, mcp, mock-call, operationalize-resource, parse-account-screenshot, parse-claude-import, parse-screenshot, pipeline-hygiene, prioritize-accounts, search-context, simulate-chat, source-icp-accounts, sync-calendar, territory-copilot, training-digest, version, weekly-battle-plan, weekly-digest, weekly-patterns.
- Section exists but verify_jwt is omitted (3): build-resource, discover-resources, suggest-resource-uses.
- No config section (75): analyze-call, analyze-deal-outcome, batch-recovery-rerun, batch-regrade-now, branch-intelligence, car-mode-audio-score, classify-signal, clean-baseline, deal-intelligence, derive-library-cards, detect-knowledge-gaps, dojo-review-score, dojo-roleplay-score, elevenlabs-transcribe, expand-prompt, explain-score, extract-scenarios, extract-strategy-memory, generate-call-goals, generate-execution-draft, generate-flashcards, generate-lesson-content, generate-playbooks, generate-stage-playbook, get-benchmark-kis, grade-lesson-response, grade-objection-drill, grade-transcript, import-circle-browserless, import-course, import-course-capture, import-webpage-links, parse-account-synopsis, parse-calendar-screenshot, parse-opp-synopsis, parse-uploaded-file, pdf-ocr, playbook-roleplay, preprocess-transcript, process-podcast-queue, reconcile-library, register-dave-tools, resolve-podcast-episode, run-catchup, run-discovery-prep, run-discovery-prep-step, run-enrichment-job, run-phase35b-validation, run-strategy-eval-synthesis, run-strategy-job, run-strategy-task, run-strategy-task-reaper, run-validation-canary, schedule-daily-plan, score-micro-drill, score-original-response, strategy-benchmark-runner, strategy-chat, strategy-clone-thread, strategy-detect-conflicts, strategy-detect-proposals, strategy-evidence-render, strategy-promote-proposal, strategy-retrieval-probe, strategy-smoke-test, strategy-stage-proposal, strategy-stress-runner, strategy-stress-test, strategy-summarize-upload, strategy-transform-output, suggest-templates, transcribe-audio, validate-enrichment, voice-command, youtube-captions.

Interpretation rule: "not set" below means exactly that the repository does not set the value. Do not silently replace it with an assumed platform default when building the migration manifest; rehearsal must resolve and explicitly record the intended effective setting.

## Imported shared modules

The following is the complete direct import map from deployable index.ts files into ../_shared. The per-function appendix repeats this at row level.

- enforcementLog.ts: batch-actionize, extract-tactics, run-enrichment-job.
- getModelConfig.ts: analyze-call, analyze-deal-outcome, analyze-sentiment, batch-extract-kis, build-resource, car-mode-audio-score, car-mode-score, classify-resource, classify-signal, clean-baseline, daily-digest, derive-library-cards, detect-knowledge-gaps, discover-contacts, discover-resources, dojo-review-score, dojo-roleplay-score, dojo-score, elevenlabs-stt, elevenlabs-transcribe, elevenlabs-tts-stream, enrich-account, expand-prompt, explain-score, extract-scenarios, extract-strategy-memory, extract-tactics, extract-tasks, generate-call-goals, generate-execution-draft, generate-flashcards, generate-lesson-content, generate-playbooks, generate-stage-playbook, grade-lesson-response, grade-mock-call, grade-objection-drill, grade-transcript, mock-call, operationalize-resource, parse-account-screenshot, parse-account-synopsis, parse-calendar-screenshot, parse-claude-import, parse-opp-synopsis, parse-screenshot, parse-uploaded-file, pdf-ocr, playbook-roleplay, preprocess-transcript, prioritize-accounts, score-micro-drill, score-original-response, simulate-chat, source-icp-accounts, suggest-resource-uses, suggest-templates, territory-copilot, transcribe-audio, voice-command, weekly-battle-plan.
- requireUser.ts: elevenlabs-stt, elevenlabs-tts-stream, enrich-account, import-podcast, import-youtube-playlist, parse-account-screenshot, parse-claude-import, parse-screenshot, simulate-chat.
- securityLog.ts: batch-actionize, batch-recovery-rerun, extract-tactics, log-workday-focus, process-podcast-queue, run-enrichment-job.
- strategy-core modules: analyze-call, strategy-chat, strategy-retrieval-probe.
- strategy-router modules: analyze-call, strategy-chat.
- strategy-orchestrator modules: derive-library-cards, run-discovery-prep, run-discovery-prep-step, run-strategy-job, run-strategy-task, run-strategy-task-reaper.
- strategy-skills modules: run-strategy-eval-synthesis, strategy-chat.
- versionResponse.ts: version.

The strategy-orchestrator and strategy-core trees import additional local modules transitively. The appendix environment column follows relative local imports recursively so these transitive configuration dependencies are included.

## Environment and secret names (names only)

Edge runtime/integration names statically found:

ANTHROPIC_API_KEY; AUTHORING_BATCH_TIMEOUT_MS; BENCHMARK_JUDGE_TIMEOUT_MS; BENCHMARK_PROVIDER_TIMEOUT_MS; BENCHMARK_RETRY_BASE_MS; BENCHMARK_RETRY_MAX; BENCHMARK_RETRY_MAX_MS; BROWSERLESS_API_KEY; CIRCLE_CRED_KEY; COURSE_PLATFORM_EMAIL; COURSE_PLATFORM_PASSWORD; CRON_SECRET; ELEVENLABS_AGENT_ID; ELEVENLABS_API_KEY; FIRECRAWL_API_KEY; FOCUS_TRACKER_API_KEY; INTERNAL_FUNCTION_SECRET; LOVABLE_API_KEY; OPENAI_API_KEY; OUTLOOK_ICS_URL; PERPLEXITY_API_KEY; SMOKE_TEST_MODE; STRATEGY_DEBUG_HARNESS; STRATEGY_DISCOVERY_PREP_SOP_ENFORCEMENT; STRATEGY_SKILLS_ENABLED; STRATEGY_TARGETED_REMEDIATION; STRATEGY_V2_REASONING; STRATEGY_VALIDATION_KEY; SUPABASE_ANON_KEY; SUPABASE_PUBLISHABLE_KEY; SUPABASE_SERVICE_ROLE_KEY; SUPABASE_URL; TRAINING_DIGEST_SECRET.

Test/diagnostic-only names additionally found: PROBE_USER_ID, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY. Runtime-provided public metadata names used by version are DENO_DEPLOYMENT_ID and SB_REGION (supabase/functions/_shared/versionResponse.ts:8,35-38,145-146).

Frontend/build names: VITE_SUPABASE_PROJECT_ID, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_URL, VITE_ENABLE_LEGACY_ENRICHMENT_BRIDGE, VITE_STRATEGY_LIBRARY_CACHE, VITE_STRATEGY_PARALLEL_AUTHORING, VITE_STRATEGY_PARTIAL_REGEN, VITE_STRATEGY_SYNTHESIS_CACHE, VITE_STRATEGY_TARGETED_REMEDIATION. ANALYZE is used by vite.config.ts:99.

Values are runtime-only and intentionally absent. A deployment manifest must classify each name as platform-provided, secret, non-secret setting, diagnostic-only, or obsolete before any deployment.

## Cron, scheduled jobs, and background writers

Chronological migrations:

- pg_cron and pg_net are enabled in 20260205170426..., 20260311053345..., 20260317225106..., and 20260323110853....
- Only supabase/migrations/20260711134232_...sql:37-42 schedules a job: ops_sentinel_v1 at 0 3 * * *.
- That same migration seeds agent_cron_map with 13 expected mappings at lines 20-35. Several mapped job names do not match the derived snapshot names, and cadence_sentinel_v1, backlog_burner_v1, gap_ranker_v1, and governor_v1 have no schedule definition found.
- The migration queries public.agent_configs at lines 54-65 and 86-93, but no CREATE TABLE public.agent_configs exists in chronological migrations; it appears only in supabase/dynamic_staging_schema.sql:202-203. This is a fresh-restore blocker unless the actual dump/selective restore plan supplies it.

Derived snapshot only (supabase/dynamic_staging_schema.sql:6800-6868; credential values deliberately omitted):

- sync-calendar-hourly — 0 * * * * — HTTP invokes sync-calendar.
- process-podcast-queue-every-minute — * * * * * — HTTP invokes process-podcast-queue.
- daily-digest-6am — 0 6 * * * — HTTP invokes daily-digest.
- run-strategy-task-reaper-every-minute — * * * * * — HTTP invokes run-strategy-task-reaper.
- ops_sentinel_v1 — 0 3 * * * — database insert/check.
- lease_reaper_v1 — */15 * * * * — database update.
- decay_evaporator_v1 — 0 2 * * * — database update.
- freshness_warden_v1 — 0 4 * * * — database insert.
- generate-daily-plan-5am-et — 0 10 * * 1-5 — HTTP invokes schedule-daily-plan.

Timezone is not established by these lines. Names/docs calling jobs "6am" or "5am ET" do not prove the configured cron timezone or daylight-saving behavior. Docs/GUIDE.md:191-205 describes podcast, daily digest, daily plan, task reaper, and calendar behavior; this is expected behavior, not runtime proof.

Function-side guards/dependencies:

- daily-digest is dual-mode CRON_SECRET header or user JWT (index.ts:26-42).
- run-strategy-task-reaper and schedule-daily-plan require CRON_SECRET (respective index.ts:22-25 and 12-15).
- training-digest requires TRAINING_DIGEST_SECRET (index.ts:15-20), but no repository cron schedule was found.
- process-podcast-queue declares itself unauthenticated system cron and uses service role (index.ts:587-596); it has no explicit config.toml entry. Its actual edge-boundary JWT behavior must be rehearsed, not inferred.
- sync-calendar requires a real bearer user (index.ts:573-595), while the derived cron snapshot shows an HTTP schedule. The exact supported cron authentication model therefore needs reconciliation.
- Self/background continuations exist in run-enrichment-job (lines 339,397), batch-extract-kis (lines 222-289), extract-tactics (line 2484), process-podcast-queue (multiple downstream function calls), and strategy orchestration. These must be drained/paused in the final quiet window.
- Settings claims an n8n weekly backup against the primary database (src/pages/Settings.tsx:253-259; docs/GUIDE.md:179-180). No n8n workflow/configuration is in Git. Treat it as runtime-only and require Lovable/operator inventory.
- Client-side browser notification scheduling also exists, but it is not a server cron and does not replace a background-job inventory.

## Webhooks and outbound integrations

No standalone webhook registry/configuration was found. pg_net cron HTTP calls are the only SQL-defined outbound hooks, and most live only in the derived snapshot.

External service dependencies found in Edge code:

- Lovable AI gateway/API: ai.gateway.lovable.dev and api.lovable.dev; LOVABLE_API_KEY.
- Anthropic: api.anthropic.com; ANTHROPIC_API_KEY.
- OpenAI: api.openai.com; OPENAI_API_KEY.
- Perplexity: api.perplexity.ai; PERPLEXITY_API_KEY.
- Firecrawl: api.firecrawl.dev; FIRECRAWL_API_KEY.
- ElevenLabs: api.elevenlabs.io; ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID. register-dave-tools mutates remote ElevenLabs agent/tool configuration, so source deployment alone does not recreate that configuration.
- Browserless: production-sfo.browserless.io; BROWSERLESS_API_KEY. Circle imports additionally need CIRCLE_CRED_KEY and/or COURSE_PLATFORM_EMAIL / COURSE_PLATFORM_PASSWORD.
- Outlook calendar ICS: OUTLOOK_ICS_URL.
- Focus tracker inbound integration: FOCUS_TRACKER_API_KEY (log-workday-focus).
- Public content/metadata fetches include Apple/iTunes podcasts, Spotify oEmbed/pages, YouTube, Wistia/Vimeo, Google Docs/Drive, Circle, and LinkedIn-derived pages.
- Edge-to-Edge calls use SUPABASE_URL plus anon/service credentials across enrichment, podcast, strategy, scoring, and daily-plan paths.
- Frontend uses @lovable.dev/cloud-auth-js (src/integrations/lovable/index.ts:1-16), which is a Lovable-specific runtime dependency that must be validated on the remixed/rebound project.

No Slack, Teams, generic Zapier, or webhook URL configuration was found. Slack strings in sales content are not integrations. The n8n backup is documentation-only and therefore an unknown runtime dependency.

## Realtime

Publication migrations explicitly add:

- resources — 20260328190948...:1.
- resource_jobs and resource_job_steps — 20260322170324...:79-81.
- pipeline_diagnoses — 20260331013034...:43.
- podcast_import_queue — 20260401033608...:42-43.
- background_jobs — 20260407122956...:54-55.

Frontend subscriptions:

- resources — src/hooks/useIncomingQueue.ts:26-34.
- podcast_import_queue and batch_runs — src/hooks/usePodcastQueue.ts:157-184.
- resource_jobs / resource_job_steps — src/hooks/useResourceJobs.ts:26-65.
- background_jobs — src/lib/durableJobs.ts:178-185 and src/hooks/useActiveJobQueue.ts:186-203.
- podcast_import_queue again — src/hooks/useActiveJobQueue.ts:198-203.

Gap: batch_runs is subscribed to in code but no ALTER PUBLICATION supabase_realtime ADD TABLE public.batch_runs was found in migrations or the derived schema snapshot. Rehearsal must inspect the actual publication membership and decide whether code is relying on an undeclared runtime setting or silently missing events.

No CREATE SUBSCRIPTION was found. Realtime server configuration, replica identity, enabled state, and runtime publication membership remain empirical.

## Storage

Repository-defined private buckets:

- enrichment-screenshots — created by 20260312173207...:2; authenticated insert/select/delete policies at lines 6-17 with user-id first-folder ownership.
- resource-files — created by 20260318153529...:63; authenticated FOR ALL policy at line 66 with user-id first-folder ownership.
- strategy-uploads — created by 20260415045912...:3; insert/select/delete policies at lines 7-18 with user-id first-folder ownership.

Code uses:

- enrichment-screenshots in OrgChartView, ScreenshotImportModal, ScreenshotEnrichModal, and StakeholderMap.
- resource-files in upload/recovery/import code and parse-uploaded-file downloads.
- strategy-uploads in src/hooks/strategy/useStrategyUploads.ts:88-121.

Important policy/code check: enrichment-screenshots code performs upload(..., { upsert: true }) (for example OrgChartView.tsx:182), but its migration does not define UPDATE access. Supabase Storage upsert normally needs insert/select/update; rehearsal should test replacement behavior and compare actual policies. Do not "fix" this as part of migration inventory without a separate reviewed change.

Storage object data is not in SQL migrations. Bucket settings beyond public=false, actual object counts/bytes/checksums, MIME/cache metadata, and any runtime policy drift require separate inventory/copy verification.

## Auth, users, roles, redirects, OAuth, and mail

Auth surfaces:

- Google sign-in is invoked through Lovable Cloud auth at src/pages/Auth.tsx:41-48 and src/integrations/lovable/index.ts:3-31.
- The Lovable wrapper type allows google or apple, but repository UI only invokes google. Do not infer Apple is configured.
- Email/password sign-in uses supabase.auth.signInWithPassword at Auth.tsx:51-58.
- No sign-up UI, password-reset UI, resetPasswordForEmail call, or SMTP configuration was found. Because Support reports password resets may be required, reset delivery/template/site-url behavior is a cutover blocker.
- OAuth redirect is derived from window.location.origin + /auth/callback with a relative next value (Auth.tsx:12-17,33-44). AuthCallback accepts only same-origin relative next paths and defaults to /dojo (AuthCallback.tsx:6-15,24-30).
- OAuth consent routes /.lovable/oauth/consent and /oauth/consent are registered in App.tsx:159-162. OAuthConsent calls Supabase Auth REST endpoints and trusts the authorization server's returned redirect target (OAuthConsent.tsx:13-25,36-49,78-97). OAuth clients, redirect URI registrations, consent settings, and site URL are not in Git.
- MCP OAuth issuer is hardcoded to the current project ref in supabase/functions/mcp/index.ts:178-189 and .lovable/mcp/manifest.json:4-10. Both must be regenerated/rebound.
- The frontend persists sessions in localStorage and auto-refreshes tokens (src/integrations/supabase/client.ts:11-16).
- AuthContext creates work_schedule_config and streak_summary rows on first authenticated session (src/contexts/AuthContext.tsx:14-59), so smoke tests can write data unless isolated/read-only test accounts and permissions are planned.

Approved-user/owner logic:

- Migration 20260329031208... creates approved_users and is_approved_user, seeds one hardcoded owner email, and links user_id to auth.users (lines 2-44). The value is intentionally omitted here.
- Later migrations harden the client SELECT policy to user_id-is-self and active (20260704034559... and 20260707002001...).
- ProtectedRoute enforces auth and useApprovalCheck by default (ProtectedRoute.tsx:11-50; featureFlags.ts:25-39), but ENFORCE_ALLOWLIST is client-local mutable state. Backend RLS/RPC/function checks remain the actual authorization boundary.
- useApprovalCheck queries by user_id OR email (lines 31-37), while the latest RLS policy exposes only active rows with matching non-null user_id. Migrated approved_users rows therefore need their auth user UUID mapping verified.
- runTask owner logic and StrategyControlPanel contain a hardcoded owner email; values are omitted (supabase/functions/_shared/strategy-orchestrator/runTask.ts:966-993; src/pages/StrategyControlPanel.tsx:50).
- batch-regrade-now, batch-recovery-rerun, and training-digest contain hardcoded user UUID constants. Values are omitted (their index.ts:9,21,9 respectively). Those identifiers cannot be assumed stable across a partial/best-effort auth migration.
- strategy-benchmark-runner, strategy-stress-runner, and strategy-stress-test use admin getUserById + magic-link generation/verification to impersonate a selected user for testing. This depends on migrated auth users/identities and Auth configuration, even though it does not necessarily send mail.
- log-workday-focus's API-key path selects the first Auth user (index.ts:21-43), a production-data/order assumption that must not be used as a migration identity rule.

Repository has 40 direct REFERENCES auth.users lines across migrations, and 107 migration files reference auth.users/auth.uid in some form. Exact UUID preservation and identity usability are therefore critical, not optional. Actual auth.users/auth.identities contents, provider identities, passwords, MFA, sessions, OAuth client registrations, email templates, SMTP, site URL, redirect allowlist, JWT settings, and password-reset deliverability are not repository-derived.

## Frontend bindings and hardcoded project/runtime assumptions

Primary bindings:

- src/integrations/supabase/client.ts:5-16 uses VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.
- VITE_SUPABASE_PROJECT_ID is used by MCP/Circle integrations.
- Many direct /functions/v1 calls interpolate VITE_SUPABASE_URL and attach VITE_SUPABASE_PUBLISHABLE_KEY; rebinding only the generated client is insufficient.
- .env and .env.example are tracked. Name inventory: SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, VITE_SUPABASE_PROJECT_ID, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_URL. Values are omitted.

Hardcoded refs/URLs:

- Current Lovable-managed project ref odbjjklumdsuqdvkgwyv: supabase/config.toml:1; .github/workflows/verify-production-version.yml:22-26,99-103; scripts/phase3a-debug-validation.sh:48-50; supabase/functions/mcp/index.ts:178-187; .lovable/mcp/manifest.json:4-10; docs/STATE.md.
- Populated dynamic-staging ref uujkmcbqavsmzhnbqvmm: supabase/dynamic_staging_schema.sql cron URLs and .lovable/plan.md. It is explicitly out of scope and must not be used.
- The dispatch-only production version workflow is tied to the current project ref and deployment-id prefix; it must not be invoked in this PR and must be rebound only after authorized cutover.
- scripts/phase3a-debug-validation.sh contains a hardcoded current endpoint and a credential-like public token literal. The value is intentionally omitted. Do not run it during this migration PR.
- supabase/dynamic_staging_schema.sql contains credential-like literals in cron headers at lines 6805,6814,6823,6832,6864. Values are intentionally omitted. Never copy them into a report, restore command, or new project.
- src/lib/rustBusterLinks.ts:4-14 hardcodes an organization-specific Salesforce host and report/list IDs.
- Browserless uses a production-sfo endpoint (import-circle-browserless/index.ts:527).
- MCP titles/instructions are personalized to one owner, Branch territory, and a stated account count (supabase/functions/mcp/index.ts:181-189; src/lib/mcp/index.ts:10-18). Verify these assumptions rather than carrying them as infrastructure truth.
- REVIEW_MODE is a compile-time source constant currently false (ReviewModeContext.tsx:13-15), not environment configuration.

## Code/migration gaps and runtime-only unknowns

1. 78 Edge Functions lack an explicit `verify_jwt` boolean in `config.toml`.
   The local deployment-closure inventory treats the documented omitted default
   as `true` and records that provenance structurally; this is not evidence of
   each function's currently deployed Lovable Cloud setting.
2. docs/phase2-function-inventory.json is incomplete (75 vs 120 functions).
3. Most cron definitions are absent from chronological migrations; the derived snapshot is not a safe substitute.
4. agent_cron_map references public.agent_configs, but that table is not created in chronological migrations.
5. Cron naming differs between agent_cron_map and the derived snapshot for calendar and digest jobs; active runtime names are unknown.
6. batch_runs has a frontend Realtime subscription but no repository publication addition.
7. n8n weekly backup is claimed in UI/docs but has no repository configuration.
8. Auth provider/OAuth client/SMTP/site URL/redirect/template settings are absent.
9. Actual Auth identity/password usability is absent and UUID preservation matters to many foreign keys and hardcoded identities.
10. Storage objects and complete bucket settings are absent; only three bucket/policy definitions are in migrations.
11. Deployed Edge Function set, versions, runtime imports, effective JWT settings, env values, and remote agent configuration (ElevenLabs/Lovable) are absent.
12. The repository uses Lovable AI endpoints and Lovable Cloud auth; availability/configuration after remix and owned-Supabase rebinding is not proven.
13. Tracked .env, dynamic_staging_schema.sql, and phase3a script contain sensitive or credential-like material. Migration tooling must not echo or package their values.
14. Production webhooks beyond pg_net jobs, n8n workflows, job pause controls, cron timezone, Realtime runtime settings, OAuth providers, and SMTP require empirical/operator inventory.
15. A full restore cannot be selected based on repository state alone: schema drift represented in dynamic_staging_schema.sql shows objects/runtime jobs not reproducible from chronological migrations.

## Verification requirements for rehearsal

- Generate the repository source function manifest from the reviewed Git commit: slug, resolved deployment-closure fingerprint (including reachable `_shared` files), and structured effective `verify_jwt`/entrypoint/import-map settings. A locally generated target-role manifest remains non-independent until deployed source/config is collected from the owned target.
- Compare actual deployed slugs/settings only under separately authorized read access; this PR must remain repository-local.
- Inventory actual cron.job rows, active/timezone/schedule/command hashes, and reconcile to the repository without printing header values.
- Inventory Auth counts/identity-provider counts, preserve/map UUIDs, rehearse password reset, and validate Google/OAuth/MCP redirects plus SMTP.
- Inventory Realtime publication membership/replica identity and test every subscribed table, especially batch_runs.
- Inventory Storage buckets/settings/object counts/bytes/checksums and test upsert policy behavior.
- Rebind every frontend/function/workflow/MCP project reference; search for both known refs before cutover.
- Pause cron, background/self-continuation workers, user writes, webhook writers, and n8n before final export.
- Treat all "production" statements in docs as historical claims, not current verification.

## Appendix: per-function matrix

The environment column includes direct index.ts reads plus names discovered by recursively following local relative imports. It does not include values. Dynamic/non-relative module behavior still requires rehearsal.

| Function | verify_jwt in config.toml | direct shared imports | env/config names (direct + local shared dependency) |
|---|---|---|---|
| `analyze-call` | not set | `getModelConfig.ts`<br>`strategy-core/index.ts`<br>`strategy-router/situationClassifier.ts` | `ANTHROPIC_API_KEY`<br>`LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `analyze-deal-outcome` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `analyze-sentiment` | true | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `batch-actionize` | false | `enforcementLog.ts`<br>`securityLog.ts` | `SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `batch-extract-kis` | false | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `batch-recovery-rerun` | not set | `securityLog.ts` | `SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `batch-regrade-now` | not set | — | `SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `branch-intelligence` | not set | — | `ANTHROPIC_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `build-resource` | not set (section only) | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `car-mode-audio-score` | not set | `getModelConfig.ts` | `ELEVENLABS_API_KEY`<br>`LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `car-mode-score` | true | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `classify-resource` | false | `getModelConfig.ts` | `FIRECRAWL_API_KEY`<br>`LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `classify-signal` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `clean-baseline` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `conversion-math` | false | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_URL` |
| `daily-digest` | false | `getModelConfig.ts` | `CRON_SECRET`<br>`PERPLEXITY_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `dave-conversation-token` | false | — | `ELEVENLABS_AGENT_ID`<br>`ELEVENLABS_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `dave-health-check` | true | — | `ELEVENLABS_AGENT_ID`<br>`ELEVENLABS_API_KEY` |
| `deal-intelligence` | not set | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_URL` |
| `derive-library-cards` | not set | `getModelConfig.ts`<br>`strategy-orchestrator/providers.ts` | `ANTHROPIC_API_KEY`<br>`LOVABLE_API_KEY`<br>`OPENAI_API_KEY`<br>`PERPLEXITY_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `detect-knowledge-gaps` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `discover-contacts` | false | `getModelConfig.ts` | `FIRECRAWL_API_KEY`<br>`LOVABLE_API_KEY`<br>`PERPLEXITY_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `discover-resources` | not set (section only) | `getModelConfig.ts` | `FIRECRAWL_API_KEY`<br>`LOVABLE_API_KEY`<br>`PERPLEXITY_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `dojo-review-score` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `dojo-roleplay-score` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `dojo-score` | true | `getModelConfig.ts` | `ANTHROPIC_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `drill-review` | true | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `elevenlabs-stt` | false | `getModelConfig.ts`<br>`requireUser.ts` | `ELEVENLABS_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `elevenlabs-transcribe` | not set | `getModelConfig.ts` | `ELEVENLABS_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `elevenlabs-tts-stream` | false | `getModelConfig.ts`<br>`requireUser.ts` | `ELEVENLABS_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `enrich-account` | false | `getModelConfig.ts`<br>`requireUser.ts` | `FIRECRAWL_API_KEY`<br>`LOVABLE_API_KEY`<br>`PERPLEXITY_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `enrich-resource-content` | false | — | `FIRECRAWL_API_KEY`<br>`INTERNAL_FUNCTION_SECRET`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `expand-prompt` | not set | `getModelConfig.ts` | `ANTHROPIC_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `explain-score` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `extract-scenarios` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `extract-strategy-memory` | not set | `getModelConfig.ts` | `ANTHROPIC_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `extract-tactics` | false | `enforcementLog.ts`<br>`getModelConfig.ts`<br>`securityLog.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `extract-tasks` | false | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `generate-call-goals` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `generate-execution-draft` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `generate-flashcards` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `generate-lesson-content` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `generate-playbooks` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `generate-stage-playbook` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `generate-time-blocks` | false | — | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `get-benchmark-kis` | not set | — | `SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `grade-lesson-response` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `grade-mock-call` | false | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `grade-objection-drill` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `grade-transcript` | not set | `getModelConfig.ts` | `ANTHROPIC_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `import-circle-browserless` | not set | — | `BROWSERLESS_API_KEY`<br>`CIRCLE_CRED_KEY`<br>`COURSE_PLATFORM_EMAIL`<br>`COURSE_PLATFORM_PASSWORD`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `import-course` | not set | — | `COURSE_PLATFORM_EMAIL`<br>`COURSE_PLATFORM_PASSWORD` |
| `import-course-capture` | not set | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_URL` |
| `import-podcast` | false | `requireUser.ts` | `FIRECRAWL_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_URL` |
| `import-webpage-links` | not set | — | `FIRECRAWL_API_KEY` |
| `import-youtube-playlist` | false | `requireUser.ts` | `FIRECRAWL_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_URL` |
| `journal-nudge` | false | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_URL` |
| `log-workday-focus` | false | `securityLog.ts` | `FOCUS_TRACKER_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `mcp` | false | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_URL` |
| `mock-call` | false | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `operationalize-resource` | false | `getModelConfig.ts` | `FIRECRAWL_API_KEY`<br>`LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `parse-account-screenshot` | false | `getModelConfig.ts`<br>`requireUser.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `parse-account-synopsis` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `parse-calendar-screenshot` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `parse-claude-import` | false | `getModelConfig.ts`<br>`requireUser.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `parse-opp-synopsis` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `parse-screenshot` | false | `getModelConfig.ts`<br>`requireUser.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `parse-uploaded-file` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `pdf-ocr` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `pipeline-hygiene` | false | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_URL` |
| `playbook-roleplay` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `preprocess-transcript` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `prioritize-accounts` | false | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `process-podcast-queue` | not set | `securityLog.ts` | `SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `reconcile-library` | not set | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `register-dave-tools` | not set | — | `ELEVENLABS_AGENT_ID`<br>`ELEVENLABS_API_KEY` |
| `resolve-podcast-episode` | not set | — | `FIRECRAWL_API_KEY` |
| `run-catchup` | not set | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `run-discovery-prep` | not set | `strategy-orchestrator/idempotency.ts`<br>`strategy-orchestrator/runTask.ts`<br>`strategy-orchestrator/staleRunWatchdog.ts` | `ANTHROPIC_API_KEY`<br>`AUTHORING_BATCH_TIMEOUT_MS`<br>`LOVABLE_API_KEY`<br>`OPENAI_API_KEY`<br>`PERPLEXITY_API_KEY`<br>`STRATEGY_DEBUG_HARNESS`<br>`STRATEGY_DISCOVERY_PREP_SOP_ENFORCEMENT`<br>`STRATEGY_TARGETED_REMEDIATION`<br>`STRATEGY_VALIDATION_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `run-discovery-prep-step` | not set | `strategy-orchestrator/progressiveDriver.ts` | `ANTHROPIC_API_KEY`<br>`AUTHORING_BATCH_TIMEOUT_MS`<br>`LOVABLE_API_KEY`<br>`OPENAI_API_KEY`<br>`PERPLEXITY_API_KEY`<br>`STRATEGY_VALIDATION_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `run-enrichment-job` | not set | `enforcementLog.ts`<br>`securityLog.ts` | `SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `run-phase35b-validation` | not set | — | `LOVABLE_API_KEY`<br>`STRATEGY_VALIDATION_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `run-strategy-eval-synthesis` | not set | `strategy-skills/index.ts`<br>`strategy-skills/manifests.ts` | `LOVABLE_API_KEY`<br>`STRATEGY_VALIDATION_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `run-strategy-job` | not set | `strategy-orchestrator/libraryCards.ts`<br>`strategy-orchestrator/registry.ts`<br>`strategy-orchestrator/runTask.ts`<br>`strategy-orchestrator/staleRunWatchdog.ts`<br>`strategy-orchestrator/types.ts` | `ANTHROPIC_API_KEY`<br>`AUTHORING_BATCH_TIMEOUT_MS`<br>`LOVABLE_API_KEY`<br>`OPENAI_API_KEY`<br>`PERPLEXITY_API_KEY`<br>`STRATEGY_DEBUG_HARNESS`<br>`STRATEGY_DISCOVERY_PREP_SOP_ENFORCEMENT`<br>`STRATEGY_TARGETED_REMEDIATION`<br>`STRATEGY_VALIDATION_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `run-strategy-task` | not set | `strategy-orchestrator/idempotency.ts`<br>`strategy-orchestrator/runTask.ts`<br>`strategy-orchestrator/staleRunWatchdog.ts` | `ANTHROPIC_API_KEY`<br>`AUTHORING_BATCH_TIMEOUT_MS`<br>`LOVABLE_API_KEY`<br>`OPENAI_API_KEY`<br>`PERPLEXITY_API_KEY`<br>`STRATEGY_DEBUG_HARNESS`<br>`STRATEGY_DISCOVERY_PREP_SOP_ENFORCEMENT`<br>`STRATEGY_TARGETED_REMEDIATION`<br>`STRATEGY_VALIDATION_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `run-strategy-task-reaper` | not set | `strategy-orchestrator/staleRunWatchdog.ts` | `CRON_SECRET`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `run-validation-canary` | not set | — | `STRATEGY_VALIDATION_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_URL` |
| `schedule-daily-plan` | not set | — | `CRON_SECRET`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `score-micro-drill` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `score-original-response` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `search-context` | false | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_URL` |
| `simulate-chat` | false | `getModelConfig.ts`<br>`requireUser.ts` | `ANTHROPIC_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `source-icp-accounts` | false | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`PERPLEXITY_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `strategy-benchmark-runner` | not set | — | `ANTHROPIC_API_KEY`<br>`BENCHMARK_JUDGE_TIMEOUT_MS`<br>`BENCHMARK_PROVIDER_TIMEOUT_MS`<br>`BENCHMARK_RETRY_BASE_MS`<br>`BENCHMARK_RETRY_MAX`<br>`BENCHMARK_RETRY_MAX_MS`<br>`OPENAI_API_KEY`<br>`STRATEGY_VALIDATION_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `strategy-chat` | not set | `strategy-core/behaviorIntent.ts`<br>`strategy-core/currentStateIntelligence.ts`<br>`strategy-core/index.ts`<br>`strategy-core/outputMode.ts`<br>`strategy-core/promptComposition.ts`<br>`strategy-core/semanticPrompt.ts`<br>`strategy-core/v2/index.ts`<br>`strategy-router/index.ts`<br>`strategy-router/log.ts`<br>`strategy-router/situationClassifier.ts`<br>`strategy-skills/index.ts` | `ANTHROPIC_API_KEY`<br>`LOVABLE_API_KEY`<br>`OPENAI_API_KEY`<br>`PERPLEXITY_API_KEY`<br>`SMOKE_TEST_MODE`<br>`STRATEGY_SKILLS_ENABLED`<br>`STRATEGY_V2_REASONING`<br>`STRATEGY_VALIDATION_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `strategy-clone-thread` | not set | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `strategy-detect-conflicts` | not set | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `strategy-detect-proposals` | not set | — | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `strategy-evidence-render` | not set | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_URL` |
| `strategy-promote-proposal` | not set | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `strategy-retrieval-probe` | not set | `strategy-core/resourceRetrieval.ts` | `STRATEGY_VALIDATION_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `strategy-smoke-test` | not set | — | `ANTHROPIC_API_KEY`<br>`OPENAI_API_KEY`<br>`PERPLEXITY_API_KEY`<br>`SMOKE_TEST_MODE`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_PUBLISHABLE_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `strategy-stage-proposal` | not set | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `strategy-stress-runner` | not set | — | `STRATEGY_VALIDATION_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `strategy-stress-test` | not set | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `strategy-summarize-upload` | not set | — | `LOVABLE_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `strategy-transform-output` | not set | — | `ANTHROPIC_API_KEY`<br>`OPENAI_API_KEY`<br>`SMOKE_TEST_MODE`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `suggest-resource-uses` | not set (section only) | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `suggest-templates` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `sync-calendar` | false | — | `OUTLOOK_ICS_URL`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `territory-copilot` | false | `getModelConfig.ts` | `FIRECRAWL_API_KEY`<br>`LOVABLE_API_KEY`<br>`PERPLEXITY_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `training-digest` | false | — | `SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL`<br>`TRAINING_DIGEST_SECRET` |
| `transcribe-audio` | not set | `getModelConfig.ts` | `ELEVENLABS_API_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `validate-enrichment` | not set | — | `FIRECRAWL_API_KEY` |
| `version` | false | `versionResponse.ts` | — |
| `voice-command` | not set | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `weekly-battle-plan` | false | `getModelConfig.ts` | `LOVABLE_API_KEY`<br>`SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `weekly-digest` | false | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
| `weekly-patterns` | false | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_URL` |
| `youtube-captions` | not set | — | `SUPABASE_ANON_KEY`<br>`SUPABASE_SERVICE_ROLE_KEY`<br>`SUPABASE_URL` |
