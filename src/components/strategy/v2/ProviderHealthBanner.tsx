/**
 * ProviderHealthBanner — fail-loud surface for degraded AI providers.
 * Calls strategy-chat { action: "health_check" } once on mount.
 * Renders nothing when healthy. Shows a dismissible warning when a
 * provider key is missing (the classic post-migration failure mode).
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, X } from 'lucide-react';

interface HealthResponse {
  ok: boolean;
  degraded: boolean;
  providers: {
    anthropic: boolean;
    openai: boolean;
    perplexity: boolean;
    lovable_gateway: boolean;
  };
  impact: Record<string, string>;
}

export function ProviderHealthBanner() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strategy-chat`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token ?? ''}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({ action: 'health_check' }),
          },
        );
        if (!resp.ok || cancelled) return;
        const data = await resp.json().catch(() => null);
        if (!cancelled && data?.ok) setHealth(data);
      } catch { /* silent — a failed health check shouldn't break the page */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!health || !health.degraded || dismissed) return null;

  const down: string[] = [];
  if (!health.providers.anthropic) down.push('Anthropic');
  if (!health.providers.openai) down.push('OpenAI');
  if (!health.providers.lovable_gateway) down.push('Lovable gateway (situation classifier + Easy Prompt)');

  return (
    <div
      className="w-full flex items-start gap-2 px-4 py-2 text-[12px]"
      style={{
        background: 'hsl(var(--sv-clay) / 0.08)',
        borderBottom: '1px solid hsl(var(--sv-clay) / 0.25)',
        color: 'hsl(var(--sv-ink))',
      }}
    >
      <AlertTriangle className="h-3.5 w-3.5 mt-[1px] shrink-0" style={{ color: 'hsl(var(--sv-clay))' }} />
      <div className="flex-1 leading-snug">
        <span className="font-medium">Degraded AI providers:</span>{' '}
        {down.join(', ')}.{' '}
        <span style={{ color: 'hsl(var(--sv-muted))' }}>
          Some Strategy features are running in fallback mode. Check edge-function secrets
          {down.some(d => d.includes('Lovable')) ? ' (LOVABLE_API_KEY)' : ''}.
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 sv-hover-bg rounded p-0.5"
        style={{ color: 'hsl(var(--sv-muted))' }}
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
