import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SafePage } from "@/components/SafePage";

// Beta-namespace wrapper — types may not surface on all @supabase/supabase-js versions.
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
};
const oauth = (supabase.auth as unknown as { oauth?: OAuthApi }).oauth;
const OAUTH_UNAVAILABLE =
  "This build of the Supabase client does not expose the OAuth 2.1 authorization API (supabase.auth.oauth). Upgrade @supabase/supabase-js to a version that includes the OAuth server methods.";

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
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      try {
        const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (error) return setError(error.message);
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) { window.location.href = immediate; return; }
        setDetails(data);
      } catch (e: any) {
        if (active) setError(e?.message ?? "Failed to load authorization request");
      }
    })();
    return () => { active = false; };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const { data, error } = approve
        ? await oauth.approveAuthorization(authorizationId)
        : await oauth.denyAuthorization(authorizationId);
      if (error) { setBusy(false); return setError(error.message); }
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) { setBusy(false); return setError("No redirect returned by the authorization server."); }
      window.location.href = target;
    } catch (e: any) {
      setBusy(false);
      setError(e?.message ?? "Authorization failed");
    }
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
