/**
 * Dojo Chunk Pacing — conversational timing between coaching chunks.
 *
 * Makes Dave feel like a real coach by adding natural pauses between
 * different types of coaching content. Feedback gets a beat to land,
 * practice cues are snappy and directive.
 *
 * Scoped to Sales Dojo only.
 */

import type { SpeechChunk } from './conversationEngine';

/** Delay (ms) before speaking a chunk, based on its role and context. */
export function getInterChunkDelay(
  chunk: SpeechChunk,
  previousChunkRole?: string,
  isFirstChunk?: boolean
): number {
  // First chunk should feel immediate
  if (isFirstChunk) return 100;

  const role = chunk.role;

  // After feedback, pause to let the score land
  if (previousChunkRole === 'feedback') return 500;

  // Before world-class response — brief pause for emphasis
  if (role === 'worldClassResponse') return 450;

  // Practice cue should feel punchy and directive
  if (role === 'practiceCue') return 250;

  // Improved version — moderate pause
  if (role === 'improvedVersion') return 350;

  // Feedback — standard coaching beat
  if (role === 'feedback') return 300;

  // Default natural pause
  return 300;
}

/**
 * Returns true if the user should see a brief "thinking" indicator
 * before this chunk plays (for chunks that benefit from anticipation).
 */
export function shouldShowThinkingTransition(chunk: SpeechChunk): boolean {
  return chunk.role === 'feedback' || chunk.role === 'worldClassResponse';
}
