// To update any model: UPDATE function_configs SET primary_model = '...' WHERE function_name = '...';
// No code change or deploy needed after this infrastructure exists.
export const MODELS = {
  CLAUDE_PRIMARY: 'claude-sonnet-4-6',
  CLAUDE_FAST:    'claude-haiku-4-5-20251001',
  GPT_PRIMARY:    'gpt-4o',
  GEMINI_FLASH:   'google/gemini-2.5-flash',
  GEMINI_PRO:     'google/gemini-2.5-pro',
  SONAR_PRO:      'sonar-pro',
} as const;
export type ModelId = typeof MODELS[keyof typeof MODELS];
