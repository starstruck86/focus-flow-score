import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_ID = "9f11e308-4028-4527-b7ba-5ea365dc1441";

const TRANSCRIPT_IDS = [
  "9aa66379-8f69-4738-8444-f3f066db83b0",
  "57ebfcd5-7467-4ee5-8ca0-b8be2e04eb84",
  "f6bedf81-a416-413c-b0d6-fdbd30eb388b",
  "e7332574-626d-4511-abaf-d64f950765dd",
  "6917fe97-45c9-4f19-af2b-230075bed0cb",
  "1b82d033-3db4-4d78-b0eb-8ae53fa62ff7",
  "87c2e950-ff23-4bcb-9aa2-0b327720bcd5",
  "344d675a-70af-45a0-a34d-24e5e950e08b",
  "8d00e4b3-8bb2-4731-b3e6-de1d423cb28e",
  "1368520f-90eb-415a-843d-b9c9937761b4",
  "9f471815-e2b7-48e9-90e6-b2b6d8720ec8",
  "9eb3ad98-e2cd-4fcb-bcc0-0b8c8c608dff",
  "4e323b40-f082-408c-b405-8349de0dfd8d",
  "fcf794f4-da40-4364-bdbc-4818e4f40411",
  "fbe93079-1528-4269-83cd-b12e0100035b",
  "3b7b137d-7006-4f14-950c-6d71e704e88e",
  "5764c80b-fdb9-40c5-8961-d454b1ebd704",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

  const results: { id: string; grade?: string; score?: number; error?: string }[] = [];

  for (const transcript_id of TRANSCRIPT_IDS) {
    try {
      // Call grade-transcript using service role key
      const res = await fetch(
        `${supabaseUrl}/functions/v1/grade-transcript`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ transcript_id, user_id: USER_ID }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        results.push({ id: transcript_id, error: err.error || `HTTP ${res.status}` });
        continue;
      }

      const data = await res.json();

      // Stamp regraded_at
      await adminSupabase
        .from("transcript_grades")
        .update({ regraded_at: new Date().toISOString() })
        .eq("transcript_id", transcript_id);

      results.push({
        id: transcript_id,
        grade: data.overall_grade,
        score: data.overall_score,
      });

      // Small delay between calls
      await new Promise((r) => setTimeout(r, 1000));
    } catch (e: any) {
      results.push({ id: transcript_id, error: e.message });
    }
  }

  const succeeded = results.filter((r) => r.grade).length;
  const failed = results.filter((r) => r.error).length;

  return new Response(
    JSON.stringify({ succeeded, failed, results }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
