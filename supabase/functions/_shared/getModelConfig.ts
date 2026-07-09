import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const _serviceClient = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

export const FALLBACK_MODELS = {
  CLAUDE_PRIMARY:  'claude-sonnet-4-6',
  CLAUDE_FAST:     'claude-haiku-4-5-20251001',
  GPT_PRIMARY:     'gpt-4o',
  GEMINI_FLASH:    'google/gemini-2.5-flash',
  GEMINI_PRO:      'google/gemini-2.5-pro',
  SONAR_PRO:       'sonar-pro',
} as const;

export async function getModelConfig(functionName: string): Promise<{
  primary: string;
  fallback: string | null;
}> {
  try {
    const { data } = await _serviceClient()
      .from('function_configs')
      .select('primary_model, fallback_model')
      .eq('function_name', functionName)
      .maybeSingle();
    if (data) return { primary: data.primary_model, fallback: data.fallback_model };
  } catch { /* fall through */ }
  return { primary: FALLBACK_MODELS.CLAUDE_PRIMARY, fallback: null };
}
