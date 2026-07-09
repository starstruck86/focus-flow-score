// Settings — Guide v3 §6 contract.
// Rows: How Dynamic works · Territory · Integrations · Notifications ·
// Strategy pills & contracts · Data & backups · Admin & QA drawer ·
// (advanced) legacy settings link.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  Settings as SettingsIcon,
  Map as MapIcon,
  Plug,
  Bell,
  Sparkles,
  Database,
  Shield,
  BookOpen,
  Wrench,
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { NotificationSettings } from '@/components/NotificationSettings';
import { supabase } from '@/integrations/supabase/client';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { useAuth } from '@/contexts/AuthContext';
import GUIDE_MD from '../../docs/GUIDE.md?raw';

// ── Tokens (Guide v3 §8) ──────────────────────────────────────────────
const T = {
  ink: 'bg-[hsl(var(--brand-ink))]',
  panel: 'bg-[hsl(var(--brand-panel))]',
  line: 'border-[hsl(var(--brand-line))]',
  text: 'text-[hsl(var(--brand-text))]',
  muted: 'text-[hsl(var(--brand-muted))]',
};

// Admin/QA route ledger (Guide v3 §5).
// Every admin/QA route mounted in App.tsx that is intentionally hidden
// from visible nav. Add rows here — do NOT add them back to BottomNav.
const ADMIN_ROUTES: { path: string; label: string; group: string }[] = [
  { path: '/ops', label: 'Ops / Diagnostics', group: 'Ops' },
  { path: '/admin/ops', label: 'Strategy Ops Panel', group: 'Ops' },
  { path: '/admin/lifecycle-reconciliation', label: 'Lifecycle Reconciliation', group: 'Ops' },
  { path: '/admin/phase-evidence', label: 'Phase Evidence Runner', group: 'Ops' },
  { path: '/observability', label: 'Observability Dashboard', group: 'Ops' },
  { path: '/reliability', label: 'Reliability QA', group: 'Ops' },
  // /smoke-test retired (W5)
  { path: '/admin/nav-usage', label: 'Nav Usage', group: 'Ops' },

  { path: '/verify-enrichment', label: 'Verify Enrichment', group: 'Knowledge' },
  { path: '/extraction-admin', label: 'Extraction Admin', group: 'Knowledge' },
  { path: '/bulk-extract', label: 'Bulk Extract Runner', group: 'Knowledge' },
  { path: '/benchmark', label: 'Benchmark', group: 'Knowledge' },
  { path: '/batch-regrade', label: 'Batch Regrade', group: 'Knowledge' },
  { path: '/course-imports', label: 'Course Imports', group: 'Knowledge' },
  { path: '/learn/skill-builder-audit', label: 'Skill-Builder Audit', group: 'Knowledge' },

  { path: '/dojo/qa', label: 'Dojo QA', group: 'Dojo' },
  // /dojo/v6-qa retired (W5)

  { path: '/strategy/debug', label: 'Strategy Debug', group: 'Strategy' },
  { path: '/strategy/control', label: 'Strategy Control Panel', group: 'Strategy' },
];

// ── Integration status hooks ─────────────────────────────────────────
function useCalendarStatus() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['settings-calendar-status', user?.id],
    enabled: !!user?.id,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('integration_runs')
        .select('ran_at, status')
        .eq('source', 'calendar')
        .order('ran_at', { ascending: false })
        .limit(1);
      return data?.[0] ?? null;
    },
  });
}

// Voice status — real dave-health-check (authed). Not a fake ping.
function useVoiceStatus() {
  return useQuery({
    queryKey: ['settings-voice-health'],
    staleTime: 5 * 60_000,
    refetchOnMount: true,
    queryFn: async () => {
      const { data, error } = await trackedInvoke<any>('dave-health-check');
      if (error) throw error;
      return data as { apiKeySet: boolean; apiKeyValid: boolean; agentIdSet: boolean; tokenGenOk: boolean; error: string | null };
    },
  });
}


type StatusLevel = 'ok' | 'warn' | 'bad' | 'idle';
function StatusDot({ level }: { level: StatusLevel }) {
  const color =
    level === 'ok' ? 'bg-[hsl(var(--brand-train))]' :
    level === 'warn' ? 'bg-[hsl(var(--brand-work))]' :
    level === 'bad' ? 'bg-red-500' :
    'bg-[hsl(var(--brand-line))]';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />;
}

// ── Row primitives ───────────────────────────────────────────────────
function Row({
  icon,
  title,
  hint,
  right,
  onClick,
  to,
  expanded,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: React.ReactNode;
  right?: React.ReactNode;
  onClick?: () => void;
  to?: string;
  expanded?: boolean;
}) {
  const body = (
    <div className={`flex items-center gap-3 px-4 py-3.5 ${T.text}`}>
      <span className={T.muted}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-medium leading-tight">{title}</div>
        {hint && <div className={`text-xs mt-0.5 ${T.muted}`}>{hint}</div>}
      </div>
      {right}
      {(to || onClick) && (
        expanded === undefined
          ? <ChevronRight className={`h-4 w-4 ${T.muted}`} />
          : <ChevronDown className={`h-4 w-4 ${T.muted} transition-transform ${expanded ? 'rotate-180' : ''}`} />
      )}
    </div>
  );
  if (to) return <Link to={to} className="block hover:bg-white/[0.03]">{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className="w-full text-left hover:bg-white/[0.03]">{body}</button>;
  return body;
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${T.panel} border ${T.line} rounded-2xl overflow-hidden divide-y divide-[hsl(var(--brand-line))]`}>
      {children}
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────
export default function Settings() {
  const [guideOpen, setGuideOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const calStatus = useCalendarStatus();
  const voiceStatus = useVoiceStatus();

  const cal = useMemo<{ level: StatusLevel; label: string }>(() => {
    if (calStatus.isLoading) return { level: 'idle', label: 'Checking…' };
    const row = calStatus.data;
    if (!row) return { level: 'bad', label: 'Never synced' };
    const ageMin = (Date.now() - new Date(row.ran_at).getTime()) / 60000;
    if (row.status !== 'success') return { level: 'bad', label: `Last run failed (${Math.round(ageMin)}m ago)` };
    if (ageMin < 15) return { level: 'ok', label: `Fresh · ${Math.round(ageMin)}m ago` };
    if (ageMin < 60) return { level: 'warn', label: `Stale · ${Math.round(ageMin)}m ago` };
    return { level: 'bad', label: `Stale · ${Math.round(ageMin / 60)}h ago` };
  }, [calStatus.data, calStatus.isLoading]);

  const voice = useMemo<{ level: StatusLevel; label: string }>(() => {
    if (voiceStatus.isLoading) return { level: 'idle', label: 'Checking…' };
    if (voiceStatus.isError) return { level: 'bad', label: 'Health check failed — check /ops' };
    const d = voiceStatus.data;
    if (!d) return { level: 'idle', label: 'Unknown' };
    if (d.tokenGenOk && d.apiKeyValid) return { level: 'ok', label: 'Connected · ElevenLabs key valid' };
    if (d.apiKeySet && d.agentIdSet) return { level: 'warn', label: d.error ? `Configured · token gen error: ${String(d.error).slice(0, 80)}` : 'Configured · token gen not verified' };
    if (!d.apiKeySet) return { level: 'bad', label: 'ELEVENLABS_API_KEY missing' };
    if (!d.agentIdSet) return { level: 'bad', label: 'ELEVENLABS_AGENT_ID missing' };
    return { level: 'warn', label: 'Configured · unverified' };
  }, [voiceStatus.data, voiceStatus.isLoading, voiceStatus.isError]);


  // Group admin routes for the drawer.
  const grouped = useMemo(() => {
    const g: Record<string, typeof ADMIN_ROUTES> = {};
    ADMIN_ROUTES.forEach(r => { (g[r.group] ||= []).push(r); });
    return g;
  }, []);

  return (
    <Layout>
      <div className={`min-h-screen ${T.ink} pb-24`}>
        <header className={`sticky top-0 z-10 ${T.ink} border-b ${T.line} px-4 py-3`}>
          <div className="flex items-center gap-2">
            <SettingsIcon className={`h-5 w-5 ${T.muted}`} />
            <h1 className={`text-lg font-semibold ${T.text}`}>Settings</h1>
          </div>
        </header>

        <div className="p-4 space-y-4 max-w-2xl mx-auto">
          {/* 1 · How Dynamic works — renders GUIDE.md */}
          <Section>
            <Row
              icon={<BookOpen className="h-4 w-4" />}
              title="How Dynamic works"
              hint="The in-app guide (v3)"
              onClick={() => setGuideOpen(v => !v)}
              expanded={guideOpen}
            />
            {guideOpen && (
              <div className={`px-5 py-5 ${T.text}`}>
                <article className="prose prose-invert prose-sm max-w-none prose-headings:text-[hsl(var(--brand-text))] prose-p:text-[hsl(var(--brand-text))]/90 prose-strong:text-[hsl(var(--brand-text))] prose-a:text-[hsl(var(--brand-train))] prose-code:text-[hsl(var(--brand-work))] prose-hr:border-[hsl(var(--brand-line))] prose-li:text-[hsl(var(--brand-text))]/90">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{GUIDE_MD}</ReactMarkdown>
                </article>
              </div>
            )}
          </Section>

          {/* 2 · Territory */}
          <Section>
            <Row
              icon={<MapIcon className="h-4 w-4" />}
              title="Territory setup"
              hint="Accounts, quota, working hours"
              to="/settings/territory"
            />
          </Section>

          {/* 3 · Integrations */}
          <Section>
            <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider text-[hsl(var(--brand-muted))]">Integrations</div>
            <Row
              icon={<Plug className="h-4 w-4" />}
              title="Calendar"
              hint={cal.label}
              right={<StatusDot level={cal.level} />}
            />
            <Row
              icon={<Plug className="h-4 w-4" />}
              title="Voice (ElevenLabs)"
              hint={voice.label}
              right={<StatusDot level={voice.level} />}
            />
          </Section>

          {/* 4 · Notifications & nudges */}
          <Section>
            <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider text-[hsl(var(--brand-muted))]">Notifications & nudges</div>
            <div className="p-2">
              <NotificationSettings />
            </div>
          </Section>

          {/* 5 · Strategy pills & contracts */}
          <Section>
            <Row
              icon={<Sparkles className="h-4 w-4" />}
              title="Strategy pills & contracts"
              hint="Discovery prep, skill plan, thread settings"
              to="/strategy/settings"
            />
          </Section>

          {/* 6 · Data & backups — static informational row (no fake status) */}
          <Section>
            <Row
              icon={<Database className="h-4 w-4" />}
              title="Data & backups"
              hint="n8n weekly backup runs against the primary database. Status is not surfaced in-app; check the n8n workflow directly."
            />
          </Section>

          {/* 7 · Admin & QA — expandable drawer, all routes reachable */}
          <Section>
            <Row
              icon={<Shield className="h-4 w-4" />}
              title="Admin & QA"
              hint={`${ADMIN_ROUTES.length} routes · hidden from primary nav`}
              onClick={() => setAdminOpen(v => !v)}
              expanded={adminOpen}
            />
            {adminOpen && (
              <div className="px-3 py-3 space-y-4">
                {Object.entries(grouped).map(([group, rows]) => (
                  <div key={group}>
                    <div className="px-2 pb-1 text-[11px] uppercase tracking-wider text-[hsl(var(--brand-muted))]">{group}</div>
                    <div className={`rounded-lg border ${T.line} divide-y divide-[hsl(var(--brand-line))]`}>
                      {rows.map(r => (
                        <Link
                          key={r.path}
                          to={r.path}
                          className={`flex items-center justify-between px-3 py-2 text-sm ${T.text} hover:bg-white/[0.03]`}
                        >
                          <span>{r.label}</span>
                          <span className={`text-[11px] ${T.muted}`}>{r.path}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Advanced / legacy — preserves the old detailed settings page */}
          <Section>
            <Row
              icon={<Wrench className="h-4 w-4" />}
              title="Advanced / legacy tools"
              hint="Imports, appearance, conversion benchmarks, knowledge export, Dave health"
              to="/settings/legacy"
            />
          </Section>
        </div>
      </div>
    </Layout>
  );
}
