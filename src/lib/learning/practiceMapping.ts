import type { SkillFocus } from '@/lib/dojo/scenarios';

export type RecommendedMode = 'drill' | 'roleplay' | 'objection-reps' | 'mock-call';

interface PracticeMapping {
  skillFocus: SkillFocus;
  recommendedMode: RecommendedMode;
  label: string;
}

const TOPIC_TO_PRACTICE: Record<string, PracticeMapping> = {
  objection_handling: {
    skillFocus: 'objection_handling',
    recommendedMode: 'objection-reps',
    label: 'Objection Reps',
  },
  discovery: {
    skillFocus: 'discovery',
    recommendedMode: 'roleplay',
    label: 'Discovery Roleplay',
  },
  executive_response: {
    skillFocus: 'executive_response',
    recommendedMode: 'roleplay',
    label: 'Executive Roleplay',
  },
  deal_control: {
    skillFocus: 'deal_control',
    recommendedMode: 'roleplay',
    label: 'Deal Control Roleplay',
  },
  qualification: {
    skillFocus: 'qualification',
    recommendedMode: 'drill',
    label: 'Qualification Drill',
  },
};

export function getPracticeMapping(topic: string): PracticeMapping {
  return TOPIC_TO_PRACTICE[topic] ?? {
    skillFocus: 'objection_handling' as SkillFocus,
    recommendedMode: 'drill' as RecommendedMode,
    label: 'Quick Drill',
  };
}

export interface LessonContext {
  fromLesson: true;
  lessonId: string;
  lessonTitle: string;
  skillFocus: SkillFocus;
  recommendedMode: RecommendedMode;
  modeLabel: string;
}
