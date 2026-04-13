/**
 * Skill Builder — Coverage Audit
 *
 * Inspects real KI clusters, tags, and curriculum to produce an honest
 * assessment of whether each skill can support 15 / 30 / 60 min sessions.
 */

import { supabase } from '@/integrations/supabase/client';
import type { SkillFocus } from '@/lib/dojo/scenarios';
import { SKILL_CURRICULA } from './learnSkillCurriculum';
import { CHAPTER_PATTERN_MAP } from '@/lib/dojo/v3/kiCatalogBridge';
import { tagKI, type KITag } from './kiClusterBuilder';
import type { KICatalogEntry } from '@/lib/dojo/v3/programmingEngine';
import { fetchFullKICatalog } from '@/lib/dojo/v3/kiCatalogBridge';
import { buildKIClusterMap } from './learnKIClusterMap';

// ── Types ──────────────────────────────────────────────────────────

export interface PatternCoverageAudit {
  focusPattern: string;
  skill: string;
  level: number;
  totalKIs: number;
  baselineCount: number;
  pressureCount: number;
  multiThreadCount: number;
  executiveCount: number;
  uniqueTitleCount: number;
  likelyRedundantCount: number;
  depthRating: 'thin' | 'usable' | 'deep';
}

export interface SkillCoverageAudit {
  skill: string;
  totalPatterns: number;
  coveredPatterns: number;
  thinPatterns: string[];
  usablePatterns: string[];
  deepPatterns: string[];
  hasEnoughFor15: boolean;
  hasEnoughFor30: boolean;
  hasEnoughFor60: boolean;
  totalKIs: number;
  pressureCoveragePct: number;
  multiThreadCoveragePct: number;
}

export interface CoverageAuditReport {
  perPattern: PatternCoverageAudit[];
  perSkill: SkillCoverageAudit[];
  strongestSkills: string[];
  weakestSkills: string[];
  globalGaps: string[];
  redundancyAlerts: string[];
}

// ── Title Normalization (for redundancy detection) ─────────────────

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countUniqueTitles(kis: KICatalogEntry[]): { unique: number; redundant: number } {
  const normalized = kis.map(ki => normalizeTitle(ki.title));
  const seen = new Set<string>();
  const stems = new Set<string>();

  for (const t of normalized) {
    // Use first 40 chars as a stem for near-duplicate detection
    const stem = t.slice(0, 40);
    stems.add(stem);
    seen.add(t);
  }

  const unique = Math.min(seen.size, stems.size);
  const redundant = kis.length - unique;
  return { unique: Math.max(unique, 0), redundant: Math.max(redundant, 0) };
}

// ── Tag counting ──────────────────────────────────────────────────

function countByTag(kis: KICatalogEntry[], tag: KITag): number {
  return kis.filter(ki => tagKI(ki).includes(tag)).length;
}

// ── Main Audit ────────────────────────────────────────────────────

export async function runSkillBuilderCoverageAudit(userId?: string): Promise<CoverageAuditReport> {
  // Fetch real KI catalog
  let catalog: KICatalogEntry[];
  if (userId) {
    catalog = await fetchFullKICatalog(userId);
  } else {
    // Fetch from any available user for dev audit
    const { data } = await supabase
      .from('knowledge_items' as any)
      .select('id, title, chapter, tags, knowledge_type, tactic_summary, when_to_use, confidence_score, updated_at, applies_to_contexts')
      .eq('active', true)
      .order('confidence_score', { ascending: false })
      .limit(500);

    catalog = (data as any[] ?? []).map((ki: any) => ({
      id: ki.id,
      title: ki.title ?? '',
      skills: deriveSkillsFromChapter(ki.chapter),
      focusPatterns: CHAPTER_PATTERN_MAP[ki.chapter] ?? [],
      lastTaughtAt: ki.updated_at ?? null,
    }));
  }

  const clusterMap = buildKIClusterMap(catalog);

  // Build per-pattern coverage
  const perPattern: PatternCoverageAudit[] = [];
  const patternKIMap = new Map<string, KICatalogEntry[]>();

  // Group catalog KIs by pattern
  for (const ki of catalog) {
    for (const p of ki.focusPatterns) {
      if (!patternKIMap.has(p)) patternKIMap.set(p, []);
      patternKIMap.get(p)!.push(ki);
    }
  }

  // Iterate over curriculum patterns
  for (const curriculum of Object.values(SKILL_CURRICULA)) {
    for (const level of curriculum.levels) {
      for (const pattern of level.focusPatterns) {
        // Avoid duplicates (same pattern can appear in multiple levels)
        if (perPattern.some(p => p.focusPattern === pattern && p.skill === curriculum.skill)) continue;

        const kis = patternKIMap.get(pattern) ?? [];
        const { unique, redundant } = countUniqueTitles(kis);

        const pressureCount = countByTag(kis, 'pressure');
        const multiThreadCount = countByTag(kis, 'multi_thread');
        const executiveCount = countByTag(kis, 'executive');
        const baselineCount = kis.length - pressureCount - multiThreadCount - executiveCount;

        let depthRating: 'thin' | 'usable' | 'deep';
        if (kis.length >= 6) depthRating = 'deep';
        else if (kis.length >= 3) depthRating = 'usable';
        else depthRating = 'thin';

        perPattern.push({
          focusPattern: pattern,
          skill: curriculum.skill,
          level: level.level,
          totalKIs: kis.length,
          baselineCount: Math.max(0, baselineCount),
          pressureCount,
          multiThreadCount,
          executiveCount,
          uniqueTitleCount: unique,
          likelyRedundantCount: redundant,
          depthRating,
        });
      }
    }
  }

  // Build per-skill coverage
  const perSkill: SkillCoverageAudit[] = [];
  const skills = Object.keys(SKILL_CURRICULA) as SkillFocus[];

  for (const skill of skills) {
    const skillPatterns = perPattern.filter(p => p.skill === skill);
    const thin = skillPatterns.filter(p => p.depthRating === 'thin').map(p => p.focusPattern);
    const usable = skillPatterns.filter(p => p.depthRating === 'usable').map(p => p.focusPattern);
    const deep = skillPatterns.filter(p => p.depthRating === 'deep').map(p => p.focusPattern);

    const usableOrDeep = usable.length + deep.length;
    const levelsRepresented = new Set(skillPatterns.filter(p => p.depthRating !== 'thin').map(p => p.level)).size;
    const totalRedundant = skillPatterns.reduce((s, p) => s + p.likelyRedundantCount, 0);
    const totalKIs = skillPatterns.reduce((s, p) => s + p.totalKIs, 0);
    const highRedundancy = totalKIs > 0 && totalRedundant / totalKIs > 0.4;

    const hasEnoughFor15 = usableOrDeep >= 2;
    const hasEnoughFor30 = usableOrDeep >= 3 && skillPatterns.some(p => p.level > 1 && p.depthRating !== 'thin');
    const hasEnoughFor60 = usableOrDeep >= 4 && levelsRepresented >= 2 && !highRedundancy;

    const withPressure = skillPatterns.filter(p => p.pressureCount > 0).length;
    const withMT = skillPatterns.filter(p => p.multiThreadCount > 0).length;

    perSkill.push({
      skill,
      totalPatterns: skillPatterns.length,
      coveredPatterns: skillPatterns.filter(p => p.totalKIs > 0).length,
      thinPatterns: thin,
      usablePatterns: usable,
      deepPatterns: deep,
      hasEnoughFor15,
      hasEnoughFor30,
      hasEnoughFor60,
      totalKIs,
      pressureCoveragePct: skillPatterns.length > 0 ? Math.round((withPressure / skillPatterns.length) * 100) : 0,
      multiThreadCoveragePct: skillPatterns.length > 0 ? Math.round((withMT / skillPatterns.length) * 100) : 0,
    });
  }

  // Determine strongest/weakest
  const sorted = [...perSkill].sort((a, b) => {
    const scoreA = a.deepPatterns.length * 3 + a.usablePatterns.length * 2 - a.thinPatterns.length;
    const scoreB = b.deepPatterns.length * 3 + b.usablePatterns.length * 2 - b.thinPatterns.length;
    return scoreB - scoreA;
  });

  const strongestSkills = sorted.slice(0, 2).map(s => s.skill);
  const weakestSkills = sorted.slice(-2).map(s => s.skill);

  // Global gaps
  const globalGaps: string[] = [];
  for (const s of perSkill) {
    if (!s.hasEnoughFor30) globalGaps.push(`${s.skill} cannot support 30-minute sessions`);
    if (s.pressureCoveragePct === 0) globalGaps.push(`${s.skill} has zero pressure coverage`);
  }

  // Redundancy alerts
  const redundancyAlerts: string[] = [];
  for (const p of perPattern) {
    if (p.totalKIs >= 5 && p.likelyRedundantCount >= 3) {
      redundancyAlerts.push(`${p.focusPattern} (${p.skill}): ${p.likelyRedundantCount}/${p.totalKIs} KIs likely redundant`);
    }
  }

  return { perPattern, perSkill, strongestSkills, weakestSkills, globalGaps, redundancyAlerts };
}

// ── Internal helpers ──────────────────────────────────────────────

function deriveSkillsFromChapter(chapter: string): SkillFocus[] {
  const map: Record<string, SkillFocus[]> = {
    cold_calling: ['objection_handling', 'deal_control'],
    opening: ['objection_handling', 'deal_control'],
    prospecting: ['deal_control'],
    discovery: ['discovery'],
    qualification: ['qualification'],
    needs_analysis: ['discovery'],
    objection_handling: ['objection_handling'],
    pricing: ['objection_handling'],
    competitive: ['objection_handling'],
    value_proposition: ['objection_handling'],
    negotiation: ['deal_control'],
    closing: ['deal_control'],
    deal_control: ['deal_control'],
    deal_strategy: ['deal_control'],
    follow_up: ['deal_control'],
    pipeline: ['deal_control'],
    executive: ['executive_response'],
    roi: ['executive_response'],
    business_case: ['executive_response'],
    leadership: ['executive_response'],
    c_suite: ['executive_response'],
    demo: ['executive_response'],
    expansion: ['executive_response'],
    messaging: ['objection_handling', 'deal_control'],
    stakeholder_navigation: ['discovery', 'qualification'],
    pipeline_management: ['deal_control'],
    pipeline_patterns: ['deal_control'],
    account_strategy: ['deal_control'],
  };
  return map[chapter] ?? ['objection_handling'];
}
