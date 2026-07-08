/**
 * TerritoryTree — shows all Branch accounts organized by corporate family.
 * Parents with children render as expandable groups; standalones flat.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface AccountRow {
  id: string;
  name: string;
  tier: string | null;
  account_status: string | null;
  last_touch_date: string | null;
  icp_fit_score: number | null;
  parent_account_id: string | null;
  account_family: string | null;
}

interface AccountNode {
  account: AccountRow;
  children: AccountNode[];
  depth: number;
}

function buildTree(accounts: AccountRow[]): {
  families: Map<string, AccountNode[]>;
  standalones: AccountNode[];
} {
  const roots = accounts.filter(a => !a.parent_account_id);

  const nodes: AccountNode[] = roots.map(a => ({
    account: a,
    depth: 0,
    children: accounts
      .filter(c => c.parent_account_id === a.id)
      .map(c => ({
        account: c,
        depth: 1,
        children: accounts
          .filter(gc => gc.parent_account_id === c.id)
          .map(gc => ({ account: gc, children: [], depth: 2 })),
      })),
  }));

  const families = new Map<string, AccountNode[]>();
  const standalones: AccountNode[] = [];

  for (const node of nodes) {
    if (node.account.account_family && node.children.length > 0) {
      const list = families.get(node.account.account_family) ?? [];
      list.push(node);
      families.set(node.account.account_family, list);
    } else {
      standalones.push(node);
    }
  }

  standalones.sort((a, b) => {
    const ta = a.account.tier ?? 'Z';
    const tb = b.account.tier ?? 'Z';
    if (ta !== tb) return ta.localeCompare(tb);
    return (b.account.icp_fit_score ?? 0) - (a.account.icp_fit_score ?? 0);
  });

  return { families, standalones };
}

function AccountRowView({
  account,
  depth = 0,
  onClick,
}: {
  account: AccountRow;
  depth?: number;
  onClick: (id: string) => void;
}) {
  const daysAgo = account.last_touch_date
    ? Math.floor((Date.now() - new Date(account.last_touch_date).getTime()) / 86400000)
    : null;

  const tier = account.tier ?? '—';

  return (
    <div
      className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/40 cursor-pointer transition-colors"
      style={{ paddingLeft: `${12 + depth * 20}px` }}
      onClick={() => onClick(account.id)}
    >
      {depth > 0 && <span className="text-muted-foreground/40 text-xs">└</span>}
      <span
        className={cn(
          'text-[10px] font-bold px-1.5 py-0.5 rounded',
          tier === 'A'
            ? 'bg-green-500/15 text-green-600'
            : tier === 'B'
            ? 'bg-amber-500/15 text-amber-600'
            : 'bg-muted text-muted-foreground'
        )}
      >
        {tier}
      </span>
      <span className="text-sm font-medium flex-1 truncate">{account.name}</span>
      {account.account_status && (
        <span className="text-[10px] text-muted-foreground hidden sm:inline">
          {account.account_status}
        </span>
      )}
      {account.icp_fit_score != null && (
        <span className="text-[10px] text-muted-foreground font-mono">
          {account.icp_fit_score}
        </span>
      )}
      <span
        className={cn(
          'text-[10px] font-medium shrink-0 w-10 text-right',
          daysAgo === null
            ? 'text-muted-foreground'
            : daysAgo <= 7
            ? 'text-green-500'
            : daysAgo <= 14
            ? 'text-amber-500'
            : 'text-red-500'
        )}
      >
        {daysAgo === null ? 'Never' : `${daysAgo}d`}
      </span>
    </div>
  );
}

function renderNode(node: AccountNode, onClick: (id: string) => void): JSX.Element {
  return (
    <div key={node.account.id} className="relative">
      <AccountRowView account={node.account} depth={node.depth} onClick={onClick} />
      {node.children.length > 0 && (
        <div className="border-l border-border/40 ml-6">
          {node.children.map(c => renderNode(c, onClick))}
        </div>
      )}
    </div>
  );
}

export function TerritoryTree() {
  const navigate = useNavigate();

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['territory-tree-accounts'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // W1 fix #3: query raw accounts + soft-delete filter — the active_accounts
      // view lacks parent_account_id / account_family, so the previous select
      // errored silently and the tree rendered "No accounts yet".
      const { data, error } = await supabase
        .from('accounts')
        .select(
          'id, name, tier, account_status, last_touch_date, icp_fit_score, parent_account_id, account_family'
        )
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      return (data ?? []) as AccountRow[];
    },
  });

  const { families, standalones } = useMemo(
    () => buildTree(accounts ?? []),
    [accounts]
  );

  const handleClick = (id: string) => navigate(`/accounts/${id}`);

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground p-4">Loading territory…</div>
    );
  }

  if (!accounts || accounts.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-4">No accounts yet.</div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-2 space-y-1">
      {Array.from(families.entries()).map(([family, nodes]) => (
        <div key={family}>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-3 pt-3 pb-1">
            {family}
          </div>
          {nodes.map(n => renderNode(n, handleClick))}
        </div>
      ))}

      {standalones.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-3 pt-3 pb-1">
            Standalone
          </div>
          {standalones.map(n => renderNode(n, handleClick))}
        </div>
      )}
    </div>
  );
}

export default TerritoryTree;
