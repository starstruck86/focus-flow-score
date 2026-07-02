-- Item 5 — TTS speakability: convert parenthetical asides in drill_teach_script COPIES
-- to comma phrases. Canonical curriculum_concepts.model_line_plain is untouched.
-- Scan showed only ID06 contains parentheses ("Azure AD (Entra ID)").
UPDATE public.ki_curriculum
SET drill_teach_script = REPLACE(drill_teach_script, 'Azure AD (Entra ID)', 'Azure AD, also called Entra ID')
WHERE concept_id = 'ID06'
  AND drill_teach_script LIKE '%Azure AD (Entra ID)%';