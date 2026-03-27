/**
 * Voice Response Optimizer
 *
 * Formats Dave's responses for spoken delivery.
 * Optimized for auditory comprehension — short, decisive, structured.
 */

export type VoiceVerbosity = 'concise' | 'normal' | 'detailed';

let currentVerbosity: VoiceVerbosity = 'concise';

export function setVoiceVerbosity(v: VoiceVerbosity) { currentVerbosity = v; }
export function getVoiceVerbosity(): VoiceVerbosity { return currentVerbosity; }

/**
 * System prompt addendum for voice-optimized responses.
 * Injected into Dave's instructions when in voice mode.
 */
export function getVoiceSystemPrompt(): string {
  const base = `
VOICE RESPONSE RULES:
- You are speaking, not writing. Optimize for the ear.
- Default structure: (1) top recommendation, (2) one reason, (3) one next action.
- Avoid bullet lists unless explicitly asked.
- Use natural transitions ("Here's the thing...", "The key issue is...").
- Numbers: say "nine AM" not "09:00", "fifty K" not "$50,000".
- Keep responses under 30 seconds of speaking time (~75 words) unless asked for more.
- Never say "Here's a markdown list" or reference formatting.
`;

  if (currentVerbosity === 'concise') {
    return base + '\n- EXTRA SHORT: Max 2-3 sentences. Lead with the action. Skip reasoning unless asked.';
  }
  if (currentVerbosity === 'detailed') {
    return base + '\n- DETAILED MODE: Provide full reasoning, alternatives considered, and supporting data. Still speak naturally.';
  }
  return base;
}

/**
 * Process a meta-intent to adjust voice behavior.
 * Returns a spoken acknowledgment or null if not handled.
 */
export function handleVoiceMetaIntent(meta: string): string | null {
  switch (meta) {
    case 'shorter':
      setVoiceVerbosity('concise');
      return 'Got it, keeping it short.';
    case 'more-detail':
      setVoiceVerbosity('detailed');
      return 'Sure, I\'ll give you more detail.';
    case 'summarize':
      setVoiceVerbosity('concise');
      return null; // handled by re-prompting
    case 'stop':
      return 'Okay, stopping.';
    case 'pause':
      return 'Paused. Say "continue" when you\'re ready.';
    case 'resume':
    case 'continue':
      return null; // handled by resuming last response
    case 'repeat':
      return null; // handled by replaying last response
    case 'go-back':
      return null; // handled by context system
    default:
      return null;
  }
}
