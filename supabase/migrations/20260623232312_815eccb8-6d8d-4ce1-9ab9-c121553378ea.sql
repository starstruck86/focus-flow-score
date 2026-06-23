ALTER TABLE public.transcript_grades
  ADD COLUMN IF NOT EXISTS branch_expansion_hypothesis_score integer,
  ADD COLUMN IF NOT EXISTS branch_product_fit_score integer,
  ADD COLUMN IF NOT EXISTS branch_value_prop_score integer,
  ADD COLUMN IF NOT EXISTS branch_objection_handling_score integer,
  ADD COLUMN IF NOT EXISTS branch_coaching_note text;