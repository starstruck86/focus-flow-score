// Per-Account Research Checklist — surfaces during research blocks
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, CheckCircle2, Circle, Building2, ChevronRight, ExternalLink } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';

interface ChecklistItem {
  id: string;
  label: string;
  check: (account: any, contacts: any[], opps: any[]) => boolean;
  tip: string;
}

const RESEARCH_CHECKLIST: ChecklistItem[] = [
  {
    id: 'website',
    label: 'Website reviewed',
    check: (a) => !!a.website,
    tip: 'Add their website URL to the account',
  },
  {
    id: 'tech-stack',
    label: 'Tech stack identified',
    check: (a) => a.techStack?.length > 0,
    tip: 'Document their marketing/tech stack',
  },
  {
    id: 'contacts',
    label: '2+ contacts mapped',
    check: (_a, contacts) => contacts.length >= 2,
    tip: 'Find at least 2 stakeholders',
  },
  {
    id: 'next-step',
    label: 'Next step defined',
    check: (a) => !!a.nextStep,
    tip: 'Set a concrete next action',
  },
  {
    id: 'notes',
    label: 'Research notes captured',
    check: (a) => !!a.notes && a.notes.length > 20,
    tip: 'Add value prop / pain points / context',
  },
  {
    id: 'sf-linked',
    label: 'Salesforce linked',
    check: (a) => !!a.salesforceLink,
    tip: 'Connect the Salesforce record',
  },
];

export function ResearchChecklist() {
  const navigate = useNavigate();
  const { accounts, contacts, opportunities } = useStore();
  const [expanded, setExpanded] = useState(true);

  // Show accounts in 'researching' status, sorted by priority
  const researchAccounts = useMemo(() => {
    return accounts
      .filter(a => a.accountStatus === 'researching')
      .sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
      })
      .slice(0, 5);
  }, [accounts]);

  if (researchAccounts.length === 0) return null;

  return (
    <motion.div
      className="rounded-xl border border-status-yellow/30 bg-status-yellow/5 p-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-status-yellow" />
          <h3 className="font-display text-sm font-semibold">Research Queue</h3>
          <Badge variant="outline" className="text-[10px] h-5">
            {researchAccounts.length} account{researchAccounts.length !== 1 ? 's' : ''}
          </Badge>
        </div>
        <Button
          variant="ghost" size="sm" className="h-7 w-7 p-0"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} />
        </Button>
      </div>

      {expanded && (
        <div className="space-y-3">
          {researchAccounts.map(account => {
            const acctContacts = contacts.filter(c => c.accountId === account.id);
            const acctOpps = opportunities.filter(o => o.accountId === account.id);
            const completed = RESEARCH_CHECKLIST.filter(item =>
              item.check(account, acctContacts, acctOpps)
            ).length;
            const total = RESEARCH_CHECKLIST.length;
            const pct = Math.round((completed / total) * 100);

            return (
              <div key={account.id} className="rounded-lg bg-card border border-border/50 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <button
                    className="text-sm font-semibold hover:text-primary transition-colors truncate text-left"
                    onClick={() => navigate(`/outreach?highlight=${account.id}`)}
                  >
                    {account.name}
                  </button>
                  <Badge variant="outline" className="text-[9px] h-4 px-1 ml-auto shrink-0">
                    Tier {account.tier}
                  </Badge>
                  <span className={cn(
                    "text-[10px] font-mono font-bold",
                    pct === 100 ? "text-status-green" : pct >= 50 ? "text-amber-500" : "text-muted-foreground"
                  )}>
                    {completed}/{total}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1">
                  {RESEARCH_CHECKLIST.map(item => {
                    const done = item.check(account, acctContacts, acctOpps);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-1.5 text-[11px]"
                        title={done ? item.label : item.tip}
                      >
                        {done ? (
                          <CheckCircle2 className="h-3 w-3 text-status-green shrink-0" />
                        ) : (
                          <Circle className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                        )}
                        <span className={cn(done ? "text-muted-foreground line-through" : "text-foreground")}>
                          {item.label}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Quick action: open account detail */}
                {pct < 100 && (
                  <Button
                    size="sm" variant="outline"
                    className="h-6 text-[10px] gap-1 mt-2 w-full"
                    onClick={() => navigate(`/outreach?highlight=${account.id}`)}
                  >
                    <ExternalLink className="h-3 w-3" /> Open & Complete Research
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
