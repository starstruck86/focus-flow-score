

## Fix: "All Resources" View Shows All Resources

### Problem
When you're at the root "All Resources" level (`currentFolderId = null`), the query filters for `folder_id IS NULL` — meaning it only shows resources that have no folder assigned. Any resource with a folder (including ones moved by the Reorganize feature) disappears from the root view.

### Solution
Change the `ResourceManager` component to pass `undefined` (not `null`) as the folder filter when at the root level. In `useResources`, `undefined` means "fetch all resources" while `null` means "fetch unfiled only."

### Changes

**`src/components/prep/ResourceManager.tsx`**
- Change the initial state and root-level behavior: when at "All Resources" root, pass `undefined` to `useResources` instead of `null`
- This makes the root view show every resource regardless of folder assignment
- When navigating into a specific folder, pass that folder's ID as before

This is a one-line logic fix — the `useResources` hook already supports `undefined` (no filter) vs `null` (unfiled only) vs `string` (specific folder). The component just needs to use the right value at root level.

