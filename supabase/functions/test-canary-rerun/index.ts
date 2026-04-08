/**
 * test-canary-rerun - Trigger extract-tactics for a single canary resource
 * Pass ?index=0..4 to select which canary to run
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CANARIES = [
  { id: '6929d0f0-cdfe-4b56-b9d9-7136393098e9', title: 'Dark Side' },
  { id: '50789cf2-eb43-4579-9ddc-3071d2af8833', title: 'Spec Sheet' },
  { id: 'e15b8443-eb34-4923-a8f8-6720c66b8734', title: 'Negative Impact' },
  { id: 'a843b23b-6845-4ace-8b7d-69ae627ac006', title: 'Pain Deck' },
  { id: 'eefc3b01-508c-496b-aec5-76184d5786d1', title: '$300k Deal' },
];

const USER_ID = '9f11e308-4028-4527-b7ba-5ea365dc1441';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const index = parseInt(url.searchParams.get('index') || '0', 10);
  const canary = CANARIES[index];
  if (!canary) {
    return new Response(JSON.stringify({ error: 'Invalid index' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  console.log(`[canary] Starting rerun for ${canary.title} (${canary.id})`);
  
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/extract-tactics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
        'x-batch-key': serviceRoleKey,
      },
      body: JSON.stringify({
        resourceId: canary.id,
        jobMode: true,
        deepMode: true,
        userId: USER_ID,
      }),
    });
    const data = await resp.json();
    console.log(`[canary] ${canary.title}: status=${resp.status}`, JSON.stringify(data));
    return new Response(JSON.stringify({ canary: canary.title, status: resp.status, data }, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(`[canary] ${canary.title} error:`, err.message);
    return new Response(JSON.stringify({ canary: canary.title, error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
