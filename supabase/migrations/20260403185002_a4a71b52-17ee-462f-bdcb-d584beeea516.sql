UPDATE resources 
SET content = (
  SELECT 
    CASE 
      WHEN POSITION(E'\n\n--- Video Transcript ---\n\n' IN content) > 0 
      THEN 
        -- Replace body (before marker) with placeholder; keep transcript
        E'[BODY_PLACEHOLDER]' || E'\n\n--- Video Transcript ---\n\n' || SPLIT_PART(content, E'\n\n--- Video Transcript ---\n\n', 2)
      ELSE content
    END
  FROM resources sub WHERE sub.id = resources.id
),
title = 'Account Scoring',
updated_at = now()
WHERE id = '3d5cfab0-9cfa-4c8b-b554-a49131e73f75';
