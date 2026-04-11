/**
 * run-enrichment-job — Server-side enrichment orchestrator.
 *
 * Picks up a background_jobs row by ID, iterates through the resource IDs
 * stored in metadata.resource_ids, calls enrich-resource-content for each,
 * and updates progress in the background_jobs row.
 *
 * Self-continues if approaching the platform timeout (~180s budget).
 * This means enrichment survives tab close, refresh, and navigation.
 *
 * Also supports generic "retry" — any background_jobs row in 'queued' status
 * with a known type gets dispatched to the right handler.
 *
 * Phase 3: Supports mode="protected" for enforced auth + scope checks.
 * Legacy path (no mode) is unchanged.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logServiceRoleUsage, logMissingUserScope, logCrossUserAccess, logValidationWarnings, logAuthMethod } from '../_shared/securityLog.ts';
import { logEnforcementEvent } from '../_shared/enforcementLog.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const WATCHDOG_BUDGET_MS = 150_000; // stop processing 30s before platform kill
const INTER_ITEM_DELAY_MS = 1200;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Auth: accept either user JWT or service-role for continuations
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");

  const supabase = createClient(supabaseUrl, serviceKey);
  logServiceRoleUsage('run-enrichment-job', 'single_user', { reason: 'db_operations_and_continuation' });

  // Resolve caller identity
  let callerUserId: string | null = null;
  let authMethod: 'jwt' | 'service-role-continuation' | 'none' = 'none';
  if (token && token !== serviceKey) {
    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data?.user) {
      callerUserId = data.user.id;
      authMethod = 'jwt';
    }
    logAuthMethod('run-enrichment-job', 'jwt', { resolved: !!callerUserId });
  } else if (token === serviceKey) {
    authMethod = 'service-role-continuation';
    logAuthMethod('run-enrichment-job', 'service-role-continuation');
  } else {
    logAuthMethod('run-enrichment-job', 'none');
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const jobId = body.job_id;
  const isProtectedMode = body.mode === "protected";
  const isInternalContinuation = body.mode === "internal_continuation";
  const isContinuation = body.is_continuation === true;

  logValidationWarnings('run-enrichment-job', body, ['job_id']);

  // ── Lane routing ──
  // Three explicit lanes: protected (user-driven), internal_continuation, legacy.
  if (isInternalContinuation) {
    // ── Explicit internal continuation lane ──
    // Only self-dispatched continuations should use this mode.
    // Requires: service-role auth + is_continuation flag + job_id.
    if (!isContinuation) {
      logEnforcementEvent('run-enrichment-job', 'fn:internal_request_rejected' as any, {
        reason: 'internal_continuation_without_flag',
        authMethod,
      });
      return new Response(JSON.stringify({ error: "internal_continuation requires is_continuation" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (authMethod !== 'service-role-continuation') {
      logEnforcementEvent('run-enrichment-job', 'fn:internal_request_rejected' as any, {
        reason: 'internal_continuation_wrong_auth',
        authMethod,
      });
      return new Response(JSON.stringify({ error: "internal_continuation requires service-role auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    logEnforcementEvent('run-enrichment-job', 'fn:internal_path_used' as any, {
      lane: 'internal_continuation',
      jobId,
    });
  } else if (isProtectedMode) {
    // ── Protected user-driven path (unchanged) ──
    logEnforcementEvent('run-enrichment-job', 'fn:protected_path_used', { authMethod });

    if (!isContinuation && authMethod !== 'jwt') {
      logEnforcementEvent('run-enrichment-job', 'fn:request_rejected_protected_path', {
        reason: 'missing_jwt_auth',
        authMethod,
      });
      return new Response(JSON.stringify({ error: "Protected path requires authentication" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!jobId) {
      logEnforcementEvent('run-enrichment-job', 'fn:request_rejected_protected_path', {
        reason: 'missing_job_id',
      });
      return new Response(JSON.stringify({ error: "job_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } else {
    // ── Legacy path: classify and fence ──
    // No behavior change — classification and telemetry only.
    const legacyClass = isContinuation
      ? 'legacy_internal_fallback'      // continuation without explicit internal mode
      : authMethod === 'jwt'
        ? 'legacy_user_path'            // user-driven but without mode="protected"
        : authMethod === 'service-role-continuation'
          ? 'legacy_service_role_entry'  // service-role initial entry (not continuation)
          : 'legacy_unknown_path';       // no auth, no mode — unexpected

    logEnforcementEvent('run-enrichment-job', 'fn:legacy_path_classified' as any, {
      legacyClass,
      authMethod,
      isContinuation,
      jobId,
      hasProtectedAlternative: !isContinuation, // user-driven has protected; continuation has internal
      hasInternalAlternative: isContinuation,
      migrationCandidate: legacyClass === 'legacy_user_path' || legacyClass === 'legacy_internal_fallback',
    });

    // ── Soft enforcement: legacy_user_path (Phase E, Slice 9) ──
    const ENABLE_LEGACY_USER_SOFT_ENFORCEMENT = true;

    if (legacyClass === 'legacy_user_path') {
      if (ENABLE_LEGACY_USER_SOFT_ENFORCEMENT) {
        console.warn(JSON.stringify({
          _type: 'fn:legacy_user_path_deprecation_warning',
          _phase: 3,
          _severity: 'warn',
          functionName: 'run-enrichment-job',
          ts: new Date().toISOString(),
          pathClass: 'legacy_user_path',
          authMethod,
          hasProtectedAlternative: true,
          migrationHint: 'use mode: "protected"',
          jobId,
          userAgent: req.headers.get('user-agent')?.slice(0, 120) || 'unknown',
        }));
        (req as any).__legacySoftEnforce = true;
      } else {
        logEnforcementEvent('run-enrichment-job', 'fn:legacy_user_path_deprecation_warning' as any, {
          pathClass: 'legacy_user_path',
          authMethod,
          protectedAlternativeExists: true,
          migrationHint: 'Add mode: "protected" to request body',
          jobId,
        });
      }
    }

    // Preserve original telemetry for backwards compatibility
    if (isContinuation) {
      logEnforcementEvent('run-enrichment-job', 'fn:internal_fallback_used' as any, {
        authMethod,
        reason: 'continuation_without_explicit_mode',
        jobId,
      });
    } else {
      logEnforcementEvent('run-enrichment-job', 'fn:legacy_path_used', { authMethod, isContinuation });
    }
  }

  if (!jobId) {
    return new Response(JSON.stringify({ error: "job_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Phase D, Slice 4: User-scoped client for protected path reads ──
  const supabaseUserScoped = (isProtectedMode && authHeader && token && token !== serviceKey)
    ? createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    : null;

  // Load the job row
  // On protected path, use user-scoped client (RLS enforces ownership at DB level)
  const jobFetchClient = supabaseUserScoped || supabase;
  if (supabaseUserScoped) {
    logEnforcementEvent('run-enrichment-job', 'fn:service_role_reduced_path' as any, {
      reason: 'protected_path_user_scoped_read',
      jobId,
      operation: 'job_fetch',
    });
  } else {
    logEnforcementEvent('run-enrichment-job', 'fn:service_role_retained' as any, {
      reason: isProtectedMode ? 'no_user_client_available' : 'legacy_or_internal_path',
      jobId,
      operation: 'job_fetch',
    });
  }
  console.log(`[run-enrichment-job] Fetching job ${jobId} (client: ${supabaseUserScoped ? 'user-scoped' : 'service-role'})`);
  const { data: job, error: jobErr } = await jobFetchClient
    .from("background_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobErr || !job) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Guard: only process queued or running jobs
  if (!isContinuation && job.status !== "queued") {
    return new Response(
      JSON.stringify({ error: `Job is ${job.status}, not queued` }),
      { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Ownership enforcement ──
  // Protected path: strictly enforce caller == job owner
  // Legacy path: existing check (block mismatch but allow no-caller for continuations)
  if (isProtectedMode && !isContinuation) {
    if (!callerUserId) {
      logEnforcementEvent('run-enrichment-job', 'fn:request_rejected_protected_path', {
        reason: 'no_caller_user_id',
      });
      return new Response(JSON.stringify({ error: "Unauthorized: cannot resolve user" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (callerUserId !== job.user_id) {
      logEnforcementEvent('run-enrichment-job', 'fn:request_rejected_protected_path', {
        reason: 'user_scope_mismatch',
      });
      logCrossUserAccess('run-enrichment-job', callerUserId, job.user_id, { jobId });
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    logEnforcementEvent('run-enrichment-job', 'fn:scope_enforced', {
      callerUserId,
      jobUserId: job.user_id,
    });
  } else {
    // Legacy ownership check (unchanged from original)
    if (callerUserId && callerUserId !== job.user_id) {
      logCrossUserAccess('run-enrichment-job', callerUserId, job.user_id, { jobId });
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const meta = (job.metadata ?? {}) as Record<string, any>;
  const resourceIds: string[] = meta.resource_ids ?? [];
  const mode: string = meta.mode ?? "deep_enrich";
  const force = mode === "re_enrich";
  const startIndex = meta.resume_from_index ?? 0;

  if (resourceIds.length === 0) {
    await supabase.from("background_jobs").update({
      status: "completed",
      step_label: "No resources to process",
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);

    const earlyHeaders: Record<string, string> = { ...corsHeaders, "Content-Type": "application/json" };
    if ((req as any).__legacySoftEnforce) {
      earlyHeaders['X-Deprecation-Warning'] = 'legacy_user_path; use mode="protected"';
    }
    return new Response(JSON.stringify({ status: "completed", processed: 0 }), {
      headers: earlyHeaders,
    });
  }

  // Mark as running
  await supabase.from("background_jobs").update({
    status: "running",
    started_at: job.started_at || new Date().toISOString(),
    substatus: "enriching",
    step_label: `Processing ${startIndex}/${resourceIds.length}`,
  }).eq("id", jobId);

  const startTime = Date.now();
  let successCount = meta.success_count ?? 0;
  let failedCount = meta.failed_count ?? 0;
  let lastProcessedIndex = startIndex;

  console.info(`[ENRICH-JOB] Starting job ${jobId}: ${resourceIds.length} resources, resuming from ${startIndex}, mode=${mode}, protected=${isProtectedMode}`);

  for (let i = startIndex; i < resourceIds.length; i++) {
    // Watchdog: self-continue before timeout
    if (Date.now() - startTime > WATCHDOG_BUDGET_MS) {
      console.info(`[ENRICH-JOB] Watchdog: pausing at index ${i}, dispatching continuation`);

      // Save progress
      await supabase.from("background_jobs").update({
        substatus: "waiting_continuation",
        step_label: `Continuing from ${i}/${resourceIds.length}`,
        progress_current: i,
        progress_total: resourceIds.length,
        progress_percent: Math.round((i / resourceIds.length) * 100),
        metadata: { ...meta, resume_from_index: i, success_count: successCount, failed_count: failedCount },
      }).eq("id", jobId);

      // Self-continue via explicit internal continuation lane
      try {
        const continueUrl = `${supabaseUrl}/functions/v1/run-enrichment-job`;
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5000);

        logEnforcementEvent('run-enrichment-job', 'fn:continuation_lane_used' as any, {
          jobId,
          resumeFromIndex: i,
          totalResources: resourceIds.length,
        });

        await fetch(continueUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ job_id: jobId, is_continuation: true, mode: "internal_continuation" }),
          signal: controller.signal,
        }).catch(() => {});
      } catch {
        console.warn(`[ENRICH-JOB] Continuation dispatch failed for job ${jobId}`);
      }

      return new Response(
        JSON.stringify({ status: "continuing", processed: i - startIndex, total: resourceIds.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if job was cancelled
    const { data: freshJob } = await supabase
      .from("background_jobs")
      .select("status")
      .eq("id", jobId)
      .single();

    if (freshJob?.status === "cancelled") {
      console.info(`[ENRICH-JOB] Job ${jobId} cancelled at index ${i}`);
      return new Response(
        JSON.stringify({ status: "cancelled", processed: i - startIndex }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resourceId = resourceIds[i];
    console.info(`[ENRICH-JOB] Processing resource ${i + 1}/${resourceIds.length}: ${resourceId}`);

    // Update progress
    await supabase.from("background_jobs").update({
      progress_current: i,
      progress_total: resourceIds.length,
      progress_percent: Math.round((i / resourceIds.length) * 100),
      step_label: `Resource ${i + 1} of ${resourceIds.length}`,
      substatus: "enriching",
    }).eq("id", jobId);

    // Call enrich-resource-content
    try {
      const enrichUrl = `${supabaseUrl}/functions/v1/enrich-resource-content`;
      const enrichResponse = await fetch(enrichUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ resource_id: resourceId, force }),
      });

      const enrichResult = await enrichResponse.json().catch(() => null);

      if (!enrichResponse.ok) {
        console.warn(`[ENRICH-JOB] Resource ${resourceId} failed: HTTP ${enrichResponse.status}`);
        failedCount++;
      } else {
        const finalStatus = enrichResult?.final_status;
        if (finalStatus === "enriched" || finalStatus === "partial") {
          successCount++;
        } else if (finalStatus === "needs_auth" || finalStatus === "unsupported" || finalStatus === "failed") {
          failedCount++;
        } else {
          successCount++; // Assume success if no explicit failure
        }
      }
    } catch (err) {
      console.error(`[ENRICH-JOB] Resource ${resourceId} threw:`, err);
      failedCount++;
    }

    lastProcessedIndex = i + 1;

    // Inter-item delay to avoid overwhelming the backend
    if (i < resourceIds.length - 1) {
      await new Promise(r => setTimeout(r, INTER_ITEM_DELAY_MS));
    }
  }

  // All done
  const totalProcessed = lastProcessedIndex;
  const finalStatus = failedCount > 0 && successCount === 0 ? "failed" : "completed";
  const finalLabel = `${successCount} enriched${failedCount > 0 ? `, ${failedCount} failed` : ""}`;

  console.info(`[ENRICH-JOB] Job ${jobId} ${finalStatus}: ${finalLabel}`);

  await supabase.from("background_jobs").update({
    status: finalStatus,
    completed_at: new Date().toISOString(),
    progress_current: resourceIds.length,
    progress_total: resourceIds.length,
    progress_percent: 100,
    step_label: finalLabel,
    substatus: null,
    error: failedCount > 0 ? `${failedCount} of ${resourceIds.length} resources failed` : null,
    metadata: { ...meta, success_count: successCount, failed_count: failedCount, resume_from_index: resourceIds.length },
  }).eq("id", jobId);

  const finalHeaders: Record<string, string> = { ...corsHeaders, "Content-Type": "application/json" };
  if ((req as any).__legacySoftEnforce) {
    finalHeaders['X-Deprecation-Warning'] = 'legacy_user_path; use mode="protected"';
  }

  return new Response(
    JSON.stringify({ status: finalStatus, processed: totalProcessed, success: successCount, failed: failedCount }),
    { headers: finalHeaders }
  );
});
