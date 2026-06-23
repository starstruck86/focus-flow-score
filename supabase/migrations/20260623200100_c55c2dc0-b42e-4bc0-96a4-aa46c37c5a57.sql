ALTER TABLE public.knowledge_items
  ADD COLUMN IF NOT EXISTS intelligence_type text
  CHECK (intelligence_type IN ('sales', 'product', 'competitive', 'market'));

UPDATE public.knowledge_items SET intelligence_type = CASE
  WHEN spider_dimension IN ('discovery', 'deal_control', 'expansion_strategy', 'stakeholder_navigation', 'messaging', 'internal_prospecting') THEN 'sales'
  WHEN spider_dimension = 'product_knowledge' THEN 'product'
  WHEN spider_dimension = 'competitive' THEN 'competitive'
  ELSE 'sales'
END
WHERE chapter = 'branch_io' AND intelligence_type IS NULL;

CREATE INDEX IF NOT EXISTS knowledge_items_intelligence_type_idx
  ON public.knowledge_items(user_id, intelligence_type, active);