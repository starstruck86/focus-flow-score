import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SafePage } from "@/components/SafePage";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/**
 * Direct REST calls to the Supabase Auth OAuth 2.1 authorization endpoints.
 * Used instead of `supabase.auth.oauth.*` because the SDK version pinned in
 * this app does not yet expose that namespace. Endpoints:
 *   GET  /auth/v1/oauth/authorizations/:id
 *   POST /auth/v1/oauth/authorizations/:id/consent   body: { action: 'approve'|'deny' }
 */
async function callOAuth(
  authorizationId: string,
  accessToken: string,
  method: "GET" | "POST",
  action?: "approve" | "deny",
): Promise<{ data: any; error: { message: string } | null }> {
  const suffix = method === "POST" ? "/consent" : "";
  const url = `${SUPABASE_URL}/auth/v1/oauth/authorizations/${encodeURIComponent(authorizationId)}${suffix}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: method === "POST" ? JSON.stringify({ action }) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      return { data: null, error: { message: data?.msg ?? data?.error_description ?? data?.error ?? `HTTP ${res.status}` } };
    }
    return { data, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e?.message ?? "Network error" } };
  }
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("Missing authorization_id");
      if (!SUPABASE_URL || !SUPABASE_KEY) return setError("OAuth server is not configured for this build.");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error } = await callOAuth(authorizationId, sess.session.access_token, "GET");
      if (!active) return;
      if (error) return setError(error.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) { window.location.href = immediate; return; }
      setDetails(data);
    })();
    return () => { active = false; };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) { setBusy(false); return setError("Session expired. Please sign in again."); }
    const { data, error } = await callOAuth(
      authorizationId,
      sess.session.access_token,
      "POST",
      approve ? "approve" : "deny",
    );
    if (error) { setBusy(false); return setError(error.message); }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) { setBusy(false); return setError("No redirect returned by the authorization server."); }
    window.location.href = target;
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
