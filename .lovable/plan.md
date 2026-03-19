

## Combined Plan: Smart Template System + Folder Governance (Max 8 Top-Level)

This merges two features into one cohesive implementation: enforcing a fixed 8-folder taxonomy with dynamic sub-folders, AND upgrading templates to be DB-backed resources with AI-driven suggestions.

### What Gets Built

**1. Core Folder Taxonomy (constant + enforcement)**

8 fixed top-level folders. No new top-level folders can be created once these exist.

| Folder | Purpose |
|--------|---------|
| Frameworks | MEDDICC, SPIN, value selling |
| Playbooks | Repeatable motion guides, sequences |
| Templates | Emails, cadences, follow-ups, reusable docs |
| Training | Courses, certifications, learning |
| Discovery | Research briefs, persona maps, ICP docs |
| Presentations | Decks, slides, demos |
| Battlecards | Competitive intel, objection handling |
| Tools & Reference | Links, calculators, misc |

Sub-folders are created dynamically within these as needed (e.g., "MEDDICC" under Frameworks, "Cold Outreach" under Templates).

**2. Classify-resource edge function update**

Change `suggested_folder` to return `{ top_folder, sub_folder? }` — top_folder is one of the 8 core names (enum), sub_folder is free-form and optional. Update the system prompt to instruct the AI to always map into this taxonomy.

**3. Folder resolution logic (useResourceUpload.ts)**

Replace the current "create any folder" logic with:
1. Find top-level folder by name (case-insensitive, `parent_id IS NULL`)
2. Create if missing (bootstrap only)
3. If sub_folder provided, find/create it nested under the top-level folder
4. Assign resource to deepest folder

Apply same logic in `useAddUrlResource`.

**4. ResourceManager folder guardrails**

- Hide "New Folder" at root when ≥8 top-level folders exist
- Only allow sub-folder creation inside existing folders
- Core folders get a subtle lock/pin indicator

**5. Templates as DB resources**

Templates are resources with `is_template = true`, organized within the "Templates" core folder. The localStorage template system in PrepHub is replaced.

- New `TemplateManager` component: filtered view of `is_template = true` resources, grouped by `template_category`
- Quick actions: Copy to clipboard, Edit in editor, Duplicate
- Seeding: migrate `DEFAULT_TEMPLATES` from PrepHub into DB on first load if no templates exist

**6. Resource-linked templates**

New column `source_resource_id` on `resources` table — links a template back to the resource it was derived from. UI shows "Based on: [Resource Name]".

**7. AI template suggestions (max 3 active)**

New `template_suggestions` table stores AI-generated opportunities. A `suggest-templates` edge function analyzes recent non-template resources and identifies template gaps (e.g., podcast about ROI → suggest "ROI Executive Summary" template).

- Max 3 active suggestions at any time
- User can: Confirm (auto-generates template), Dismiss
- Shown as cards at the top of the Templates tab
- Triggered on-demand via "Refresh Suggestions" button

**8. ReorganizeModal update**

Pass the core 8-folder taxonomy to the classify prompt so reorganize maps everything into the hierarchy instead of creating arbitrary folders.

### Database Changes

**Migration 1:**
```sql
ALTER TABLE public.resources 
  ADD COLUMN source_resource_id uuid REFERENCES public.resources(id) ON DELETE SET NULL;
```

**Migration 2:**
```sql
CREATE TABLE public.template_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_resource_id uuid REFERENCES public.resources(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL,
  template_category text NOT NULL,
  suggested_content text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.template_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own suggestions" ON public.template_suggestions 
  FOR ALL TO authenticated 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);
```

### Files

| Action | File | Change |
|--------|------|--------|
| Update | `supabase/functions/classify-resource/index.ts` | `suggested_folder` → `{ top_folder (enum of 8), sub_folder? }`, update prompt with taxonomy |
| Update | `src/hooks/useResourceUpload.ts` | New folder resolution: top_folder lookup → sub_folder lookup → create if missing. Export `CORE_FOLDERS` constant. Apply to both file upload and URL upload flows |
| Update | `src/hooks/useResources.ts` | Add `useTemplates()`, `useTemplateSuggestions()` hooks |
| Create | `src/components/prep/TemplateManager.tsx` | Filtered resource view for templates with category grouping, suggestion cards, quick actions |
| Create | `supabase/functions/suggest-templates/index.ts` | Analyzes recent resources via Gemini 3 Flash, returns up to 3 structured template suggestions |
| Update | `src/pages/PrepHub.tsx` | Replace localStorage Templates tab with `TemplateManager` |
| Update | `src/components/prep/ResourceManager.tsx` | Hide root "New Folder" when ≥8 top-level exist, sub-folder creation only inside folders |
| Update | `src/components/prep/ReorganizeModal.tsx` | Pass core taxonomy to classify prompt |
| Update | `supabase/config.toml` | Add `[functions.suggest-templates]` |

### Edge Function: `suggest-templates`

- Fetches recent resources (last 30 days, `is_template = false`)
- Fetches existing templates to avoid duplicates
- Calls Lovable AI (Gemini 3 Flash) with tool calling
- Returns max 3 suggestions: `{ title, description, template_category, source_resource_id, suggested_content }`
- Filters against already-dismissed suggestions

