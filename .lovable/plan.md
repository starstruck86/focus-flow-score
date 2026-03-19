

# Test and Optimize Dave — Stress Test Plan

## Issues Found

### Critical: 6 client tools fire events with NO listeners
`voice-update-account`, `voice-update-opportunity`, `voice-debrief`, `voice-add-note`, `voice-start-roleplay`, `voice-start-drill`, `voice-grade-call` — these `CustomEvent` dispatches go nowhere. Only `voice-create-task` and `voice-quick-log` have listeners in `GlobalFAB.tsx`. When Dave calls these tools, the user gets a toast but nothing actually happens in the database.

### Critical: `create_task` only opens a modal — doesn't actually create
The `voice-create-task` handler in GlobalFAB just opens the Add Task dialog. The pre-filled title from the voice command is never passed to the dialog component — it's checked (`detail?.title`) but discarded.

### Bug: `update_account` and `update_opportunity` are fire-and-forget
These tools show a toast and dispatch an event, but no code catches the event to perform the actual database update. Dave tells the user "Updated Acme's next step" but nothing changes.

### Bug: `debrief` and `add_note` similarly unhandled
Same pattern — toast shown, event dispatched, no listener, no persistence.

### Bug: Auto-reconnect calls `startConversation` which references stale closure
The `onDisconnect` callback captures `startConversation` via closure, but `startConversation` isn't in the dependency array of `useConversation`. This could cause stale state during reconnects.

### Improvement: No voice dismissal support
The memory mentions Dave should support "we're done" / "thanks Dave" voice dismissal, but there's no client-side detection for these phrases.

---

## Plan

### Step 1: Wire up client tools to actually persist data

For `update_account`, `update_opportunity`, `add_note`, and `debrief` — replace the fire-and-forget `CustomEvent` pattern with direct database writes inside the client tool callbacks:

- **`update_account`**: Query `accounts` table by name + user_id, update the specified