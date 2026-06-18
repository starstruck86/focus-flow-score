UPDATE knowledge_items 
SET is_core_ae = false 
WHERE is_core_ae = true 
AND (
  tactic_summary ILIKE '%interview%'
  OR tactic_summary ILIKE '%candidate%'
  OR tactic_summary ILIKE '%job search%'
  OR tactic_summary ILIKE '%getting hired%'
  OR tactic_summary ILIKE '%resume%'
  OR tactic_summary ILIKE '%job offer%'
  OR tactic_summary ILIKE '%salary negotiat%'
  OR tactic_summary ILIKE '%hiring manager%'
  OR tactic_summary ILIKE '%job hunting%'
  OR tactic_summary ILIKE '%land a job%'
  OR tactic_summary ILIKE '%get hired%'
);