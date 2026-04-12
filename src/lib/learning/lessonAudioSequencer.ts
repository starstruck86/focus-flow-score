/**
 * Lesson Audio Sequencer — Converts lesson content into speakable chunks
 * for Dave to deliver sequentially.
 *
 * Maps the 7-point lesson structure to audio sections:
 * 1. concept → "Here's the concept..."
 * 2. what_good_looks_like → "Here's what good looks like..."
 * 3. breakdown → "Here's why this works..."
 * 4. when_to_use → "Use this when..."
 * 5. when_not_to_use → "Avoid this when..."
 * 6. quiz intro → "Let me test you on this..."
 * 7. open-ended prompt → "Now apply this..."
 *
 * All text comes from system-generated lesson content.
 * Dave adds no logic — only delivers.
 */

import type { LessonContent, QuizContent, MCQuestion } from './types';

export interface LessonAudioSection {
  id: string;
  role: 'concept' | 'example' | 'breakdown' | 'usage' | 'anti_usage' | 'quiz_intro' | 'quiz_question' | 'quiz_answer' | 'application_prompt' | 'handoff';
  label: string;
  text: string;
  /** If true, pause after this section and wait for user action */
  pauseAfter: boolean;
  /** If set, this section expects a user response */
  expectsInput?: 'mc' | 'open_ended';
  /** For MC questions, the question data */
  mcQuestion?: MCQuestion;
}

export function buildLessonAudioSections(
  lessonId: string,
  content: LessonContent,
  quiz: QuizContent | null,
): LessonAudioSection[] {
  const sections: LessonAudioSection[] = [];

  // 1. Concept
  sections.push({
    id: `${lessonId}:concept`,
    role: 'concept',
    label: 'Core Concept',
    text: content.concept,
    pauseAfter: false,
  });

  // 2. Example
  sections.push({
    id: `${lessonId}:example`,
    role: 'example',
    label: 'What Good Looks Like',
    text: content.what_good_looks_like,
    pauseAfter: false,
  });

  // 3. Breakdown
  sections.push({
    id: `${lessonId}:breakdown`,
    role: 'breakdown',
    label: 'Why It Works',
    text: content.breakdown,
    pauseAfter: false,
  });

  // 4. When to use
  sections.push({
    id: `${lessonId}:usage`,
    role: 'usage',
    label: 'When to Use',
    text: content.when_to_use,
    pauseAfter: false,
  });

  // 5. When NOT to use
  sections.push({
    id: `${lessonId}:anti_usage`,
    role: 'anti_usage',
    label: 'When to Avoid',
    text: content.when_not_to_use,
    pauseAfter: false,
  });

  // 6. Quiz questions (MC)
  if (quiz?.mc_questions?.length) {
    sections.push({
      id: `${lessonId}:quiz_intro`,
      role: 'quiz_intro',
      label: 'Quiz Time',
      text: `Let me test you on this. I've got ${quiz.mc_questions.length} quick questions.`,
      pauseAfter: false,
    });

    quiz.mc_questions.forEach((q, i) => {
      const optionsText = q.options.map(o => o).join('. ');
      sections.push({
        id: `${lessonId}:quiz_q_${i}`,
        role: 'quiz_question',
        label: `Question ${i + 1}`,
        text: `${q.question} Your options are: ${optionsText}`,
        pauseAfter: true,
        expectsInput: 'mc',
        mcQuestion: q,
      });
    });
  }

  // 7. Open-ended application
  if (quiz?.open_ended_prompt) {
    sections.push({
      id: `${lessonId}:application`,
      role: 'application_prompt',
      label: 'Apply It',
      text: quiz.open_ended_prompt,
      pauseAfter: true,
      expectsInput: 'open_ended',
    });
  }

  return sections;
}

/** Build the handoff speech when transitioning from Learn to Dojo */
export function buildHandoffText(): string {
  return "Good — now let's put this into practice. I'm going to give you a scenario. Respond like you would on a real call.";
}
