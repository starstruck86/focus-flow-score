# Edge Function Deploy Groups

Some edge functions share contracts (state formats, auth logic, data schemas)
and **must be deployed together** to avoid version drift.

When editing ANY function in a group, deploy the ENTIRE group.

---

## Group: `whoop` — WHOOP OAuth & Sync

| Function            | Role                                      |
|---------------------|--------------------------------------------|
| `whoop-auth`        | Initiates OAuth, builds HMAC-signed state  |
| `whoop-callback`    | Verifies HMAC state, exchanges code for tokens |
| `whoop-sync`        | Reads tokens, syncs biometric data         |

**Shared contracts:**
- HMAC-SHA256 state signing/verification (key: `WHOOP_CLIENT_SECRET`)
- State payload shape: `{ userId, redirectUri, nonce, v }`
- `whoop_connections` table schema (tokens, scopes)

**Version constant:** `FUNCTION_GROUP_VERSION` in each file.
Bump the version (`whoop-v3`, etc.) when changing any shared contract.

**Runtime drift detection:** `whoop-callback` logs an explicit error if
the state's `v` field doesn't match its own `FUNCTION_GROUP_VERSION`.

---

## Group: `dave` — Dave Voice Assistant

| Function                  | Role                                |
|---------------------------|--------------------------------------|
| `dave-conversation-token` | Fetches ElevenLabs token + CRM context |

**Shared contracts:**
- Session response shape: `{ token, context, firstMessage }`
- Client tools schema (registered in `register-dave-tools`)

**Version constant:** `FUNCTION_GROUP_VERSION` in each file.

---

## How to update

1. Edit any function in the group.
2. Bump `FUNCTION_GROUP_VERSION` in **all** functions in that group.
3. Deploy all functions in the group together.
4. Run `npm test` — the smoke test `function-group-versions` will catch mismatches.
