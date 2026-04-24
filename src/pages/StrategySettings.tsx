/**
 * Strategy Settings — full page hosting Manage Strategy + Pill editor.
 *
 * Routes:
 *   /strategy/settings                      → workspace + pill list
 *   /strategy/settings/pill/new?surface=…   → new pill in given workspace
 *   /strategy/settings/pill/:id             → edit existing pill
 *
 * No modals. The page replaces the previous dark sheet experience so users
 * can configure workspaces and pills like custom GPTs.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Settings } from 'lucide-react';
import { ManageStrategyPanel } from '@/components/strategy/v2/ManageStrategyPanel';
import { PillEditorPanel } from '@/components/strategy/v2/PillEditorPanel';
import { GlobalInstructionsPanel } from '@/components/strategy/v2/GlobalInstructionsPanel';
import { listCustomPills, type CustomPill } from '@/lib/strategy/customPills';
import type { StrategySurfaceKey } from '@/components/strategy/v2/StrategyNavSidebar';
import '@/styles/strategy-v2.css';

export default function StrategySettings() {
  const { pillId } = useParams<{ pillId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [version, setVersion] = useState(0);

  const isNew = pillId === 'new';
  const isEditing = !!pillId;
  const surfaceParam = (searchParams.get('surface') as StrategySurfaceKey) || 'brainstorm';

  const editingPill = useMemo<CustomPill | null>(() => {
    if (!pillId || isNew) return null;
    return listCustomPills().find((p) => p.id === pillId) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pillId, isNew, version]);

  // If a pillId was passed but doesn't exist, bounce back to the list.
  useEffect(() => {
    if (pillId && !isNew && !editingPill) {
      navigate('/strategy/settings', { replace: true });
    }
  }, [pillId, isNew, editingPill, navigate]);

  return (
    <Layout>
      <div
        className="strategy-v2 flex flex-col flex-1 min-h-0 w-full"
        style={{ background: 'hsl(var(--sv-paper))' }}
      >
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto w-full px-5 sm:px-6 py-6" style={{ maxWidth: 880 }}>
            {/* Header */}
            <div className="flex items-center gap-2 mb-5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/strategy')}
                className="h-8 gap-1.5 text-[12.5px]"
                data-testid="settings-back"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Strategy
              </Button>
              <span style={{ color: 'hsl(var(--sv-muted))' }}>/</span>
              <div className="flex items-center gap-1.5">
                <Settings className="h-4 w-4" style={{ color: 'hsl(var(--sv-clay))' }} />
                <h1
                  className="text-[18px] font-semibold tracking-tight"
                  style={{ color: 'hsl(var(--sv-ink))' }}
                >
                  Strategy Settings
                </h1>
              </div>
            </div>

            {!isEditing && (
              <>
                <p className="text-[12.5px] mb-5" style={{ color: 'hsl(var(--sv-muted))' }}>
                  Configure workspaces and pills like custom GPTs. Changes save instantly.
                </p>

                {/* Phase 1 — Global Instructions Engine (UI + persistence only) */}
                <div className="mb-8">
                  <GlobalInstructionsPanel />
                </div>

                <ManageStrategyPanel
                  pillsVersion={version}
                  onAddPill={(surface) => navigate(`/strategy/settings/pill/new?surface=${surface}`)}
                  onEditPill={(pill) => navigate(`/strategy/settings/pill/${pill.id}`)}
                />
              </>
            )}

            {isEditing && (
              <PillEditorPanel
                editing={editingPill}
                surface={editingPill?.surface ?? surfaceParam}
                onSaved={() => {
                  setVersion((v) => v + 1);
                  navigate('/strategy/settings');
                }}
                onCancel={() => navigate('/strategy/settings')}
              />
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
