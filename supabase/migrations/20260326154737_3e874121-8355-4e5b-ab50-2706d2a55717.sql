-- Repair auth-gated circle.so resources: mark as not_enriched with failure_reason
UPDATE resources 
SET enrichment_status = 'not_enriched',
    failure_reason = 'Auth-gated source (circle.so) — cannot be automatically enriched',
    content_status = 'placeholder'
WHERE file_url LIKE '%circle.so%'
AND enrichment_status = 'incomplete';

-- Also mark the YouTube resources that repeatedly failed with proper reasons  
UPDATE resources
SET failure_reason = 'YouTube transcript extraction limited — Firecrawl returns insufficient content'
WHERE id IN ('fa13db2b-3552-40bf-8279-983d1b3beead', '92258be7-6920-4940-8d7c-c8a229b1ca0a')
AND enrichment_status = 'incomplete';