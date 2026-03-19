

## Resource Builder V3 — Full Implementation Plan

### Summary
Transform the plain-text ResourceEditor into a professional AI-powered document studio with 10 upgrades: rich text editing, AI generation with resource context, multi-format export, templates, CRM linking, slash commands, reference panel, auto-save, resource merging, and smart suggestions.

### What Gets Built

**New Files (7)**

| File | Purpose |
|------|---------|
| `src/components/prep/RichTextEditor.tsx` | TipTap WYSIWYG editor with formatting toolbar, bubble menu, slash commands |
| `src/components/prep/AIGenerateDialog.tsx` | Prompt + resource picker + output type selector, streams AI into editor |
| `src/components/prep/ExportMenu.tsx` | Dropdown: PDF (styled print), DOCX (docx lib), PPTX (pptxgenjs) |
| `src/components/prep/TemplatePicker.tsx` | Visual gallery of starter templates (Discovery, QBR, ROI, Email, etc.) |
| `src/components/prep/SmartSuggestionsPanel.tsx` | AI sidebar analyzing content, suggesting missing sections |
| `src/components/prep/EditorFooter.tsx` | Word count, reading time, auto-save status indicator |
| `supabase/functions/build-resource/index.ts` | Edge function: AI generation, inline commands, merge, suggestions via Lovable AI |

**Modified Files (3)**

| File | Changes |
|------|---------|
| `src/components/prep/ResourceEditor.tsx` | Full overhaul — integrate TipTap, AI dialog, export menu, templates, reference panel, CRM linking, auto-save |
| `src/components/prep/ResourceManager.tsx` | Add merge action for multi-selected resources, template picker in new resource flow |
| `supabase/config.toml` | Add `[functions.build-resource] verify_jwt = false` |

**Dependencies to Install**
- TipTap: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-table`, `@tiptap/extension-table-row`, `@tiptap/extension-table-cell`, `@tiptap/extension-table-header`, `@tiptap/extension-link`, `@tiptap/extension-placeholder`, `@tiptap/extension-underline`, `@tiptap/extension-text-align`, `@tiptap/extension-image`, `@tiptap/extension-highlight`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item`
- Conversion: `turndown`, `showdown`, `@types/turndown`, `@types/showdown`
- Export: `docx`, `pptxgenjs`, `file-saver`, `@types/file-saver`

### Technical Details

**Content Storage Strategy**
- DB stores markdown (no schema changes needed)
- On load: `showdown` converts markdown → HTML for TipTap
- On save: `turndown` converts HTML → markdown for DB
- Existing `useUpdateResource` hook works as-is

**Edge Function: `build-resource`**
- Accepts `{ type, prompt, outputType, resourceIds[], accountContext?, content?, documentType? }`
- Types: `generate` (full doc), `inline` (slash cmd), `merge` (combine resources), `suggest` (structured suggestions via tool calling)
- Fetches selected resources from DB using supabase service client
- Streams via Lovable AI Gateway (Gemini 3 Flash Preview) for generate/inline/merge
- Returns structured JSON via tool calling for suggest
- Handles 429/402 errors with user-friendly messages

**Rich Text Editor**
- TipTap with StarterKit + Table, Link, Placeholder, Underline, TextAlign, Image, Highlight, TaskList
- Formatting toolbar: Bold, Italic, Underline, Strikethrough, H1-H3, Bullet/Ordered List, Task List, Table, Blockquote, Code, Link, Image, Align, Highlight, Undo/Redo
- Bubble menu on text selection for quick formatting
- Slash commands (`/`) open a suggestions dropdown → calls edge function with selected text

**Export Logic**
- PDF: Styled print window with professional CSS (fonts, spacing, tables)
- DOCX: Parse markdown → `docx` library Document with heading styles, lists, tables, bold/italic. Downloads .docx
- PPTX: Split content at H1/H2 → slides via `pptxgenjs`. Clean theme with app accent colors. Downloads .pptx

**CRM Linking**
- Account/Opportunity select dropdowns in editor header using existing `useAccountsData` store
- When linked, AI generation auto-injects account name, industry, contacts, deal stage
- Updates resource's `account_id`/`opportunity_id` via existing update mutation

**Template Library**
- 8 built-in templates: Discovery Prep, Follow-Up Email, QBR Deck, ROI Analysis, Executive Summary, Competitive Pitch, Cold Outreach, Meeting Recap
- Each = structured markdown skeleton with placeholders
- "Fill with AI" option when account is linked

**Reference Panel**
- Toggle button shows resizable split pane (editor left, resource browser right)
- Uses existing `ResizablePanel` UI component
- Browse and open any resource read-only alongside your working document

**Smart Suggestions**
- Collapsible right sidebar
- Calls edge function with `type: "suggest"` + current content + document type
- Returns structured array of suggestions via tool calling
- Displays as actionable cards with "Apply" buttons

**Auto-save**
- 2-second debounce after last keystroke
- Footer shows: "Saving..." / "Saved" / word count / reading time

### Implementation Order
1. Install dependencies
2. Create `build-resource` edge function + config.toml update
3. Create `RichTextEditor.tsx` (TipTap + toolbar + bubble menu)
4. Create `EditorFooter.tsx` (stats + save indicator)
5. Create `ExportMenu.tsx` (PDF/DOCX/PPTX)
6. Create `AIGenerateDialog.tsx` (prompt + resource picker + streaming)
7. Create `TemplatePicker.tsx` (template gallery)
8. Create `SmartSuggestionsPanel.tsx` (AI suggestions sidebar)
9. Overhaul `ResourceEditor.tsx` (integrate everything: TipTap, auto-save, CRM linking, reference panel, slash commands)
10. Update `ResourceManager.tsx` (merge action, template picker in new resource flow)

