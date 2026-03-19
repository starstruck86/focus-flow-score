

## Plan: Bulk Add Resources & Links

Currently, both file upload and URL addition are single-item only. This plan adds bulk support for both.

### Changes

**`src/components/prep/ResourceManager.tsx`**

1. **Bulk URL input**: Replace the single URL dialog with a textarea that accepts multiple URLs (one per line). On submit, classify and queue all URLs in parallel (batches of 3), showing a progress indicator. Each classified item appears in a review list where the user can edit titles before confirming all at once.

2. **Bulk file upload**: Change the hidden file input to accept `multiple`. When multiple files are selected, classify them all in parallel (batches of 3) and queue them into the same review list.

3. **Batch review panel**: Replace the single `pendingClassification` state with an array (`pendingItems[]`). The confirmation UI shows a scrollable list of all pending items with editable titles, a "Remove" button per item, and a single "Confirm All" button at the bottom. Items show a spinner while still classifying.

**`src/hooks/useResourceUpload.ts`**

4. No structural changes needed — the existing `useUploadResource` and `useAddUrlResource` hooks already handle single items. The component will call them in a loop for each confirmed item.

### UI Flow

```text
User clicks "Add" → "Add Links / URLs"
┌──────────────────────────────┐
│ Add Links                    │
│ ┌──────────────────────────┐ │
│ │ https://url1.com         │ │
│ │ https://url2.com         │ │
│ │ https://url3.com         │ │
│ └──────────────────────────┘ │
│ Paste one URL per line       │
│              [Classify All]  │
└──────────────────────────────┘

→ Shows batch review panel with all items
→ User edits titles as needed
→ "Confirm All" saves everything
```

### Files Changed

- `src/components/prep/ResourceManager.tsx` — bulk URL textarea, multi-file input, batch review panel

