import { useEffect, useState } from 'react';
import { Layout } from '@/components/Layout';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useTerritoryProfile, type TerritoryProfile } from '@/hooks/useTerritoryProfile';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type Field = keyof TerritoryProfile;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-6">
      <h2 className="font-display text-base sm:text-lg font-bold">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export default function TerritorySetup() {
  const { profile, isLoading, updateProfile } = useTerritoryProfile();
  const [local, setLocal] = useState<Partial<TerritoryProfile>>({});

  useEffect(() => {
    if (profile) setLocal(profile);
  }, [profile]);

  const set = (k: Field, v: any) => setLocal((p) => ({ ...p, [k]: v }));

  const save = async (k: Field) => {
    try {
      await updateProfile({ [k]: local[k] } as any);
      toast.success('Saved', { duration: 1200 });
    } catch (e: any) {
      toast.error('Save failed', { description: e.message });
    }
  };

  const textInput = (label: string, k: Field, placeholder?: string, type: string = 'text') => (
    <div className="space-y-1.5">
      <Label htmlFor={k}>{label}</Label>
      <Input
        id={k}
        type={type}
        value={(local[k] as any) ?? ''}
        placeholder={placeholder}
        onChange={(e) => set(k, type === 'number' ? (e.target.value ? Number(e.target.value) : null) : e.target.value)}
        onBlur={() => save(k)}
        className="h-11 text-base"
      />
    </div>
  );

  const textArea = (label: string, k: Field, rows = 4, placeholder?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={k}>{label}</Label>
      <Textarea
        id={k}
        rows={rows}
        value={(local[k] as any) ?? ''}
        placeholder={placeholder}
        onChange={(e) => set(k, e.target.value)}
        onBlur={() => save(k)}
        className="text-base"
      />
    </div>
  );

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <header className="space-y-1">
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Territory Profile</h1>
          <p className="text-sm text-muted-foreground">
            This profile is automatically injected into every Territory Copilot and Strategy session so the AI knows who you are, what you sell, and what your territory looks like.
          </p>
        </header>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (
          <>
            <Section title="Your Role">
              {textInput('Name', 'name')}
              {textInput('Role', 'role', 'Strategic Account Executive')}
              {textInput('Company', 'company', 'Branch.io')}
              {textInput('Start date', 'start_date', '', 'date')}
            </Section>

            <Section title="Your Quota">
              {textInput('Quota amount', 'quota_amount', '1400000', 'number')}
              {textInput('Quota type', 'quota_type', 'Expansion / New logo / Renewal')}
              {textInput('Fiscal year start', 'fiscal_year_start', '', 'date')}
              {textInput('Fiscal year end', 'fiscal_year_end', '', 'date')}
            </Section>

            <Section title="Your Motion">
              {textArea('Sales motion', 'motion', 4, 'Defend and grow — expand existing customers...')}
            </Section>

            <Section title="Your Territory">
              {textArea('Territory description', 'territory_description', 6, 'Number of accounts, segments, geographies...')}
            </Section>

            <Section title="Company Context">
              {textArea('What your company sells', 'company_context', 8, 'Products, competitors, differentiation...')}
              {textArea('KI library summary', 'ki_library_summary', 4, 'How many KIs across what dimensions...')}
            </Section>

            <Section title="Your Team">
              {textInput('Sales Engineer', 'se_name')}
              {textInput('Customer Success Manager', 'csm_name')}
              {textInput('Manager', 'manager_name')}
            </Section>

            <Section title="Notes">
              {textArea('Custom notes', 'custom_notes', 5, 'Anything else the AI should always know...')}
            </Section>
          </>
        )}
      </div>
    </Layout>
  );
}
