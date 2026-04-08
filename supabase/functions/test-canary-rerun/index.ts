/**
 * test-canary-rerun - Temporary function to trigger extract-tactics reruns
 * for canary resources using service-role auth internally.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CANARY_IDS = [
  '6929d0f0-cdfe-4b56-b9d9-7136393098e9', // Dark Side
  '50789cf2-eb43-4579-9ddc-3071d2af8833', // Spec Sheet
  'e15b8443-eb34-4923-a8f8-6720c66b8734', // Negative Impact
  'a843b23b-6845-4ace-8b7d-69ae627ac006', // Pain Deck
  'eefc3b01-508c-496b-aec5-76184d5786d1', // $300k Deal
];

const USER_ID = '9f11e308-4028-4527-b7ba-5ea365dc1441';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const results: Record<string, any> = {};

  for (const resourceId of CANARY_IDS) {
    try {
      console.log(`[canary] Starting rerun for ${resourceId}`);
      const resp = await fetch(`${supabaseUrl}/functions/v1/extract-tactics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
          'x-batch-key': serviceRoleKey,
        },
        body: JSON.stringify({
          resourceId,
          jobMode: true,
          deepMode: true,
          force: true,
          userId: USER_ID,
        }),
      });
      const data = await resp.json();
      results[resourceId] = { status: resp.status, data };
      console.log(`[canary] ${resourceId}: status=${resp.status}`);
    } catch (err) {
      results[resourceId] = { error: err.message };
      console.error(`[canary] ${resourceId} error:`, err.message);
    }
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
