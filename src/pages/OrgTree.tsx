import { useMemo, useState } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { SafePage } from '@/components/SafePage';
import { useAuth } from '@/contexts/AuthContext';
import { fromActiveAccounts } from '@/data/accounts';
import { cn } from '@/lib/utils';

interface Account {
  id: string;
  name: string;
  industry: string | null;
  tier: string | null;
  parent_account_id: string | null;
  account_family: string | null;
  notes: string | null;
  next_step: string | null;
  next_touch_due: string | null;
}

type AccountNode = Account & { children: AccountNode[] };

function extractExpansionAngle(notes: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/expan[^.!?\n]*[.!?\n]?/i);
  if (!match) return null;
  return match[0].trim().slice(0, 120);
}

function buildTree(accounts: Account[]): AccountNode[] {
  const map = new Map<string, AccountNode>(
    accounts.map((a) => [a.id, { ...a, children: [] as AccountNode[] }]),
  );
  const roots: AccountNode[] = [];
  for (const node of map.values()) {
    if (node.parent_account_id && map.has(node.parent_account_id)) {
      map.get(node.parent_account_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sort = (nodes: AccountNode[]): AccountNode[] => {
    nodes.sort(
      (a, b) =>
        (a.tier ?? 'Z').localeCompare(b.tier ?? 'Z') ||
        a.name.localeCompare(b.name),
    );
    nodes.forEach((n) => sort(n.children));
    return nodes;
  };
  return sort(roots);
}

function AccountTreeNode({
  node,
  depth,
  navigate,
}: {
  node: AccountNode;
  depth: number;
  navigate: NavigateFunction;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const expansionAngle = extractExpansionAngle(node.notes);

  return (
    <div>
      <div
        className={cn(
          'flex items-start gap-2 py-2 px-3 rounded-lg active:bg-muted/60',
          depth === 0 ? 'bg-muted/30' : '',
        )}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="mt-0.5 shrink-0 text-muted-foreground"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 transition-transform',
                expanded && 'rotate-90',
              )}
            />
          </button>
        ) : (
          <div className="w-3.5 shrink-0" />
        )}

        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => navigate(`/accounts/${node.id}`)}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{node.name}</span>
            {node.tier && (
              <span
                className={cn(
                  'text-[10px] font-bold px-1.5 py-0.5 rounded-full border',
                  node.tier === 'A'
                    ? 'bg-primary/10 text-primary border-primary/20'
                    : 'bg-muted text-muted-foreground border-border',
                )}
              >
                {node.tier}
              </span>
            )}
          </div>
          {node.industry && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {node.industry}
            </p>
          )}
          {expansionAngle && (
            <p className="text-xs text-muted-foreground/80 mt-0.5 line-clamp-1 italic">
              {expansionAngle}
            </p>
          )}
          {node.next_step && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
              <span className="font-medium">Next:</span> {node.next_step}
            </p>
          )}
        </div>

        {hasChildren && (
          <span className="text-[10px] text-muted-foreground shrink-0 mt-1">
            {node.children.length} sub
          </span>
        )}
      </div>

      {expanded && hasChildren && (
        <div className="relative">
          <div
            className="absolute top-0 bottom-0 w-px bg-border/60"
            style={{ left: `${12 + depth * 20 + 5}px` }}
          />
          {node.children.map((child) => (
            <AccountTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              navigate={navigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrgTree() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['org-tree-accounts', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await fromActiveAccounts()
        .select(
          'id, name, industry, tier, parent_account_id, account_family, notes, next_step, next_touch_due',
        )
        .eq('user_id', user!.id);
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });

  const tree = useMemo(() => buildTree(accounts), [accounts]);

  const families = useMemo(() => {
    const f = new Set(
      accounts.filter((a) => a.account_family).map((a) => a.account_family!),
    );
    return Array.from(f).sort();
  }, [accounts]);

  const standaloneCount = accounts.filter((a) => !a.account_family).length;

  return (
    <SafePage className="flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Account Org Tree
        </p>
        <span className="text-xs text-muted-foreground">
          {accounts.length} accts
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {families.length > 0 && (
          <div className="px-4 py-2.5 flex flex-wrap gap-2 border-b border-border/30">
            {families.map((f) => (
              <span
                key={f}
                className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/60"
              >
                {f}
              </span>
            ))}
            {standaloneCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/60">
                {standaloneCount} standalone
              </span>
            )}
          </div>
        )}

        <div className="px-2 py-3 space-y-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
            </div>
          ) : tree.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12">
              No accounts yet.
            </div>
          ) : (
            tree.map((root) => (
              <AccountTreeNode
                key={root.id}
                node={root}
                depth={0}
                navigate={navigate}
              />
            ))
          )}
        </div>
      </div>
    </SafePage>
  );
}
