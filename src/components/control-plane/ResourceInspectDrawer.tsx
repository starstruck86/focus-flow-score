/**
 * Resource Inspect Drawer — right-side drawer for deep resource inspection.
 */
import { cn } from '@/lib/utils';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  CheckCircle2, XCircle, Zap, Play, Eye, Wrench,
  Clock, FileText, Brain, AlertTriangle,
} from 'lucide-react';
import type { CanonicalResourceStatus } from '@/lib/canonicalLifecycle';
import {
  type ControlPlaneState,
  CONTROL_PLANE_LABELS, CONTROL_PLANE_COLORS,
  deriveStateEvidence, detectConflicts,
} from '@/lib/controlPlaneState';

interface Props {
  resource: CanonicalResourceStatus | null;
  state: ControlPlaneState | null;
  open: boolean;
  onClose: () => void;
  onAction: (resourceId: string, action: string) => void;
  actionLoading?: boolean;
}

function inferSourceType(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes(' > ')) return 'Lesson';
  if (lower.includes('podcast') || lower.includes('episode')) return 'Podcast';
  if (lower.includes('transcript')) return 'Transcript';
  if (lower.includes('framework')) return 'Framework';
  return 'Document';
}

export function ResourceInspectDrawer({ resource, state, open, onClose, onAction, actionLoading }: Props) {
  if (!resource || !state) return null;

  const evidence = deriveStateEvidence(resource, state);
  const colors = CONTROL_PLANE_COLORS[state];
  const conflicts = detectConflicts(resource);

  const actions = getActionsForState(state, resource);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-sm font-semibold leading-tight pr-6">
            {resource.title}
          </SheetTitle>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className={cn('text-[10px]', colors.text, colors.bg, colors.border)}>
              {CONTROL_PLANE_LABELS[state]}
            </Badge>
            <span className="text-[10px] text-muted-foreground">{inferSourceType(resource.title)}</span>
          </div>
        </SheetHeader>

        <div className="space-y-5 mt-4">
          {/* ── Actions ── */}
          {actions.length > 0 && (
            <Section title="Available Actions" icon={Zap}>
              <div className="space-y-2">
                {actions.map(a => (
                  <Button
                    key={a.key}
                    variant={a.primary ? 'default' : 'outline'}
                    size="sm"
                    className="w-full justify-start gap-2 h-8 text-xs"
                    onClick={() => onAction(resource.resource_id, a.key)}
                    disabled={actionLoading}
                  >
                    <a.icon className="h-3.5 w-3.5" />
                    {a.label}
                  </Button>
                ))}
              </div>
            </Section>
          )}

          <Separator />

          {/* ── Why this state ── */}
          <Section title={`Why: ${CONTROL_PLANE_LABELS[state]}`} icon={Eye}>
            <p className="text-muted-foreground italic text-xs mb-2">{evidence.reason}</p>
            <div className="space-y-1">
              {evidence.evidence.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {e.pass
                    ? <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                    : <XCircle className="h-3 w-3 text-destructive shrink-0" />
                  }
                  <span className="text-muted-foreground">{e.label}</span>
                  <span className="ml-auto font-mono tabular-nums">{e.value}</span>
                </div>
              ))}
            </div>
          </Section>

          <Separator />

          {/* ── Knowledge Items ── */}
          <Section title="Knowledge Items" icon={Brain}>
            <div className="space-y-1 text-xs">
              <Row label="Total KIs" value={String(resource.knowledge_item_count)} />
              <Row label="Active KIs" value={String(resource.active_ki_count)} />
              <Row label="With Contexts" value={String(resource.active_ki_with_context_count)} />
              <Row
                label="Quality"
                value={resource.knowledge_item_count === 0 ? '—' : (
                  resource.active_ki_count / resource.knowledge_item_count >= 0.8 ? 'Strong' :
                  resource.active_ki_count / resource.knowledge_item_count >= 0.5 ? 'Moderate' : 'Weak'
                )}
              />
            </div>
          </Section>

          <Separator />

          {/* ── Pipeline Facts ── */}
          <Section title="Pipeline Timeline" icon={Clock}>
            <div className="space-y-1 text-xs">
              <Row label="Internal Stage" value={resource.canonical_stage} mono />
              <Row label="Enriched" value={resource.is_enriched ? '✓ Yes' : '✗ No'} />
              <Row label="Content Backed" value={resource.is_content_backed ? '✓ Yes' : '✗ No'} />
              {resource.blocked_reason !== 'none' && (
                <Row label="Blocked" value={resource.blocked_reason.replace(/_/g, ' ')} destructive />
              )}
              <Row
                label="Last Updated"
                value={resource.last_transition_at ? new Date(resource.last_transition_at).toLocaleString() : '—'}
              />
            </div>
          </Section>

          {/* ── Conflicts ── */}
          {conflicts.length > 0 && (
            <>
              <Separator />
              <Section title="Conflicts Detected" icon={AlertTriangle} destructive>
                <div className="space-y-1.5">
                  {conflicts.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <AlertTriangle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                      <span className="text-destructive/90">{c}</span>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Helpers ────────────────────────────────────────────────
function Section({ title, icon: Icon, children, destructive }: {
  title: string; icon: React.ElementType; children: React.ReactNode; destructive?: boolean;
}) {
  return (
    <div className="space-y-2">
      <h4 className={cn('text-xs font-semibold flex items-center gap-1.5', destructive ? 'text-destructive' : 'text-foreground')}>
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h4>
      {children}
    </div>
  );
}

function Row({ label, value, mono, destructive }: { label: string; value: string; mono?: boolean; destructive?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(
        mono && 'font-mono text-[10px]',
        destructive && 'text-destructive font-medium',
      )}>{value}</span>
    </div>
  );
}

// ── Action model per state ─────────────────────────────────
interface ActionDef {
  key: string;
  label: string;
  icon: React.ElementType;
  primary: boolean;
}

function getActionsForState(state: ControlPlaneState, resource: CanonicalResourceStatus): ActionDef[] {
  switch (state) {
    case 'ingested':
      return [
        { key: 'enrich', label: 'Enrich Content', icon: FileText, primary: true },
      ];
    case 'has_content':
      return [
        { key: 'extract', label: 'Extract Knowledge', icon: Zap, primary: true },
      ];
    case 'extracted':
      return [
        { key: 'activate', label: 'Activate KIs', icon: Play, primary: true },
        { key: 'extract', label: 'Re-extract Knowledge', icon: Zap, primary: false },
      ];
    case 'activated':
      return [
        { key: 'extract', label: 'Re-extract Knowledge', icon: Zap, primary: false },
      ];
    case 'blocked': {
      const actions: ActionDef[] = [];
      if (['no_extraction', 'stale_blocker_state'].includes(resource.blocked_reason)) {
        actions.push({ key: 'fix', label: 'Auto-fix Resource', icon: Wrench, primary: true });
      }
      if (resource.blocked_reason === 'no_activation' || resource.blocked_reason === 'missing_contexts') {
        actions.push({ key: 'activate', label: 'Activate KIs', icon: Play, primary: true });
      }
      if (resource.blocked_reason === 'empty_content') {
        actions.push({ key: 'enrich', label: 'Enrich Content', icon: FileText, primary: true });
      }
      actions.push({ key: 'inspect', label: 'Open in Resource Manager', icon: Eye, primary: false });
      return actions;
    }
    case 'processing':
      return [
        { key: 'view_progress', label: 'View Progress', icon: Eye, primary: false },
      ];
    default:
      return [];
  }
}
