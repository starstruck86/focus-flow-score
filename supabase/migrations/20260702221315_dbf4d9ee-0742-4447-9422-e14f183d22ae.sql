ALTER TABLE public.curriculum_gates ALTER COLUMN pass_threshold SET DEFAULT 85;
UPDATE public.curriculum_gates SET pass_threshold = 85 WHERE pass_threshold = 80;