// Shared JWT auth helper for edge functions.
// Rejects with 401 if no valid Bearer token is present.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const defaultCors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id',
};

export interface RequireUserOk {
  ok: true;
  userId: string;
  authHeader: string;
  supabaseUser: SupabaseClient;
}
export interface RequireUserErr {
  ok: false;
  response: Response;
}
export type RequireUserResult = RequireUserOk | RequireUserErr;

export async function requireUser(
  req: Request,
  cors: Record<string, string> = defaultCors,
): Promise<RequireUserResult> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      }),
    };
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await supabaseUser.auth.getUser();
  if (error || !user) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      }),
    };
  }
  return { ok: true, userId: user.id, authHeader, supabaseUser };
}
