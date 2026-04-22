// ════════════════════════════════════════════════════════════════
// RoutingDetails — canary-only developer panel exposing the router's
// decision metadata for an assistant message. Hidden for non-canary
// users via useCanaryUser().
//
// Reads from message.content_json.routing_meta written by strategy-chat.
// Pure presentational. Uses semantic design tokens only.
// ════════════════════════════════════════════════════════════════

import { useCanaryUser } from '@/lib/strategy/useCanaryUser';

export interface RoutingMeta {
  lane?: 'direct' | 'assisted' | 'deep_work';
  deep_intent?: boolean;
  promotion_offered?: boolean;
  auto_promoted?: boolean;
  override_used?: 'auto' | 'quick' | 'deep';
}

export function RoutingDetails({ meta }: { meta?: RoutingMeta }) {
  const isCanary = useCanaryUser();
  if (!isCanary || !meta) return null;
  return (
    <details className="mt-1 text-[10px] text-muted-foreground">
      <summary className="cursor-pointer select-none">routing</summary>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
        <span>lane</span>
        <span>{meta.lane ?? '—'}</span>
        <span>deep_intent</span>
        <span>{String(meta.deep_intent ?? false)}</span>
        <span>promotion_offered</span>
        <span>{String(meta.promotion_offered ?? false)}</span>
        <span>auto_promoted</span>
        <span>{String(meta.auto_promoted ?? false)}</span>
        <span>override</span>
        <span>{meta.override_used ?? 'auto'}</span>
      </div>
    </details>
  );
}
