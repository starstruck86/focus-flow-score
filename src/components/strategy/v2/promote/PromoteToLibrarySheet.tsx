/**
 * PromoteToLibrarySheet — lightweight "Promote to Library" form.
 *
 * Strategy outputs are NOT library resources by default. They live in a
 * thread (and inherit account/opportunity context). The user explicitly
 * promotes a finished output into the curated Library when they want it
 * to become reusable knowledge.
 *
 * On Promote we write a row to `resources` with:
 *   - is_template = true
 *   - template_category = chosen type
 *   - resource_type = 'template'
 *   - source_strategy_thread_id when available (provenance)
 *   - account_id / opportunity_id from the originating thread (if linked)
 *
 * Fields:
 *   • Name        (defaults to the output title)
 *   • Type        (template / framework / messaging / playbook / other)
 *   • Description (optional)
 *
 * UI ONLY apart from a single insert into the existing resources table —
 * no new schema, no engine changes.
 */
import { useEffect, useState } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { BookmarkPlus, X, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export const PROMOTION_TYPES = [
  { value: 'Template',    label: 'Template'  },
  { value: 'Framework',   label: 'Framework' },
  { value: 'Messaging',   label: 'Messaging' },
  { value: 'Playbook',    label: 'Playbook'  },
  { value: 'Other',       label: 'Other'     },
] as const;
export type PromotionType = typeof PROMOTION_TYPES[number]['value'];

export interface PromotePayload {
  /** Default name (usually the output title). */
  defaultName: string;
  /** Markdown/plain content body to store as the reusable resource. */
  content: string;
  /** Provenance — the originating thread, if any. */
  threadId?: string | null;
  /** Account context if the originating thread was account-linked. */
  accountId?: string | null;
  /** Opportunity context if the originating thread was opp-linked. */
  opportunityId?: string | null;
}

interface Props {
  /** When non-null, the sheet is open and editing this payload. */
  payload: PromotePayload | null;
  onClose: () => void;
  onPromoted?: (resourceId: string) => void;
}

export function PromoteToLibrarySheet({ payload, onClose, onPromoted }: Props) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [type, setType] = useState<PromotionType>('Template');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (payload) {
      setName(payload.defaultName.slice(0, 120));
      setType('Template');
      setDescription('');
      setSubmitting(false);
    }
  }, [payload]);

  if (!payload) return null;

  const handlePromote = async () => {
    if (!user) {
      toast.error('You must be signed in.');
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Name is required.');
      return;
    }
    setSubmitting(true);
    try {
      const insertRow: Record<string, unknown> = {
        user_id: user.id,
        title: trimmedName,
        description: description.trim() || null,
        resource_type: 'template',
        is_template: true,
        template_category: type,
        content: payload.content,
        content_status: 'enriched',
        tags: ['promoted-from-strategy'],
      };
      if (payload.threadId) insertRow.source_strategy_thread_id = payload.threadId;
      if (payload.accountId) insertRow.account_id = payload.accountId;
      if (payload.opportunityId) insertRow.opportunity_id = payload.opportunityId;

      const { data, error } = await (supabase as any)
        .from('resources')
        .insert(insertRow)
        .select('id')
        .single();
      if (error) throw error;

      toast.success('Promoted to Library', {
        description: `"${trimmedName}" is now reusable knowledge.`,
      });
      onPromoted?.(data?.id);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Promotion failed';
      toast.error('Could not promote', { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={!!payload} onOpenChange={(o) => { if (!o && !submitting) onClose(); }}>
      <SheetContent
        side="right"
        className="p-0 flex flex-col w-full sm:max-w-[420px]"
        style={{ background: 'hsl(var(--sv-paper))' }}
      >
        <SheetHeader
          className="px-5 pt-5 pb-3 shrink-0"
          style={{ borderBottom: '1px solid hsl(var(--sv-hairline))' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle
                className="text-[15px] font-semibold tracking-tight flex items-center gap-2"
                style={{ color: 'hsl(var(--sv-ink))' }}
              >
                <BookmarkPlus className="h-4 w-4" style={{ color: 'hsl(var(--sv-clay))' }} />
                Promote to Library
              </SheetTitle>
              <SheetDescription
                className="text-[12px] mt-0.5"
                style={{ color: 'hsl(var(--sv-muted))' }}
              >
                Save this output as reusable knowledge. The original stays in your thread.
              </SheetDescription>
            </div>
            <button
              onClick={() => { if (!submitting) onClose(); }}
              className="h-7 w-7 rounded-[6px] sv-hover-bg flex items-center justify-center shrink-0"
              style={{ color: 'hsl(var(--sv-muted))' }}
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="promote-name" className="text-[12px] font-medium" style={{ color: 'hsl(var(--sv-ink))' }}>
              Name <span style={{ color: 'hsl(var(--sv-clay))' }}>*</span>
            </Label>
            <Input
              id="promote-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What should this be called in the Library?"
              className="h-9 text-[13px]"
              autoFocus
            />
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <Label htmlFor="promote-type" className="text-[12px] font-medium" style={{ color: 'hsl(var(--sv-ink))' }}>
              Type
            </Label>
            <select
              id="promote-type"
              value={type}
              onChange={(e) => setType(e.target.value as PromotionType)}
              className="w-full h-9 px-2 rounded-md text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                border: '1px solid hsl(var(--sv-hairline))',
                background: 'hsl(var(--sv-paper))',
                color: 'hsl(var(--sv-ink))',
              }}
            >
              {PROMOTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="promote-desc" className="text-[12px] font-medium" style={{ color: 'hsl(var(--sv-ink))' }}>
              Description <span style={{ color: 'hsl(var(--sv-muted))' }}>(optional)</span>
            </Label>
            <Textarea
              id="promote-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="When should I reach for this?"
              rows={3}
              className="text-[13px] resize-none"
            />
          </div>

          {/* Provenance hint — makes it obvious this is being copied, not moved */}
          <p
            className="text-[11px] leading-snug px-2 py-2 rounded-md"
            style={{
              background: 'hsl(var(--sv-hover) / 0.5)',
              color: 'hsl(var(--sv-muted))',
              border: '1px dashed hsl(var(--sv-hairline))',
            }}
          >
            The original output stays in your thread. Library items are reusable across all of your work.
          </p>
        </div>

        <div
          className="shrink-0 px-5 py-3 flex items-center gap-2 justify-end"
          style={{ borderTop: '1px solid hsl(var(--sv-hairline))' }}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={submitting}
            className="h-9 text-[12.5px]"
          >
            Cancel
          </Button>
          <Button
            onClick={handlePromote}
            size="sm"
            disabled={submitting || !name.trim()}
            className="h-9 text-[12.5px] gap-1.5"
            style={{ background: 'hsl(var(--sv-clay))', color: 'hsl(var(--sv-paper))' }}
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Promoting…
              </>
            ) : (
              <>
                <BookmarkPlus className="h-3.5 w-3.5" />
                Promote
              </>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
