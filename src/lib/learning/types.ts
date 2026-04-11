export interface LessonContent {
  concept: string;
  what_good_looks_like: string;
  breakdown: string;
  when_to_use: string;
  when_not_to_use: string;
}

export interface MCQuestion {
  id: string;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
}

export interface QuizContent {
  mc_questions: MCQuestion[];
  open_ended_prompt: string;
  rubric: string;
  answer_key?: string;
}

export interface LearningCourse {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  topic: string;
  difficulty_level: string;
  is_active: boolean;
  created_at: string;
}

export interface LearningModule {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  order_index: number;
  created_at: string;
}

export interface LearningLesson {
  id: string;
  module_id: string;
  title: string;
  topic: string;
  difficulty_level: string;
  order_index: number;
  lesson_content: LessonContent | null;
  quiz_content: QuizContent | null;
  source_ki_ids: string[];
  generation_status: string;
  generated_at: string | null;
  generation_model: string | null;
  is_active: boolean;
  created_at: string;
}

export interface LearningProgress {
  id: string;
  user_id: string;
  lesson_id: string;
  status: 'not_started' | 'in_progress' | 'completed';
  mastery_score: number | null;
  last_attempt_at: string | null;
  created_at: string;
}

export interface LearningQuizAnswer {
  id: string;
  user_id: string;
  lesson_id: string;
  question_type: string;
  question_id: string;
  user_answer: any;
  is_correct: boolean | null;
  ai_feedback: string | null;
  score: number | null;
  created_at: string;
}

export interface CourseWithModules extends LearningCourse {
  learning_modules: (LearningModule & {
    learning_lessons: LearningLesson[];
  })[];
}
