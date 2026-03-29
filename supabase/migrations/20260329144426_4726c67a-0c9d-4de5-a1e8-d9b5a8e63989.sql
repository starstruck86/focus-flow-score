
-- Close orphaned pending attempt rows from Phase 2 validation

-- Zoom: shell_only failure
UPDATE enrichment_attempts SET
  completed_at = now(),
  result = 'failed',
  failure_category = 'zoom_player_shell_only',
  shell_rejected = true,
  content_found = false,
  runtime_config_found = false,
  caption_url_found = false,
  media_url_found = false,
  transcript_url_found = false,
  content_length_extracted = 0
WHERE id = '086e2db3-b4b2-4cb2-ac92-69ea3441977c' AND result = 'pending';

-- Thinkific: succeeded
UPDATE enrichment_attempts SET
  completed_at = now(),
  result = 'success',
  content_found = true,
  content_length_extracted = 2447,
  shell_rejected = false
WHERE id = '128482a0-06ab-4e9c-bfff-085556fe9592' AND result = 'pending';

-- Circle: auth required
UPDATE enrichment_attempts SET
  completed_at = now(),
  result = 'failed',
  failure_category = 'circle_auth_required',
  content_found = false,
  shell_rejected = false
WHERE id = 'cc42cdb7-3f42-46c1-8d7b-b1dd54a6a046' AND result = 'pending';

-- Fix resource advanced_extraction_status from in_progress to correct final state
UPDATE resources SET advanced_extraction_status = 'failed'
WHERE id = '9d51b8bf-ac0e-42a2-97a7-4492bdf94867' AND advanced_extraction_status = 'in_progress';

UPDATE resources SET advanced_extraction_status = 'completed'
WHERE id = '45971e4b-7bc8-49bf-b65d-8fcb9bc1d14f' AND advanced_extraction_status = 'in_progress';

UPDATE resources SET advanced_extraction_status = 'failed'
WHERE id = 'b5726ccc-15b7-4871-960e-e56da37975a0' AND advanced_extraction_status = 'in_progress';
