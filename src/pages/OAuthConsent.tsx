import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SafePage } from "@/components/SafePage";

// REST-based OAuth consent implementation.
// The browser client has not reliably exposed the OAuth helper namespace in
// production bundles, so this page talks to the auth OAuth REST endpoints
// directly with the signed-in user's access token.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

async function authFetch(path: string, accessToken: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep null */ }
  if (!res.ok) {
    const message = json?.error_description || json?.message || json?.error || `HTTP ${res.status}`;
    return { data: null as any, error: { message } };
  }
  return { data: json, error: null as null };
}

async function fetchAuthorizationRequest(id: string, token: string) {
  return authFetch(`/oauth/authorizations/${encodeURIComponent(id)}`, token);
}
async function approveAuthorization(id: string, token: string) {
  return authFetch(`/oauth/authorizations/${encodeURIComponent(id)}/consent`, token, {
    method: "POST",
    body: JSON.stringify({ action: "approve" }),
  });
}
async function denyAuthorization(id: string, token: string) {
  return authFetch(`/oauth/authorizations/${encodeURIComponent(id)}/consent`, token, {
    method: "POST",
    body: JSON.stringify({ action: "deny" }),
  });
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("Missing authorization_id");
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return setError("Auth is not configured for this build.");

      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess.session?.access_token;
      if (!accessToken) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      setToken(accessToken);

      const { data, error } = await fetchAuthorizationRequest(authorizationId, accessToken);
      if (!active) return;
      if (error) return setError(error.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.assign(immediate);
        return;
      }
      setDetails(data);
    })();
    return () => { active = false; };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    if (!token) return setError("Session expired. Please sign in again.");
    setBusy(true);
    const { data, error } = approve
      ? await approveAuthorization(authorizationId, token)
      : await denyAuthorization(authorizationId, token);
    if (error) { setBusy(false); return setError(error.message); }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) { setBusy(false); return setError("No redirect returned by the authorization server."); }
    window.location.assign(target);
  }

  if (error) {
    return (
      <SafePage className="flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader><CardTitle>Authorization error</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">{error}</p></CardContent>
        </Card>
      </SafePage>
    );
  }
  if (!details) {
    return (
      <SafePage className="flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Loading authorization request…</p>
      </SafePage>
    );
  }

  const clientName = details.client?.name ?? details.client?.client_name ?? "an external app";
  const redirectUri = details.client?.redirect_uris?.[0] ?? details.redirect_uri ?? "";
  const scopes: string[] = details.scopes ?? details.requested_scopes ?? [];

  return (
    <SafePage className="flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Connect {clientName} to Dynamic</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            {clientName} will be able to call this app's enabled tools while you are signed in.
          </p>
          {redirectUri && (
            <p className="text-xs text-muted-foreground break-all">
              Redirect URI: <span className="font-mono">{redirectUri}</span>
            </p>
          )}
          {scopes.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Requested permissions:
              <ul className="list-disc list-inside mt-1">
                {scopes.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            This does not bypass this app's permissions or backend policies. Row-level security still applies.
          </p>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>Approve</Button>
            <Button className="flex-1" variant="outline" disabled={busy} onClick={() => decide(false)}>Cancel</Button>
          </div>
        </CardContent>
      </Card>
    </SafePage>
  );
}
