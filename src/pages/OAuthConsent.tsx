import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SafePage } from "@/components/SafePage";

// The `supabase.auth.oauth` namespace is beta and may not be typed on the
// installed SDK version. Guard at runtime and use a local typed shape.
type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
};

function getOAuth(): OAuthNamespace | null {
  const anyAuth = supabase.auth as any;
  const oauth = anyAuth?.oauth;
  if (!oauth || typeof oauth.getAuthorizationDetails !== "function") return null;
  return oauth as OAuthNamespace;
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
      const oauth = getOAuth();
      if (!oauth) return setError("OAuth client is unavailable in this build. Please refresh or contact support.");

      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) return setError(error.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate) {
        window.location.assign(immediate);
        return;
      }
      setDetails(data);
    })();
    return () => { active = false; };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    const oauth = getOAuth();
    if (!oauth) return setError("OAuth client is unavailable in this build.");
    setBusy(true);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
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
