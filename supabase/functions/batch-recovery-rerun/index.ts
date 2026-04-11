/**
 * batch-recovery-rerun - Staggered dispatcher for extract-tactics
 * Dispatches resources in waves of 2, waiting for each wave to complete.
 */
import { logServiceRoleUsage, logAuthMethod } from '../_shared/securityLog.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESOURCE_IDS = [
  '0afa0161-e561-4ceb-b75f-f2589991cd83','29dc1509-16f7-45c1-a96f-2299dbc7a562',
  'c18f23a0-cbe0-475d-85c6-23d69a6ffc5e','eb780e6f-bbdf-43f9-a96b-ad17fb566a1c',
  'a38e7319-f313-42d7-959c-79f867b7807a','b6087ed8-d683-4269-9198-7da1aff1ab68',
  '95eb1aa3-136f-4aee-8ff8-b90dfa585d67','146bea2e-80d2-421f-8433-3ea948d56332',
  'be377622-97ef-4a4a-b447-ab6aff519617','5de0f677-cded-4eb8-83d1-768c7806bd6a',
  'c3ce5f88-91d3-42b2-bf7e-daab52ee393c','13ee3ee3-e5f4-4284-8740-ff384f4acd4e',
];

const USER_ID = '9f11e308-4028-4527-b7ba-5ea365dc1441';

async function callExtract(supabaseUrl: string, serviceRoleKey: string, resourceId: string) {
  const resp = await fetch(`${supabaseUrl}/functions/v1/extract-tactics`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceRoleKey}`,
      'x-batch-key': serviceRoleKey,
    },
    body: JSON.stringify({ resourceId, jobMode: true, deepMode: true, userId: USER_ID }),
  });
  const data = await resp.json();
  return { id: resourceId, status: resp.status, saved: data.totalSaved || 0, error: data.error || null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const start = parseInt(url.searchParams.get('start') || '0', 10);
  const count = parseInt(url.searchParams.get('count') || '4', 10);
  const slice = RESOURCE_IDS.slice(start, start + count);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  logAuthMethod('batch-recovery-rerun', 'none', { reason: 'hardcoded_recovery_script' });
  logServiceRoleUsage('batch-recovery-rerun', 'single_user', { hardcodedUserId: USER_ID, sliceStart: start, sliceCount: count });

  // Process this small slice in parallel (2-4 at a time is safe)
  const results = await Promise.all(
    slice.map(id => callExtract(supabaseUrl, serviceRoleKey, id))
  );

  const succeeded = results.filter(r => r.status === 200 && !r.error).length;

  return new Response(JSON.stringify({
    slice: `${start}-${start + slice.length}`,
    processed: results.length,
    succeeded,
    failed: results.length - succeeded,
    totalSaved: results.reduce((s, r) => s + r.saved, 0),
    results,
  }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
