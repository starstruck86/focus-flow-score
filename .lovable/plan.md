

## Plan: Smart Resource Library — Upload, Auto-Classify, Viewer, and Deep AI Q&A

This is a large feature set. Here's the implementation broken into phases.

---

### Phase 1: Edge Function — `classify-resource`

**New file: `supabase/functions/classify-resource/index.ts`**

- Accepts `{ text, filename, url, existingTitle, existingTags }` 
- Uses Lovable AI (Gemini 2.5 Flash) with tool calling to return structured output:
  - `title` — standardized name (e.g., "MEDDICC Framework - Deal Qualification")
  - `description` — 1-2 sentence summary
  - `resource_type` — one of: `document`, `playbook`, `framework`, `battlecard`, `template`, `training`, `transcript`, `presentation`, `email`
  - `tags` — e.g., `["meddicc", "deal-qualification", "enterprise"]`
  - `suggested_folder` — e.g., "Frameworks", "Training Courses"
- Works for new uploads, URL pastes, AND retroactive re-classification

---

### Phase 2: File Upload + URL Paste + Auto-Organization

**Update `src/hooks/useResources.ts`:**
- `useUploadResource()` — uploads file to `resource-files` bucket → reads text client-side (txt/md/csv) → calls classify edge function → auto-creates folder if needed → inserts resource with `file_url` + extracted `content`
- `useAddUrlResource()` — accepts URL → classifies based on URL path/domain → saves resource with `file_url` as external link
- `useResourceFileUrl(path)` — generates signed URLs from private bucket
- `useReorganizeLibrary()` — batch-sends all existing resources to classify, returns proposed changes

**Update `src/components/prep/ResourceManager.tsx`:**
- Replace "New Resource" button with dropdown: "New Resource" | "Upload File" | "Add Link/URL"
- Upload accepts `.pdf`, `.docx`, `.pptx`, `.txt`, `.md`, `.csv`
- URL paste flow: input field, auto-detect Google Drive/Docs/Sheets/Notion/Thinkific
- After classification, show confirmation dialog with AI-suggested title/type/folder/tags — user can accept or tweak
- Add "Reorganize Library" button in toolbar that batch-classifies all existing resources, shows before/after diff modal
- Add expanded resource type icons: `training` (GraduationCap), `playbook` (BookOpen), `framework` (Target), `battlecard` (Shield), `transcript` (MessageSquare)

---

### Phase 3: Resource File Viewer

**New file: `src/components/prep/ResourceFileViewer.tsx`**

- Full panel (replaces editor view when resource has `file_url`)
- Uploaded files: signed URL for download, PDF via `<iframe>`, text/markdown rendered inline
- External URLs (Google Drive, Thinkific, etc.): "Open in new tab" button + stored description + content
- Shows metadata: type badge, tags, folder, description, upload date
- Edit metadata button to adjust title/tags/folder

---

### Phase 4: Deep AI Q&A — Resource Content in Copilot

**Update `supabase/functions/territory-copilot/index.ts`:**
- Replace `resource_links` fetch with `resources` table fetch (title + content + tags + resource_type + description)
- Add keyword matching: when user mentions a resource name or topic, prioritize that resource's full content in the prompt
- Add new copilot mode: `"resource-qa"` — system prompt instructs AI to teach, synthesize, and apply framework content
- Include top 5 keyword-matched resources with up to ~4000 chars each in the system prompt
- For questions like "what would Ian Koniak say" — AI adopts the persona/principles from the named resource

**Update `src/lib/territoryCopilot.ts`:**
- Add `"resource-qa"` mode config: label "Resource Q&A", icon "📚", description "Learn from your playbooks & training"
- Add resource-aware suggested questions to all page contexts
- Add prep-hub specific suggestions: "Teach me MEDDICC", "What are the key lessons from [resource]?", "Apply [framework] to my top deal"

**Update `src/contexts/CopilotContext.tsx`:**
- Add `"resource-qa"` to CopilotMode type (flows from territoryCopilot.ts)

---

### Phase 5: Retroactive Re-Classification

**New component: `src/components/prep/ReorganizeModal.tsx`**
- Triggered by "Reorganize Library" button
- Fetches all resources, sends each to classify edge function
- Shows a scrollable list with before → after for each resource (title, folder, type, tags)
- "Accept All" / "Accept Individual" / "Skip" controls
- On accept: batch-updates resources and auto-creates any missing folders

---

### Technical Details

- No DB migration needed — `resources` table already has all fields (`title`, `content`, `description`, `tags`, `resource_type`, `file_url`, `folder_id`)
- Storage bucket `resource-files` already exists (private)
- AI classification uses `LOVABLE_API_KEY` with Gemini 2.5 Flash (tool calling for structured output)
- Resource Q&A uses Gemini 2.5 Pro for deeper reasoning
- Text extraction: `.txt`/`.md`/`.csv` read client-side via `FileReader`; PDF/DOCX uploaded to bucket then content stored as-is (text extraction best-effort)
- Max file size: 20MB
- The copilot currently fetches `resource_links` (line 506) — this will be changed to fetch `resources` table instead, giving the AI access to full content, not just URLs

