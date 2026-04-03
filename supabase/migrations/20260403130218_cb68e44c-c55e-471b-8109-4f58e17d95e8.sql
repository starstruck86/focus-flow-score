-- Add batch tracking and pipeline stage to podcast import queue
ALTER TABLE podcast_import_queue 
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES batch_runs(id),
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT DEFAULT 'queued';

-- Index for batch lookups and pipeline stage filtering
CREATE INDEX IF NOT EXISTS idx_podcast_import_queue_batch_id ON podcast_import_queue(batch_id);
CREATE INDEX IF NOT EXISTS idx_podcast_import_queue_pipeline_stage ON podcast_import_queue(pipeline_stage);