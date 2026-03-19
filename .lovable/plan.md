

## Fix: Surface All 70 Existing Resource Links in the Resource Manager

### Problem
Your 70 Google Drive links, docs, and references are stored in the older `resource_links` table (with columns: `label`, `url`, `category`, `notes`). The new Smart Resource Library reads from the `resources` table, which only has 1 entry. The two tables were never connected.

### Solution
Two-part fix:

**1. One-time data migration** — Copy all 70 `resource_links` rows into the `resources` table via a SQL migration:

```sql
INSERT INTO resources (user_id, title, content, file_url, resource_type, description, tags)
SELECT 
  user_id,
  label,                              -- label → title
  COALESCE(notes, ''),                -- notes → content
  url,                                -- url → file_url (external link)
  CASE category
    WHEN 'playbook' THEN 'playbook'
    WHEN 'training' THEN 'training'
    WHEN 'battlecard' THEN 'battlecard'
    WHEN 'framework' THEN 'framework'
    ELSE 'document'
  END,                                -- category → resource_type
  'Migrated from resource links',     -- description
  ARRAY[category]                     -- category → tags
FROM resource_links
WHERE NOT EXISTS (
  SELECT 1 FROM resources r 
  WHERE r.user_id = resource_links.user_id 
    AND r.file_url = resource_links.url
);
```

This is a non-destructive migration — it won't duplicate if run twice (checked by `file_url` match), and the original `resource_links` table stays intact for backward compatibility.

**2. Update ResourceManager to show external links properly** — The existing `ResourceFileViewer` already handles external URLs with "Open in New Tab" buttons, so migrated links will display correctly.

### What You'll See After
All 70 Google Drive docs, sheets, slides, and other links will appear in the "All Resources" root view alongside your Follow Up Email. They'll be browsable, searchable, and available for AI Q&A via the copilot.

### Files Changed
- **1 SQL migration** — Inserts `resource_links` rows into `resources`
- No code changes needed — the viewer and hooks already support external URLs

