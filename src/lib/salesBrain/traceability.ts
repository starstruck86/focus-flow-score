/**
 * Sales Brain — Traceability Helpers
 *
 * Bidirectional chain traversal:
 *   resource → insight → doctrine → downstream usage
 *   downstream usage → doctrine → insight → resource
 */

import {
  loadDoctrine,
  loadInsights,
  loadChangelog,
  type DoctrineEntry,
  type SalesBrainInsight,
  type DoctrineChangeEvent,
} from './doctrine';
import { getDoctrineUsageForId, type DoctrineUsageEvent } from './doctrineUsage';

export interface DoctrineTrace {
  doctrine: DoctrineEntry;
  linkedInsights: SalesBrainInsight[];
  linkedResourceIds: string[];
  usageEvents: DoctrineUsageEvent[];
  changelogSnippets: DoctrineChangeEvent[];
}

export interface ResourceTrace {
  resourceId: string;
  linkedInsights: SalesBrainInsight[];
  linkedDoctrine: DoctrineEntry[];
  doctrineCount: number;
}

export interface InsightTrace {
  insight: SalesBrainInsight;
  linkedResourceIds: string[];
  linkedDoctrine: DoctrineEntry[];
}

export function getDoctrineTrace(doctrineId: string): DoctrineTrace | null {
  const allDoctrine = loadDoctrine();
  const doctrine = allDoctrine.find(d => d.id === doctrineId);
  if (!doctrine) return null;

  const allInsights = loadInsights();
  const linkedInsights = allInsights.filter(i =>
    doctrine.sourceInsightIds.includes(i.id)
  );

  const changelog = loadChangelog();
  const changelogSnippets = changelog
    .filter(e => e.doctrineId === doctrineId)
    .slice(0, 20);

  return {
    doctrine,
    linkedInsights,
    linkedResourceIds: doctrine.sourceResourceIds,
    usageEvents: getDoctrineUsageForId(doctrineId),
    changelogSnippets,
  };
}

export function getResourceTrace(resourceId: string): ResourceTrace {
  const allInsights = loadInsights();
  const linkedInsights = allInsights.filter(i =>
    i.resourceIds.includes(resourceId)
  );

  const allDoctrine = loadDoctrine();
  const linkedDoctrine = allDoctrine.filter(d =>
    d.sourceResourceIds.includes(resourceId)
  );

  return {
    resourceId,
    linkedInsights,
    linkedDoctrine,
    doctrineCount: linkedDoctrine.length,
  };
}

export function getInsightTrace(insightId: string): InsightTrace | null {
  const allInsights = loadInsights();
  const insight = allInsights.find(i => i.id === insightId);
  if (!insight) return null;

  const allDoctrine = loadDoctrine();
  const linkedDoctrine = allDoctrine.filter(d =>
    d.sourceInsightIds.includes(insightId)
  );

  return {
    insight,
    linkedResourceIds: insight.resourceIds,
    linkedDoctrine,
  };
}

/** Get count of doctrine entries that trace back to a given resource */
export function getDoctrineCountForResource(resourceId: string): number {
  return loadDoctrine().filter(d => d.sourceResourceIds.includes(resourceId)).length;
}
