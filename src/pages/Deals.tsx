import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Plus, Zap, ChevronRight, Trash2, TrendingUp } from 'lucide-react';

const STAGE_CONFIG: Record<string, { label: string; dimension: string; color: string; emoji: string }> = {
  prospecting:    { label: 'Prospecting',          dimension: 'internal_prospecting', color: 'bg-slate-500',  emoji: '🎯' },
  discovery:      { label: 'Discovery',             dimension: 'discovery',            color: 'bg-blue-500',   emoji: '🔍' },
  qualification:  { label: 'Qualification',         dimension: 'qualification',        color: 'bg-indigo-500', emoji: '✅' },
  champion:       { label: 'Champion Build',        dimension: 'stakeholder_navigation', color: 'bg-purple-500', emoji: '🤝' },
  executive:      { label: 'Executive Alignment',   dimension: 'c_suite_engagement',   color: 'bg-orange-500', emoji: '👔' },
  expansion:      { label: 'Expansion / Upsell',    dimension: 'expansion_strategy',   color: 'bg-green-500',  emoji: '📈' },
  competitive:    { label: 'Competitive Eval',      dimension: 'competitive',          color: 'bg-red-500',    emoji: '⚔️' },
  negotiation:    { label: 'Negotiation',           dimension: 'deal_control',         color: 'bg-amber-500',  emoji: '🔒' },
};

interface Deal {
  id: string;
  account: string;
  stage: string;
  arr: string;
  nextAction: string;
  updatedAt: string;
}

const STORAGE_KEY = 'dynamic_deals_v1';

function loadDeals(): Deal[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); }
  catch { return []; }
}

function saveDeals(deals: Deal[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deals));
}

export default function Deals() {
  const navigate = useNavigate();
  const [deals, setDeals] = useState<Deal[]>(() => loadDeals());
  const [adding, setAdding] = useState(false);
  const [newAccount, setNewAccount] = useState('');
  const [newStage, setNewStage] = useState('expansion');
  const [newArr, setNewArr] = useState('');
  const [newNextAction, setNewNextAction] = useState('');
  const [editingAction, setEditingAction] = useState<string | null>(null);
  const [actionText, setActionText] = useState('');

  useEffect(() => { saveDeals(deals); }, [deals]);

  const addDeal = () => {
    if (!newAccount.trim()) return;
    const deal: Deal = {
      id: crypto.randomUUID(),
      account: newAccount.trim(),
      stage: newStage,
      arr: newArr,
      nextAction: newNextAction,
      updatedAt: new Date().toISOString(),
    };
    setDeals(prev => [deal, ...prev]);
    setNewAccount(''); setNewArr(''); setNewNextAction(''); setAdding(false);
  };

  const removeDeal = (id: string) => setDeals(prev => prev.filter(d => d.id !== id));

  const updateStage = (id: string, stage: string) => {
    setDeals(prev => prev.map(d => d.id === id ? { ...d, stage, updatedAt: new Date().toISOString() } : d));
  };

  const stageSummary = Object.entries(
    deals.reduce((acc, d) => { acc[d.stage] = (acc[d.stage] ?? 0) + 1; return acc; }, {} as Record<string, number>)
  ).sort((a, b) => b[1] - a[1]);

  return (
    <Layout>
      <div className="px-4 pt-4 pb-24 space-y-4 max-w-lg mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h1 className="font-display text-xl font-bold">Deals</h1>
          </div>
          <Button size="sm" onClick={() => setAdding(!adding)}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add Deal
          </Button>
        </div>

        {/* Add deal form */}
        {adding && (
          <Card className="border-primary/30">
            <CardContent className="p-4 space-y-3">
              <Input placeholder="Account name" value={newAccount} onChange={e => setNewAccount(e.target.value)} />
              <select
                value={newStage}
                onChange={e => setNewStage(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {Object.entries(STAGE_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.emoji} {v.label}</option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="ARR (e.g. 80k)" value={newArr} onChange={e => setNewArr(e.target.value)} />
                <Input placeholder="Next action" value={newNextAction} onChange={e => setNewNextAction(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={addDeal} disabled={!newAccount.trim()}>Add</Button>
                <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stage summary chips */}
        {stageSummary.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {stageSummary.map(([stage, count]) => {
              const s = STAGE_CONFIG[stage];
              if (!s) return null;
              return (
                <button
                  key={stage}
                  onClick={() => navigate('/sharpen', { state: { dimension: s.dimension } })}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border text-xs hover:border-primary/40 transition-all"
                >
                  <span>{s.emoji}</span>
                  <span className="font-medium">{count}× {s.label}</span>
                  <Zap className="h-2.5 w-2.5 text-primary" />
                </button>
              );
            })}
          </div>
        )}

        {/* Deal list */}
        {deals.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center space-y-2">
              <p className="text-sm font-semibold">No deals tracked yet</p>
              <p className="text-xs text-muted-foreground">Add your Branch.io expansion accounts to connect pipeline stages to drills.</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />Add First Deal
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {deals.map(deal => {
              const s = STAGE_CONFIG[deal.stage] ?? STAGE_CONFIG.expansion;
              return (
                <Card key={deal.id} className="border-border/60">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-base">{s.emoji}</span>
                          <p className="text-sm font-semibold truncate">{deal.account}</p>
                          {deal.arr && <span className="text-xs text-muted-foreground font-mono shrink-0">{deal.arr}</span>}
                        </div>
                        {editingAction === deal.id ? (
                          <div className="flex items-center gap-1.5 mt-0.5 ml-6">
                            <input
                              type="text"
                              value={actionText}
                              onChange={e => setActionText(e.target.value)}
                              onBlur={() => {
                                setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, nextAction: actionText } : d));
                                setEditingAction(null);
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, nextAction: actionText } : d));
                                  setEditingAction(null);
                                }
                                if (e.key === 'Escape') setEditingAction(null);
                              }}
                              className="text-[11px] bg-transparent border-b border-primary/40 outline-none flex-1 text-muted-foreground"
                              autoFocus
                            />
                          </div>
                        ) : (
                          <p
                            className="text-[11px] text-muted-foreground mt-0.5 ml-6 cursor-pointer hover:text-foreground"
                            onClick={() => { setEditingAction(deal.id); setActionText(deal.nextAction || ''); }}
                          >
                            {deal.nextAction ? `→ ${deal.nextAction}` : <span className="opacity-40">+ add next action</span>}
                          </p>
                        )}
                      </div>
                      <button onClick={() => removeDeal(deal.id)} className="text-muted-foreground/40 hover:text-red-500 p-1 shrink-0">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Stage selector */}
                    <div className="flex items-center gap-2">
                      <select
                        value={deal.stage}
                        onChange={e => updateStage(deal.id, e.target.value)}
                        className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
                      >
                        {Object.entries(STAGE_CONFIG).map(([k, v]) => (
                          <option key={k} value={k}>{v.emoji} {v.label}</option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        className="text-xs h-7 px-2.5 shrink-0"
                        onClick={() => navigate('/sharpen', { state: { dimension: s.dimension } })}
                      >
                        <Zap className="h-3 w-3 mr-1" />Drill
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7 px-2.5 shrink-0"
                        onClick={() => navigate('/brief')}
                      >
                        Scout
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {deals.length > 0 && (
          <div className="pt-2">
            <p className="text-[10px] text-center text-muted-foreground">
              Tap a stage chip to drill that skill · Drill button opens Sharpen for that dimension
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
