import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_ATTEMPTS = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // ── Claim one queued item atomically ──
    const { data: item, error: claimError } = await supabase.rpc(
      "claim_podcast_queue_item"
    );

    // If no RPC, fall back to a direct query approach
    let queueItem: any = item;

    if (claimError || !item) {
      // Direct claim: find oldest queued, mark processing
      const { data: candidates } = await supabase
        .from("podcast_import_queue")
        .select("*")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(1);

      if (!candidates?.length) {
        return new Response(
          JSON.stringify({ message: "No queued items", processed: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      queueItem = candidates[0];

      // Mark as processing
      const { error: updateErr } = await supabase
        .from("podcast_import_queue")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("id", queueItem.id)
        .eq("status", "queued"); // optimistic lock

      if (updateErr) {
        return new Response(
          JSON.stringify({ message: "Failed to claim item", error: updateErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!queueItem) {
      return new Response(
        JSON.stringify({ message: "No queued items", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing queue item: ${queueItem.id} - ${queueItem.episode_title}`);

    // ── Step 1: Dedup check ──
    const { data: existing } = await supabase
      .from("resources")
      .select("id")
      .eq("user_id", queueItem.user_id)
      .eq("file_url", queueItem.episode_url)
      .limit(1);

    if (existing?.length) {
      // Already imported - mark complete with existing resource
      await supabase
        .from("podcast_import_queue")
        .update({
          status: "complete",
          resource_id: existing[0].id,
          processed_at: new Date().toISOString(),
          error_message: "Already imported (dedup)",
        })
        .eq("id", queueItem.id);

      return new Response(
        JSON.stringify({ processed: 1, result: "skipped_duplicate", resource_id: existing[0].id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Step 2: Classify via existing edge function ──
    let classification: any;
    try {
      const classifyResp = await fetch(`${supabaseUrl}/functions/v1/classify-resource`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ url: queueItem.episode_url }),
      });

      if (!classifyResp.ok) {
        const errText = await classifyResp.text();
        throw new Error(`Classification HTTP ${classifyResp.status}: ${errText}`);
      }

      classification = await classifyResp.json();
      if (classification.error) throw new Error(classification.error);
    } catch (err) {
      await handleFailure(supabase, queueItem, `Classification failed: ${err.message}`);
      return new Response(
        JSON.stringify({ processed: 1, result: "failed", error: err.message }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use episode title if classification returns generic title
    if (!classification.title || classification.title === "Untitled") {
      classification.title = queueItem.episode_title || queueItem.episode_url;
    }

    // ── Step 3: Create resource ──
    let resourceId: string;
    try {
      // Find or create folder
      let folderId: string | null = null;
      if (classification.top_folder) {
        const { data: folders } = await supabase
          .from("resource_folders")
          .select("id")
          .eq("user_id", queueItem.user_id)
          .is("parent_id", null)
          .ilike("name", classification.top_folder)
          .limit(1);
        folderId = folders?.[0]?.id || null;
        if (!folderId) {
          const { data: newF } = await supabase
            .from("resource_folders")
            .insert({ name: classification.top_folder, user_id: queueItem.user_id })
            .select("id")
            .single();
          folderId = newF?.id || null;
        }
      }

      const contentToStore = classification.scraped_content?.length > 50
        ? classification.scraped_content
        : `[External Link: ${queueItem.episode_url}]`;
      const contentStatus = contentToStore.startsWith("[External Link:") ? "placeholder" : "enriched";

      const description = classification.description
        ? `${classification.description}\n\n---\nSource: podcast · Ingested ${new Date().toISOString().split("T")[0]}`
        : `Source: podcast · Ingested ${new Date().toISOString().split("T")[0]}`;

      const insertPayload: Record<string, any> = {
        user_id: queueItem.user_id,
        title: classification.title,
        description,
        resource_type: classification.resource_type || "transcript",
        tags: classification.tags || [],
        folder_id: folderId,
        file_url: queueItem.episode_url,
        content: contentToStore,
        content_status: contentStatus,
      };

      // Add source registry + metadata
      if (queueItem.source_registry_id) {
        insertPayload.source_registry_id = queueItem.source_registry_id;
      }
      if (queueItem.episode_guest) {
        insertPayload.author_or_speaker = queueItem.episode_guest;
      } else if (queueItem.show_author) {
        insertPayload.author_or_speaker = queueItem.show_author;
      }
      if (queueItem.episode_published) {
        insertPayload.source_published_at = queueItem.episode_published;
      }

      const { data: resource, error: insertErr } = await supabase
        .from("resources")
        .insert(insertPayload)
        .select("id")
        .single();

      if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);
      resourceId = resource.id;
    } catch (err) {
      await handleFailure(supabase, queueItem, `Save failed: ${err.message}`);
      return new Response(
        JSON.stringify({ processed: 1, result: "failed", error: err.message }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Step 4: Enrich via existing edge function ──
    try {
      const enrichResp = await fetch(`${supabaseUrl}/functions/v1/enrich-resource-content`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          resource_id: resourceId,
          force: true,
          user_id: queueItem.user_id,
        }),
      });

      if (!enrichResp.ok) {
        const errText = await enrichResp.text();
        console.warn(`Enrichment HTTP ${enrichResp.status}: ${errText}`);
        // Resource is saved, enrichment can be retried later — mark complete with note
      }

      // Even if enrichment fails, the resource exists — mark complete
      await supabase
        .from("podcast_import_queue")
        .update({
          status: "complete",
          resource_id: resourceId,
          processed_at: new Date().toISOString(),
        })
        .eq("id", queueItem.id);

      return new Response(
        JSON.stringify({ processed: 1, result: "complete", resource_id: resourceId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      // Resource saved but enrichment crashed — still mark complete since resource exists
      console.error(`Enrichment error (resource ${resourceId} saved):`, err);
      await supabase
        .from("podcast_import_queue")
        .update({
          status: "complete",
          resource_id: resourceId,
          processed_at: new Date().toISOString(),
          error_message: `Saved but enrichment failed: ${err.message}`,
        })
        .eq("id", queueItem.id);

      return new Response(
        JSON.stringify({ processed: 1, result: "complete_partial", resource_id: resourceId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    console.error("process-podcast-queue fatal error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function handleFailure(supabase: any, item: any, errorMessage: string) {
  const newAttempts = (item.attempts || 0) + 1;
  const newStatus = newAttempts >= MAX_ATTEMPTS ? "failed" : "queued";

  await supabase
    .from("podcast_import_queue")
    .update({
      status: newStatus,
      attempts: newAttempts,
      error_message: errorMessage,
      ...(newStatus === "failed" ? { processed_at: new Date().toISOString() } : {}),
    })
    .eq("id", item.id);

  console.log(`Queue item ${item.id}: ${newStatus} (attempt ${newAttempts}/${MAX_ATTEMPTS}) — ${errorMessage}`);
}
