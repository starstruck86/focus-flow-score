
-- Add review_status column to knowledge_items
ALTER TABLE public.knowledge_items 
ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'unreviewed';

-- Add index for review filtering
CREATE INDEX IF NOT EXISTS idx_knowledge_items_review_status 
ON public.knowledge_items (review_status);
