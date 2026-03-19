import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { CORE_FOLDERS, type CoreFolderName } from './useResourceUpload';

/**
 * Maps a legacy folder name to the best-fit core folder.
 */
function mapToCoreFolderName(name: string): CoreFolderName {
  const lower = name.toLowerCase().trim();

  // Exact matches (case-insensitive)
  for (const core of CORE_FOLDERS) {
    if (lower === core.toLowerCase()) return core;
  }

  // Keyword-based mapping
  if (/framework|meddicc|spin|methodology|value.?sell/i.test(lower)) return 'Frameworks';
  if (/playbook|sequence|cadence|motion/i.test(lower)) return 'Playbooks';
  if (/template|email|cadence|follow.?up/i.test(lower)) return 'Templates';
  if (/training|course|certif|learning|onboard|skill|coaching|book/i.test(lower)) return 'Training';
  if (/discovery|research|persona|icp|buyer|lead.?gen|prospect/i.test(lower)) return 'Discovery';
  if (/presentation|deck|slide|demo/i.test(lower)) return 'Presentations';
  if (/battlecard|battle.?card|competit|objection/i.test(lower)) return 'Battlecards';
  if (/transcript|recording|call/i.test(lower)) return 'Tools & Reference';
  if (/sales\s*(enablement|management|strategy|document|best.?prac|perform|product|psychol)/i.test(lower)) return 'Playbooks';
  if (/career|personal.?dev/i.test(lower)) return 'Training';
  if (/strategy|guide/i.test(lower)) return 'Playbooks';
  if (/tool|reference|calculator|link/i.test(lower)) return 'Tools & Reference';

  return 'Tools & Reference';
}

/**
 * Auto-consolidates legacy top-level folders under the 8 core folders.
 * Runs once per session. Non-core top-level folders become sub-folders of the matching core folder.
 */
export function useConsolidateFolders() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const hasRun = useRef(false);

  useEffect(() => {
    if (!user || hasRun.current) return;
    hasRun.current = true;

    (async () => {
      try {
        // Fetch all folders
        const { data: allFolders, error } = await supabase
          .from('resource_folders')
          .select('*')
          .eq('user_id', user.id);
        if (error || !allFolders) return;

        const topLevel = allFolders.filter(f => !f.parent_id);
        const coreNames = CORE_FOLDERS.map(n => n.toLowerCase());

        // Find which top-level folders are core (case-insensitive)
        const coreFolders = topLevel.filter(f => coreNames.includes(f.name.toLowerCase()));
        const nonCoreFolders = topLevel.filter(f => !coreNames.includes(f.name.toLowerCase()));

        if (nonCoreFolders.length === 0) return; // Nothing to consolidate

        // Ensure all 8 core folders exist
        const existingCoreNames = new Set(coreFolders.map(f => f.name.toLowerCase()));
        const missingCores = CORE_FOLDERS.filter(n => !existingCoreNames.has(n.toLowerCase()));

        for (const name of missingCores) {
          const { data: newFolder } = await supabase
            .from('resource_folders')
            .insert({ name, user_id: user.id, sort_order: CORE_FOLDERS.indexOf(name) })
            .select()
            .single();
          if (newFolder) coreFolders.push(newFolder as any);
        }

        // Build lookup: core name (lower) → folder id
        const coreIdMap = new Map<string, string>();
        for (const f of coreFolders) {
          coreIdMap.set(f.name.toLowerCase(), f.id);
        }

        // Remap non-core folders as sub-folders
        for (const folder of nonCoreFolders) {
          const targetCoreName = mapToCoreFolderName(folder.name);
          const targetCoreId = coreIdMap.get(targetCoreName.toLowerCase());
          if (!targetCoreId) continue;

          // Update this folder to be a child of the core folder
          await supabase
            .from('resource_folders')
            .update({ parent_id: targetCoreId })
            .eq('id', folder.id);
        }

        // Invalidate folder queries so UI refreshes
        qc.invalidateQueries({ queryKey: ['resource-folders'] });
      } catch (e) {
        console.error('Folder consolidation error:', e);
      }
    })();
  }, [user, qc]);
}
