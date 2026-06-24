/**
 * ProjectsPanel — Supabase-backed Account Family Projects.
 *
 * Two-level UI inside the Strategy "Projects" surface:
 *   • Index: one row per `account_family` with counts.
 *   • Detail: family tree (parent_account_id), threads, signals, memory,
 *     and per-project custom instructions.
 *
 * Threads are filtered from the in-memory `threads` array passed by
 * StrategyShell — no extra fetch needed. Signals + memory are fetched
 * on demand when a project is opened.
 *
 * Phase A: read-only aggregation + editable instructions. "+ New thread"
 * pre-links to the root account but does NOT yet inject custom_instructions
 * into the system prompt — that's Phase B.
 */
import { useMemo, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { FolderKanban, ArrowLeft, ArrowRight, Building2, Radio, Brain, Plus, Save, Loader2 } from 'lucide-react';
import {
  listProjects,
  listProjectSettings,
  listProjectSignals,
  listProjectMemory,
  listSignalCountsByAccount,
  upsertProjectSettings,
  UNCATEGORIZED_FAMILY,
  type ProjectSummary,
  type ProjectMemberAccount,
} from '@/lib/strategy/accountProjects';
import { displayThreadTitle } from '@/lib/strategy/threadNaming';
import type { StrategyThread } from '@/types/strategy';

interface Props {
  threads: StrategyThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onCreateThreadForAccount?: (accountId: string, title?: string) => Promise<void>;
}

export function ProjectsPanel({ threads, activeThreadId, onSelectThread, onCreateThreadForAccount }: Props) {
  const { user } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);

  const { data: projects = [], isLoading } = useQuery<ProjectSummary[]>({
    queryKey: ['account-projects', user?.id],
    queryFn: () => listProjects(user!.id),
    enabled: !!user?.id,
  });

  const { data: settingsMap } = useQuery({
    queryKey: ['account-project-settings', user?.id],
    queryFn: () => listProjectSettings(user!.id),
    enabled: !!user?.id,
  });

  const { data: signalCountByAccount } = useQuery({
    queryKey: ['account-projects-signal-counts', user?.id],
    queryFn: () => listSignalCountsByAccount(user!.id),
    enabled: !!user?.id,
  });

  // Count threads + signals per family — done once, reused by index rows.
  const { threadCountByFamily, signalCountByFamily } = useMemo(() => {
    const threadMap = new Map<string, number>();
    const signalMap = new Map<string, number>();
    if (projects.length === 0) return { threadCountByFamily: threadMap, signalCountByFamily: signalMap };
    const acctFamily = new Map<string, string>();
    for (const p of projects) for (const m of p.members) acctFamily.set(m.id, p.familyKey);
    for (const t of threads) {
      if (!t.linked_account_id) continue;
      const fam = acctFamily.get(t.linked_account_id);
      if (!fam) continue;
      threadMap.set(fam, (threadMap.get(fam) ?? 0) + 1);
    }
    if (signalCountByAccount) {
      for (const [acctId, count] of signalCountByAccount.entries()) {
        const fam = acctFamily.get(acctId);
        if (!fam) continue;
        signalMap.set(fam, (signalMap.get(fam) ?? 0) + count);
      }
    }
    return { threadCountByFamily: threadMap, signalCountByFamily: signalMap };
  }, [threads, projects, signalCountByAccount]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8" style={{ color: 'hsl(var(--sv-muted))' }}>
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (selected) {
    const project = projects.find((p) => p.familyKey === selected);
    if (!project) {
      // Family vanished (deletes / refilter) — fall back to index.
      setSelected(null);
      return null;
    }
    return (
      <ProjectDetail
        project={project}
        threads={threads}
        activeThreadId={activeThreadId}
        onSelectThread={onSelectThread}
        onBack={() => setSelected(null)}
        initialInstructions={settingsMap?.get(selected)?.custom_instructions ?? ''}
      />
    );
  }

  return (
    <ProjectsIndex
      projects={projects}
      threadCountByFamily={threadCountByFamily}
      pinnedFamilies={new Set(Array.from(settingsMap?.values() ?? []).filter((s) => s.pinned).map((s) => s.account_family))}
      onOpen={setSelected}
    />
  );
}

// ─────────────── Index ───────────────

function ProjectsIndex({
  projects, threadCountByFamily, pinnedFamilies, onOpen,
}: {
  projects: ProjectSummary[];
  threadCountByFamily: Map<string, number>;
  pinnedFamilies: Set<string>;
  onOpen: (familyKey: string) => void;
}) {
  if (projects.length === 0) {
    return (
      <div
        className="rounded-[10px] p-5 text-center"
        style={{
          border: '1px dashed hsl(var(--sv-hairline))',
          background: 'hsl(var(--sv-hover) / 0.3)',
        }}
      >
        <FolderKanban className="h-5 w-5 mx-auto mb-2" style={{ color: 'hsl(var(--sv-muted))' }} />
        <p className="text-[13px]" style={{ color: 'hsl(var(--sv-ink))' }}>No projects yet</p>
        <p className="mt-1 text-[11.5px]" style={{ color: 'hsl(var(--sv-muted))' }}>
          Tag accounts with an Account Family on the Accounts page to group them as a Project.
        </p>
      </div>
    );
  }

  // Pinned first, then alphabetical (uncategorized stays last per listProjects).
  const sorted = [...projects].sort((a, b) => {
    const ap = pinnedFamilies.has(a.familyKey) ? 0 : 1;
    const bp = pinnedFamilies.has(b.familyKey) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return 0;
  });

  return (
    <div className="space-y-3" data-testid="projects-index">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.09em]" style={{ color: 'hsl(var(--sv-muted))' }}>
          Account Family Projects
        </h3>
        <span className="text-[10.5px] tabular-nums" style={{ color: 'hsl(var(--sv-muted) / 0.85)' }}>
          {projects.length} project{projects.length === 1 ? '' : 's'}
        </span>
      </div>
      <ul className="space-y-1.5">
        {sorted.map((p) => {
          const threadCount = threadCountByFamily.get(p.familyKey) ?? 0;
          return (
            <li key={p.familyKey}>
              <button
                type="button"
                onClick={() => onOpen(p.familyKey)}
                className="group w-full flex items-center gap-3 rounded-[8px] px-3 py-2.5 text-left transition-colors"
                style={{
                  background: 'hsl(var(--sv-paper))',
                  border: '1px solid hsl(var(--sv-hairline))',
                  borderLeft: '2px solid hsl(var(--sv-clay) / 0.45)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.6)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-paper))'; }}
                data-testid={`project-row-${p.familyKey}`}
              >
                <FolderKanban className="h-3.5 w-3.5 shrink-0" style={{ color: 'hsl(var(--sv-clay))' }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px]" style={{ color: 'hsl(var(--sv-ink))', fontWeight: 500 }}>
                      {p.label}
                    </span>
                  </div>
                  <div
                    className="mt-0.5 flex items-center gap-1.5 text-[11px] tabular-nums"
                    style={{ color: 'hsl(var(--sv-muted))' }}
                  >
                    <span>{p.members.length} acct{p.members.length === 1 ? '' : 's'}</span>
                    <span aria-hidden style={{ opacity: 0.5 }}>·</span>
                    <span>{threadCount} thread{threadCount === 1 ? '' : 's'}</span>
                  </div>
                </div>
                <ArrowRight
                  className="h-3 w-3 opacity-50 group-hover:opacity-100 transition-opacity"
                  style={{ color: 'hsl(var(--sv-clay))' }}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─────────────── Detail ───────────────

function ProjectDetail({
  project, threads, activeThreadId, onSelectThread, onBack, initialInstructions,
}: {
  project: ProjectSummary;
  threads: StrategyThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onBack: () => void;
  initialInstructions: string;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const memberIds = useMemo(() => project.members.map((m) => m.id), [project.members]);
  const acctById = useMemo(() => new Map(project.members.map((m) => [m.id, m])), [project.members]);

  const projectThreads = useMemo(() => {
    return threads
      .filter((t) => t.linked_account_id && acctById.has(t.linked_account_id))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [threads, acctById]);

  const { data: signals = [] } = useQuery({
    queryKey: ['project-signals', user?.id, project.familyKey, memberIds],
    queryFn: () => listProjectSignals(user!.id, memberIds, 10),
    enabled: !!user?.id && memberIds.length > 0,
  });

  const { data: memory = [] } = useQuery({
    queryKey: ['project-memory', user?.id, project.familyKey, memberIds],
    queryFn: () => listProjectMemory(user!.id, memberIds, 20),
    enabled: !!user?.id && memberIds.length > 0,
  });

  const [instructions, setInstructions] = useState(initialInstructions);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setInstructions(initialInstructions); }, [initialInstructions]);

  const dirty = instructions !== initialInstructions;

  async function saveInstructions() {
    if (!user || project.familyKey === UNCATEGORIZED_FAMILY) return;
    setSaving(true);
    try {
      await upsertProjectSettings(user.id, project.familyKey, {
        custom_instructions: instructions,
        pinned: false,
      });
      await qc.invalidateQueries({ queryKey: ['account-project-settings', user.id] });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5" data-testid={`project-detail-${project.familyKey}`}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[11.5px] px-2 py-1 rounded-[4px] sv-hover-bg"
          style={{ color: 'hsl(var(--sv-muted))' }}
        >
          <ArrowLeft className="h-3 w-3" /> All projects
        </button>
        <div className="flex-1" />
      </div>

      <div>
        <h2
          className="text-[16px] leading-tight tracking-tight"
          style={{ fontFamily: 'var(--sv-serif)', color: 'hsl(var(--sv-ink))', fontWeight: 500 }}
        >
          {project.label}
        </h2>
        <p className="text-[12px] mt-0.5" style={{ color: 'hsl(var(--sv-muted))' }}>
          {project.members.length} account{project.members.length === 1 ? '' : 's'} · {projectThreads.length} thread{projectThreads.length === 1 ? '' : 's'}
        </p>
      </div>

      {/* Family tree */}
      <Section icon={Building2} title="Accounts">
        <FamilyTree project={project} />
      </Section>

      {/* Threads */}
      <Section icon={FolderKanban} title={`Threads (${projectThreads.length})`}>
        {projectThreads.length === 0 ? (
          <EmptyHint text="No Strategy threads linked to these accounts yet." />
        ) : (
          <ul className="space-y-1">
            {projectThreads.slice(0, 12).map((t) => {
              const isActive = activeThreadId === t.id;
              const acct = t.linked_account_id ? acctById.get(t.linked_account_id) : null;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onSelectThread(t.id)}
                    className="group w-full flex items-center gap-3 rounded-[6px] px-2.5 py-2 text-left transition-colors"
                    style={{
                      background: isActive ? 'hsl(var(--sv-clay) / 0.08)' : 'transparent',
                      border: '1px solid hsl(var(--sv-hairline))',
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.5)'; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]" style={{ color: 'hsl(var(--sv-ink))', fontWeight: isActive ? 600 : 500 }}>
                        {displayThreadTitle(t)}
                      </div>
                      {acct && (
                        <div className="mt-0.5 text-[11px]" style={{ color: 'hsl(var(--sv-muted))' }}>
                          {acct.name}
                        </div>
                      )}
                    </div>
                    <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-70 transition-opacity" style={{ color: 'hsl(var(--sv-clay))' }} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Signals */}
      <Section icon={Radio} title={`Recent signals (${signals.length})`}>
        {signals.length === 0 ? (
          <EmptyHint text="No recent signals captured for these accounts." />
        ) : (
          <ul className="space-y-1.5">
            {signals.slice(0, 6).map((s) => (
              <li key={s.id} className="text-[12px]" style={{ color: 'hsl(var(--sv-ink))' }}>
                <div className="line-clamp-2">{s.raw_text}</div>
                <div className="mt-0.5 text-[11px]" style={{ color: 'hsl(var(--sv-muted))' }}>
                  {s.linked_account_name ?? '—'} · {new Date(s.created_at).toLocaleDateString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Cross-account memory */}
      <Section icon={Brain} title={`Account memory (${memory.length})`}>
        {memory.length === 0 ? (
          <EmptyHint text="No persisted strategy memory across these accounts yet." />
        ) : (
          <ul className="space-y-1.5">
            {memory.slice(0, 8).map((m) => {
              const acct = acctById.get(m.account_id);
              return (
                <li key={m.id} className="text-[12px]" style={{ color: 'hsl(var(--sv-ink))' }}>
                  <div className="line-clamp-2">{m.content}</div>
                  <div className="mt-0.5 text-[11px]" style={{ color: 'hsl(var(--sv-muted))' }}>
                    {acct?.name ?? 'Account'} · {m.memory_type ?? 'note'}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Project instructions */}
      {project.familyKey !== UNCATEGORIZED_FAMILY && (
        <Section icon={Plus} title="Project instructions">
          <p className="text-[11px] mb-1.5" style={{ color: 'hsl(var(--sv-muted))' }}>
            Saved with this Project. Phase B will inject these into Strategy prompts for threads opened from here.
          </p>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="e.g. Always assume NBCU evaluates against Adjust. Decision-maker is Sarah K."
            rows={4}
            className="w-full rounded-[6px] px-2.5 py-2 text-[12.5px] resize-y"
            style={{
              background: 'hsl(var(--sv-paper))',
              border: '1px solid hsl(var(--sv-hairline))',
              color: 'hsl(var(--sv-ink))',
            }}
          />
          <div className="mt-2 flex items-center justify-end">
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={saveInstructions}
              className="flex items-center gap-1.5 text-[11.5px] px-2.5 py-1.5 rounded-[4px]"
              style={{
                background: dirty ? 'hsl(var(--sv-clay))' : 'hsl(var(--sv-hover))',
                color: dirty ? 'white' : 'hsl(var(--sv-muted))',
                opacity: saving ? 0.6 : 1,
                cursor: dirty && !saving ? 'pointer' : 'default',
              }}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              {saving ? 'Saving' : 'Save instructions'}
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}

// ─────────────── bits ───────────────

function Section({
  icon: Icon, title, children,
}: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="h-3 w-3" style={{ color: 'hsl(var(--sv-clay))' }} />
        <h3 className="text-[11px] font-medium uppercase tracking-[0.09em]" style={{ color: 'hsl(var(--sv-muted))' }}>
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p className="text-[12px] italic" style={{ color: 'hsl(var(--sv-muted))' }}>{text}</p>
  );
}

function FamilyTree({ project }: { project: ProjectSummary }) {
  const childrenByParent = useMemo(() => {
    const map = new Map<string, ProjectMemberAccount[]>();
    for (const m of project.members) {
      if (!m.parent_account_id) continue;
      const list = map.get(m.parent_account_id) ?? [];
      list.push(m);
      map.set(m.parent_account_id, list);
    }
    return map;
  }, [project.members]);

  return (
    <ul className="space-y-0.5 text-[12.5px]" style={{ color: 'hsl(var(--sv-ink))' }}>
      {project.roots.map((root) => (
        <TreeNode key={root.id} node={root} childrenByParent={childrenByParent} depth={0} />
      ))}
    </ul>
  );
}

function TreeNode({
  node, childrenByParent, depth,
}: {
  node: ProjectMemberAccount;
  childrenByParent: Map<string, ProjectMemberAccount[]>;
  depth: number;
}) {
  const kids = childrenByParent.get(node.id) ?? [];
  return (
    <li>
      <div className="flex items-center gap-2 py-0.5" style={{ paddingLeft: `${depth * 14}px` }}>
        <Building2 className="h-3 w-3 shrink-0" style={{ color: 'hsl(var(--sv-muted))' }} />
        <span>{node.name}</span>
        {node.tier && (
          <span className="text-[10px] px-1 rounded" style={{ background: 'hsl(var(--sv-hover))', color: 'hsl(var(--sv-muted))' }}>
            {node.tier}
          </span>
        )}
      </div>
      {kids.length > 0 && (
        <ul className="space-y-0.5">
          {kids.map((k) => (
            <TreeNode key={k.id} node={k} childrenByParent={childrenByParent} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
