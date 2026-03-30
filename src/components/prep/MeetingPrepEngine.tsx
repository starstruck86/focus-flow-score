/**
 * Meeting Prep Engine — Phase 2
 *
 * Lightweight prep surface inside the Execute tab.
 * Takes context inputs → generates structured prep from active knowledge → connects to Dave roleplay.
 */

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Target, Zap, AlertTriangle, MessageSquare, Swords,
  HelpCircle, Play, ChevronDown, Loader2, Brain, Sparkles,
} from 'lucide-react';
import { type SalesContext, type PrepOutput, generatePrep, suggestContext } from '@/lib/salesContext';
import { COMPETITOR_TAGS, PRODUCT_TAGS, PERSONA_TAGS, STAGE_TAGS, CONTEXT_TAGS } from '@/lib/resourceTags';

export function MeetingPrepEngine() {
  const [ctx, setCtx] = useState<SalesContext>({});
  const [prep, setPrep] = useState<PrepOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);

  const update = useCallback((patch: Partial<SalesContext>) => {
    setCtx(prev => {
      const next = { ...prev, ...patch };
      // Auto-suggest missing fields
      const suggestions = suggestContext(next);
      return { ...next, ...suggestions, ...patch }; // explicit input wins
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    try {
      const result = await generatePrep(ctx);
      setPrep(result);
    } catch (e) {
      console.error('Prep generation failed', e);
    } finally {
      setLoading(false);
    }
  }, [ctx]);

  const handlePractice = useCallback(() => {
    if (!prep) return;
    // Build roleplay context from prep and dispatch to Dave
    const chapter = prep.focus_areas[0]?.toLowerCase().replace(/ /g, '_') || 'discovery';
    const detail: any = {
      chapter,
      competitor: ctx.competitors?.[0],
      focusItemTitle: prep.recommended_tactics[0]?.split(':')[0],
      salesContext: ctx,
    };
    window.dispatchEvent(new CustomEvent('dave-start-roleplay', { detail }));
  }, [prep, ctx]);

  const hasInput = ctx.context_type || ctx.competitors?.length || ctx.stage || ctx.persona;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="border-primary/20">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer py-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                Meeting Prep
                {prep && (
                  <Badge variant="secondary" className="text-[10px]">
                    {prep.grounded_item_count} items
                  </Badge>
                )}
              </CardTitle>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 pb-4 px-4 space-y-4">
            {/* ── Context Inputs ── */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Call Type</Label>
                <Select value={ctx.context_type || '__unset__'} onValueChange={v => update({ context_type: v === '__unset__' ? undefined : v })}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTEXT_TAGS.map(t => (
                      <SelectItem key={t} value={t} className="text-xs">
                        {t.replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Stage</Label>
                <Select value={ctx.stage || '__unset__'} onValueChange={v => update({ stage: v === '__unset__' ? undefined : v })}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGE_TAGS.map(t => (
                      <SelectItem key={t} value={t} className="text-xs">
                        {t.replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Competitor</Label>
                <Select
                  value={ctx.competitors?.[0] || '__none__'}
                  onValueChange={v => update({ competitors: v === '__none__' ? [] : [v] })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" className="text-xs">None</SelectItem>
                    {COMPETITOR_TAGS.map(t => (
                      <SelectItem key={t} value={t} className="text-xs">
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Persona</Label>
                <Select value={ctx.persona || '__any__'} onValueChange={v => update({ persona: v === '__any__' ? undefined : v })}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__" className="text-xs">Any</SelectItem>
                    {PERSONA_TAGS.map(t => (
                      <SelectItem key={t} value={t} className="text-xs">
                        {t.replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2 space-y-1">
                <Label className="text-[11px] text-muted-foreground">Account (optional)</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="e.g. Acme Corp"
                  value={ctx.account_name || ''}
                  onChange={e => update({ account_name: e.target.value || undefined })}
                />
              </div>
            </div>

            <Button
              size="sm"
              className="w-full text-xs"
              disabled={!hasInput || loading}
              onClick={handleGenerate}
            >
              {loading ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Generating...</>
              ) : (
                <><Sparkles className="h-3.5 w-3.5 mr-1" /> Generate Prep</>
              )}
            </Button>

            {/* ── Prep Output ── */}
            {prep && <PrepOutputView prep={prep} onPractice={handlePractice} />}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ── Prep Output ─────────────────────────────────────────────

function PrepOutputView({ prep, onPractice }: { prep: PrepOutput; onPractice: () => void }) {
  return (
    <div className="space-y-3 pt-2 border-t border-border">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{prep.context_summary}</p>
        <Badge variant="outline" className="text-[10px]">
          {prep.grounded_item_count} knowledge items
        </Badge>
      </div>

      {prep.grounded_item_count === 0 && (
        <p className="text-xs text-amber-600 bg-amber-500/10 px-2 py-1.5 rounded">
          No active knowledge items match this context. Add resources and extract knowledge in the Learn tab.
        </p>
      )}

      {/* Sections */}
      {prep.recommended_tactics.length > 0 && (
        <PrepSection icon={<Target className="h-3.5 w-3.5" />} title="Tactics" color="text-primary">
          {prep.recommended_tactics.map((t, i) => <li key={i} className="text-xs">{t}</li>)}
        </PrepSection>
      )}

      {prep.competitive_angles.length > 0 && (
        <PrepSection icon={<Swords className="h-3.5 w-3.5" />} title="Competitive Angles" color="text-orange-500">
          {prep.competitive_angles.map((t, i) => <li key={i} className="text-xs">{t}</li>)}
        </PrepSection>
      )}

      {prep.talk_tracks.length > 0 && (
        <PrepSection icon={<MessageSquare className="h-3.5 w-3.5" />} title="Talk Tracks" color="text-blue-500">
          {prep.talk_tracks.map((t, i) => <li key={i} className="text-xs">{t}</li>)}
        </PrepSection>
      )}

      {prep.risks.length > 0 && (
        <PrepSection icon={<AlertTriangle className="h-3.5 w-3.5" />} title="Risks / Anti-Patterns" color="text-destructive">
          {prep.risks.map((t, i) => <li key={i} className="text-xs">{t}</li>)}
        </PrepSection>
      )}

      {prep.questions_to_ask.length > 0 && (
        <PrepSection icon={<HelpCircle className="h-3.5 w-3.5" />} title="Questions to Ask" color="text-emerald-500">
          {prep.questions_to_ask.map((t, i) => <li key={i} className="text-xs">{t}</li>)}
        </PrepSection>
      )}

      {prep.focus_areas.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {prep.focus_areas.map(f => (
            <Badge key={f} variant="secondary" className="text-[10px]">{f}</Badge>
          ))}
        </div>
      )}

      {/* Practice button */}
      <Button
        size="sm"
        variant="outline"
        className="w-full text-xs gap-1 border-primary/30 text-primary hover:bg-primary/5"
        onClick={onPractice}
      >
        <Play className="h-3.5 w-3.5" />
        Practice This Scenario with Dave
      </Button>
    </div>
  );
}

function PrepSection({
  icon, title, color, children,
}: {
  icon: React.ReactNode;
  title: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className={`flex items-center gap-1.5 mb-1 ${color}`}>
        {icon}
        <span className="text-[11px] font-medium">{title}</span>
      </div>
      <ul className="space-y-0.5 pl-5 list-disc text-foreground/80">
        {children}
      </ul>
    </div>
  );
}
