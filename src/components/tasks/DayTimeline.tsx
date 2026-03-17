import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/store/useStore';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Clock, Rocket, Shield, BriefcaseBusiness, Phone, Users,
  BookOpen, Coffee, Target, Lightbulb, CheckCircle2, X,
  Building2, ThumbsUp, ThumbsDown,
} from 'lucide-react';

interface TimeBlock {
  start_time: string;
  end_time: string;
  label: string;
  type: 'prospecting' | 'meeting' | 'research' | 'admin' | 'break' | 'pipeline' | 'prep';
  workstream?: 'new_logo' | 'renewal' | 'general';
  goals: string[];
  reasoning: string;
  actual_dials?: number;
  actual_emails?: number;
  linked_accounts?: { id: string; name: string }[];
}

const TYPE_CONFIG: Record<string, { icon: typeof Clock; color: string; barColor: string }> = {
  prospecting: { icon: Phone, color: 'text-blue-500', barColor: 'bg-blue-500' },
  meeting: { icon: Users, color: 'text-purple-500', barColor: 'bg-purple-500' },
  research: { icon: BookOpen, color: 'text-amber-500', barColor: 'bg-amber-500' },
  admin: { icon: BriefcaseBusiness, color: 'text-muted-foreground', barColor: 'bg-muted-foreground' },
  break: { icon: Coffee, color: 'text-green-500', barColor: 'bg-green-500/60' },
  pipeline: { icon: Target, color: 'text-red-500', barColor: 'bg-red-500' },
  prep: { icon: Lightbulb, color: 'text-cyan-500', barColor: 'bg-cyan-500' },
};

const WORKSTREAM_ICON: Record<string, typeof Rocket> = {
  new_logo: Rocket,
  renewal: Shield,
  general: BriefcaseBusiness,
};

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${m.toString().padStart(2, '0')} ${suffix}`;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function DayTimeline() {
  const { user } = useAuth();
  const { accounts } = useStore();
  const queryClient = useQueryClient();
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);
  const [nowPct, setNowPct] = useState(0);
  const [accountSearchBlockIdx, setAccountSearchBlockIdx] = useState<number | null>(null);
  const [accountSearchQuery, setAccountSearchQuery] = useState('');

  const { data: plan } = useQuery({
    queryKey: ['daily-time-blocks', todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_time_blocks' as any)
        .select('*')
        .eq('plan_date', todayStr)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: !!user,
  });

  const blocks = (plan?.blocks || []) as TimeBlock[];
  const completedGoals = new Set((plan?.completed_goals || []) as string[]);

  const { dayStart, dayEnd, totalMinutes } = useMemo(() => {
    if (blocks.length === 0) return { dayStart: 0, dayEnd: 0, totalMinutes: 1 };
    const ds = toMinutes(blocks[0].start_time);
    const de = toMinutes(blocks[blocks.length - 1].end_time);
    return { dayStart: ds, dayEnd: de, totalMinutes: Math.max(de - ds, 1) };
  }, [blocks]);

  // Update NOW marker every 30s
  useEffect(() => {
    if (blocks.length === 0) return;
    const update = () => {
      const now = new Date();
      const mins = now.getHours() * 60 + now.getMinutes();
      const pct = Math.max(0, Math.min(100, ((mins - dayStart) / totalMinutes) * 100));
      setNowPct(pct);
    };
    update();
    const interval = setInterval(update, 30_000);
    return () => clearInterval(interval);
  }, [blocks, dayStart, totalMinutes]);

  // Toggle goal completion
  const toggleGoal = useCallback(async (blockIdx: number, goalIdx: number) => {
    if (!plan) return;
    const goalKey = `${blockIdx}-${goalIdx}`;
    const current = (plan.completed_goals || []) as string[];
    const updated = current.includes(goalKey)
      ? current.filter((g: string) => g !== goalKey)
      : [...current, goalKey];

    queryClient.setQueryData(['daily-time-blocks', todayStr], { ...plan, completed_goals: updated });
    await supabase.from('daily_time_blocks' as any).update({ completed_goals: updated }).eq('id', plan.id);
  }, [plan, todayStr, queryClient]);

  // Update block field (dials, emails)
  const updateBlockActual = useCallback(async (blockIdx: number, field: 'actual_dials' | 'actual_emails', value: number) => {
    if (!plan) return;
    const updatedBlocks = [...(plan.blocks as TimeBlock[])];
    updatedBlocks[blockIdx] = { ...updatedBlocks[blockIdx], [field]: value };
    queryClient.setQueryData(['daily-time-blocks', todayStr], { ...plan, blocks: updatedBlocks });
    await supabase.from('daily_time_blocks' as any).update({ blocks: updatedBlocks }).eq('id', plan.id);
  }, [plan, todayStr, queryClient]);

  // Update linked accounts on a prep block
  const updateBlockLinkedAccounts = useCallback(async (blockIdx: number, linkedAccounts: { id: string; name: string }[]) => {
    if (!plan) return;
    const updatedBlocks = [...(plan.blocks as TimeBlock[])];
    updatedBlocks[blockIdx] = { ...updatedBlocks[blockIdx], linked_accounts: linkedAccounts };
    queryClient.setQueryData(['daily-time-blocks', todayStr], { ...plan, blocks: updatedBlocks });
    await supabase.from('daily_time_blocks' as any).update({ blocks: updatedBlocks }).eq('id', plan.id);
  }, [plan, todayStr, queryClient]);

  // Block thumbs feedback
  const thumbsBlock = useCallback(async (blockIdx: number, thumbs: 'up' | 'down') => {
    if (!plan) return;
    const current = (plan.block_feedback || []) as { blockIdx: number; thumbs: string }[];
    const existing = current.findIndex((f: any) => f.blockIdx === blockIdx);
    const updated = [...current];
    if (existing >= 0) updated[existing] = { blockIdx, thumbs };
    else updated.push({ blockIdx, thumbs });
    queryClient.setQueryData(['daily-time-blocks', todayStr], { ...plan, block_feedback: updated });
    await supabase.from('daily_time_blocks' as any).update({ block_feedback: updated }).eq('id', plan.id);
  }, [plan, todayStr, queryClient]);

  if (blocks.length === 0) return null;

  const selected = selectedBlock !== null ? blocks[selectedBlock] : null;
  const selectedConfig = selected ? TYPE_CONFIG[selected.type] || TYPE_CONFIG.admin : null;
  const SelectedIcon = selectedConfig?.icon || Clock;
  const WsIcon = selected?.workstream ? WORKSTREAM_ICON[selected.workstream] || BriefcaseBusiness : null;
  const blockFeedbackMap = new Map(
    ((plan?.block_feedback || []) as { blockIdx: number; thumbs: string }[]).map((f: any) => [f.blockIdx, f.thumbs])
  );

  return (
    <div className="mb-4 rounded-xl border border-border bg-card/80 backdrop-blur-sm overflow-hidden">
      {/* Timeline bar */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] font-semibold text-foreground">Today's Blocks</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>{formatTime(blocks[0].start_time)}</span>
            <span>→</span>
            <span>{formatTime(blocks[blocks.length - 1].end_time)}</span>
          </div>
        </div>

        {/* The actual timeline bar */}
        <div className="relative h-10 rounded-lg bg-muted/30 overflow-hidden flex">
          {blocks.map((block, i) => {
            const widthPct = ((toMinutes(block.end_time) - toMinutes(block.start_time)) / totalMinutes) * 100;
            const config = TYPE_CONFIG[block.type] || TYPE_CONFIG.admin;
            const Icon = config.icon;
            const isCurrent = (() => {
              const now = new Date();
              const mins = now.getHours() * 60 + now.getMinutes();
              return mins >= toMinutes(block.start_time) && mins < toMinutes(block.end_time);
            })();
            const isPast = (() => {
              const now = new Date();
              const mins = now.getHours() * 60 + now.getMinutes();
              return mins >= toMinutes(block.end_time);
            })();
            const isSelected = selectedBlock === i;

            const totalG = block.goals.length;
            const doneG = block.goals.filter((_, gi) => completedGoals.has(`${i}-${gi}`)).length;

            return (
              <button
                key={i}
                onClick={() => setSelectedBlock(isSelected ? null : i)}
                className={cn(
                  "relative h-full flex items-center justify-center gap-0.5 transition-all border-r border-background/40 last:border-r-0",
                  config.barColor,
                  isPast && !isCurrent && "opacity-35",
                  isCurrent && "ring-2 ring-primary ring-inset shadow-lg z-10",
                  isSelected && "ring-2 ring-foreground/60 ring-inset z-20",
                  "hover:brightness-110 cursor-pointer"
                )}
                style={{ width: `${widthPct}%` }}
                title={`${block.label} (${formatTime(block.start_time)} – ${formatTime(block.end_time)})`}
              >
                <Icon className="h-3 w-3 text-white/90 shrink-0" />
                {widthPct > 12 && (
                  <span className="text-[9px] font-semibold text-white/90 truncate max-w-[80%]">
                    {block.label}
                  </span>
                )}
                {totalG > 0 && doneG === totalG && widthPct > 6 && (
                  <CheckCircle2 className="h-2.5 w-2.5 text-white/80 shrink-0" />
                )}
              </button>
            );
          })}

          {/* NOW marker */}
          {nowPct > 0 && nowPct < 100 && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-foreground z-30 pointer-events-none"
              style={{ left: `${nowPct}%` }}
            >
              <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-foreground shadow-md" />
              <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-foreground shadow-md" />
            </div>
          )}
        </div>

        {/* Time labels under timeline */}
        <div className="flex justify-between mt-1">
          {blocks.filter((_, i) => i % Math.max(1, Math.floor(blocks.length / 5)) === 0 || i === blocks.length - 1).map((block, i, arr) => (
            <span key={i} className="text-[9px] text-muted-foreground">
              {formatTime(i === arr.length - 1 ? block.end_time : block.start_time)}
            </span>
          ))}
        </div>
      </div>

      {/* Selected block detail panel */}
      {selected && selectedConfig && selectedBlock !== null && (
        <div className="px-3 pb-3 border-t border-border/30 pt-2.5 animate-fade-in">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center", selectedConfig.barColor)}>
                <SelectedIcon className="h-3.5 w-3.5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">{selected.label}</span>
                  {WsIcon && (
                    <span className={cn(
                      "inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full border",
                      selected.workstream === 'new_logo' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20'
                        : selected.workstream === 'renewal' ? 'bg-status-green/10 text-status-green border-status-green/20'
                          : 'bg-muted text-muted-foreground border-border'
                    )}>
                      <WsIcon className="h-2.5 w-2.5" />
                      {selected.workstream === 'new_logo' ? 'New Logo' : selected.workstream === 'renewal' ? 'Renewal' : 'General'}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {formatTime(selected.start_time)} – {formatTime(selected.end_time)}
                </span>
              </div>
            </div>
            <button onClick={() => setSelectedBlock(null)} className="text-muted-foreground hover:text-foreground p-1">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Goals with interactive checkboxes */}
          {selected.goals.length > 0 && (
            <div className="space-y-1 ml-9">
              {selected.goals.map((goal, gi) => {
                const goalKey = `${selectedBlock}-${gi}`;
                const isDone = completedGoals.has(goalKey);
                return (
                  <div key={gi} className="flex items-center gap-1.5 group/goal">
                    <Checkbox
                      checked={isDone}
                      onCheckedChange={() => toggleGoal(selectedBlock, gi)}
                      className="h-3.5 w-3.5"
                    />
                    <span className={cn(
                      "text-[11px] transition-all cursor-pointer",
                      isDone ? "text-status-green line-through opacity-70" : "text-muted-foreground"
                    )}
                      onClick={() => toggleGoal(selectedBlock, gi)}
                    >
                      {goal}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Dial tracker for prospecting blocks */}
          {selected.type === 'prospecting' && (
            <div className="flex items-center gap-3 mt-2.5 ml-9 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border/30">
              <div className="flex items-center gap-1.5">
                <Phone className="h-3 w-3 text-blue-500" />
                <span className="text-[10px] text-muted-foreground font-medium">Dials:</span>
                <Input
                  type="number"
                  min={0}
                  className="h-6 w-14 text-xs text-center px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder="—"
                  value={selected.actual_dials ?? ''}
                  onChange={e => {
                    const val = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
                    if (!isNaN(val)) updateBlockActual(selectedBlock, 'actual_dials', val);
                  }}
                />
              </div>
              {selected.label.toLowerCase().includes('email') && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground font-medium">Emails:</span>
                  <Input
                    type="number"
                    min={0}
                    className="h-6 w-14 text-xs text-center px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    placeholder="—"
                    value={selected.actual_emails ?? ''}
                    onChange={e => {
                      const val = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
                      if (!isNaN(val)) updateBlockActual(selectedBlock, 'actual_emails', val);
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Account picker for prep blocks */}
          {selected.type === 'prep' && (
            <div className="mt-2.5 ml-9 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border/30">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Target className="h-3 w-3 text-cyan-500" />
                <span className="text-[10px] text-muted-foreground font-medium">Target Accounts:</span>
              </div>
              {(selected.linked_accounts || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {(selected.linked_accounts || []).map(acct => (
                    <Badge
                      key={acct.id}
                      variant="outline"
                      className="text-[10px] h-5 gap-1 bg-accent/50 pr-1 group/pill"
                    >
                      <Building2 className="h-3 w-3" />
                      {acct.name}
                      <button
                        onClick={() => {
                          const updated = (selected.linked_accounts || []).filter(a => a.id !== acct.id);
                          updateBlockLinkedAccounts(selectedBlock, updated);
                        }}
                        className="ml-0.5 opacity-0 group-hover/pill:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              {accountSearchBlockIdx === selectedBlock ? (
                <div className="relative">
                  <Input
                    autoFocus
                    className="h-6 text-xs"
                    placeholder="Search accounts..."
                    value={accountSearchQuery}
                    onChange={e => setAccountSearchQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Escape') {
                        setAccountSearchBlockIdx(null);
                        setAccountSearchQuery('');
                      }
                    }}
                  />
                  {accountSearchQuery.length > 0 && (
                    <div className="absolute z-20 top-7 left-0 right-0 bg-popover border border-border rounded-md shadow-lg max-h-40 overflow-y-auto">
                      {accounts
                        .filter(a => {
                          const q = accountSearchQuery.toLowerCase();
                          const alreadyLinked = (selected.linked_accounts || []).some(la => la.id === a.id);
                          return !alreadyLinked && a.name.toLowerCase().includes(q);
                        })
                        .slice(0, 8)
                        .map(a => (
                          <button
                            key={a.id}
                            className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors text-xs flex items-center justify-between"
                            onClick={() => {
                              const updated = [...(selected.linked_accounts || []), { id: a.id, name: a.name }];
                              updateBlockLinkedAccounts(selectedBlock, updated);
                              setAccountSearchQuery('');
                              if (updated.length >= 3) {
                                setAccountSearchBlockIdx(null);
                              }
                            }}
                          >
                            <span>{a.name}</span>
                            <span className="text-[10px] text-muted-foreground">Tier {a.tier}</span>
                          </button>
                        ))}
                      {accounts.filter(a => !((selected.linked_accounts || []).some(la => la.id === a.id)) && a.name.toLowerCase().includes(accountSearchQuery.toLowerCase())).length === 0 && (
                        <div className="px-3 py-2 text-[11px] text-muted-foreground">No matching accounts</div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => {
                    setAccountSearchBlockIdx(selectedBlock);
                    setAccountSearchQuery('');
                  }}
                  className="text-[11px] text-primary hover:text-primary/80 font-medium"
                >
                  + Add account
                </button>
              )}
            </div>
          )}

          {/* Thumbs feedback + reasoning */}
          <div className="flex items-center gap-2 mt-2 ml-9">
            <div className="flex gap-0.5">
              <button
                onClick={() => thumbsBlock(selectedBlock, 'up')}
                className={cn(
                  "p-0.5 rounded transition-colors",
                  blockFeedbackMap.get(selectedBlock) === 'up' ? "text-status-green" : "text-muted-foreground/25 hover:text-muted-foreground/50"
                )}
              >
                <ThumbsUp className="h-3 w-3" />
              </button>
              <button
                onClick={() => thumbsBlock(selectedBlock, 'down')}
                className={cn(
                  "p-0.5 rounded transition-colors",
                  blockFeedbackMap.get(selectedBlock) === 'down' ? "text-destructive" : "text-muted-foreground/25 hover:text-muted-foreground/50"
                )}
              >
                <ThumbsDown className="h-3 w-3" />
              </button>
            </div>
            {selected.reasoning && (
              <p className="text-[10px] text-muted-foreground/50 italic truncate">
                💡 {selected.reasoning}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
