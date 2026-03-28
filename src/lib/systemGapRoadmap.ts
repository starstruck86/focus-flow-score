/**
 * System Gap → Product Roadmap Generator
 *
 * Converts system_gap resources into a prioritized roadmap of fixes.
 * Pure classification — does not mutate state.
 */

import type { VerifiedResource } from '@/lib/enrichmentVerification';

// ── Types ─────────────────────────────────────────────────

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface RoadmapIssue {
  issueName: string;
  affectedResources: number;
  severity: IssueSeverity;
  businessImpact: string;
  rootCauseSummary: string;
  requiredBuild: {
    type: 'parser' | 'integration' | 'pipeline_fix' | 'scoring_fix';
    description: string;
    suggestedImplementation: string;
  };
  exampleResources: Array<{ title: string; url: string | null }>;
  groupKey: string;
  failureType: string;
  subtype: string;
  subtypeLabel: string;
  resourceIds: string[];
}

export interface RoadmapSummary {
  totalSystemGaps: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  pctFailuresCausedBySystem: number;
  issues: RoadmapIssue[];
}

// ── Core flow patterns ────────────────────────────────────

const CORE_FLOW_SUBTYPES = new Set([
  'podcast_episode', 'youtube_video', 'blog_post', 'article',
  'google_doc', 'spotify_episode', 'apple_podcast_episode',
  'audio_file', 'zoom_recording',
]);

const CORE_FLOW_FAILURE_TYPES = new Set([
  'binary_content', 'extraction_failure', 'scoring_state_mismatch',
]);

// ── Severity classification ───────────────────────────────

function classifySeverity(
  count: number,
  subtype: string,
  failureType: string,
  blocksEnrichment: boolean,
): IssueSeverity {
  // Critical: blocks enrichment entirely, affects >10, or impacts core flows
  if (blocksEnrichment && count > 10) return 'critical';
  if (count > 10 && CORE_FLOW_SUBTYPES.has(subtype)) return 'critical';
  if (count > 10 && CORE_FLOW_FAILURE_TYPES.has(failureType)) return 'critical';

  // High: 5–10 resources, partially blocks
  if (count >= 5) return 'high';

  // Medium: 2–4
  if (count >= 2) return 'medium';

  // Low: edge cases
  return 'low';
}

function doesBlockEnrichment(failureType: string): boolean {
  return ['binary_content', 'platform_unsupported', 'extractor_bug', 'auth_gated'].includes(failureType);
}

// ── Business impact description ───────────────────────────

function describeBusinessImpact(
  count: number,
  subtypeLabel: string,
  failureType: string,
): string {
  if (failureType === 'binary_content') {
    return `${count} ${subtypeLabel} resources contain binary/audio data that cannot be processed — zero knowledge extraction possible.`;
  }
  if (failureType === 'platform_unsupported') {
    return `${count} ${subtypeLabel} resources from unsupported platforms — content is inaccessible to the system.`;
  }
  if (failureType === 'extractor_bug') {
    return `${count} ${subtypeLabel} resources have valid URLs but extraction produces insufficient content — knowledge is being lost.`;
  }
  if (failureType === 'scoring_state_mismatch') {
    return `${count} ${subtypeLabel} resources have incorrect quality scores — affects prioritization and trust in the system.`;
  }
  if (failureType === 'repeated_same_failure') {
    return `${count} ${subtypeLabel} resources fail repeatedly with the same error — pipeline cannot handle this pattern.`;
  }
  return `${count} ${subtypeLabel} resources blocked by system limitation — requires engineering fix.`;
}

// ── Issue naming ──────────────────────────────────────────

function generateIssueName(
  subtypeLabel: string,
  failureType: string,
  buildType: string,
): string {
  const failureLabels: Record<string, string> = {
    binary_content: 'Binary content extraction missing',
    platform_unsupported: 'Platform not supported',
    extractor_bug: 'Content extraction insufficient',
    scoring_state_mismatch: 'Score/status reconciliation broken',
    repeated_same_failure: 'Repeated pipeline failure',
    extraction_failure: 'Extraction pipeline failure',
    auth_gated: 'Auth-gated content inaccessible',
  };
  const label = failureLabels[failureType] || `${failureType} failure`;
  return `${label} — ${subtypeLabel}`;
}

// ── Main generator ────────────────────────────────────────

export function generateProductRoadmap(
  allResources: VerifiedResource[],
): RoadmapSummary {
  const gapResources = allResources.filter(r => r.resolutionType === 'system_gap');
  const totalBroken = allResources.filter(r => r.fixabilityBucket !== 'truly_complete').length;

  // Group by failureType + subtype + requiredBuild.type
  const groupMap = new Map<string, {
    resources: VerifiedResource[];
    failureType: string;
    subtype: string;
    subtypeLabel: string;
    buildType: string;
    buildDescription: string;
    buildSuggestion: string;
    rootCauses: string[];
  }>();

  for (const r of gapResources) {
    const ft = r.requiredBuild?.type || 'pipeline_fix';
    // Use remediation intelligence fields
    const plan = {
      failureType: inferFailureType(r),
      rootCause: r.rootCause || r.rootCauseCategory || 'Unknown',
    };

    const key = `${plan.failureType}::${r.subtype}::${ft}`;
    const existing = groupMap.get(key);
    if (existing) {
      existing.resources.push(r);
      if (!existing.rootCauses.includes(plan.rootCause)) {
        existing.rootCauses.push(plan.rootCause);
      }
    } else {
      groupMap.set(key, {
        resources: [r],
        failureType: plan.failureType,
        subtype: r.subtype,
        subtypeLabel: r.subtypeLabel,
        buildType: ft,
        buildDescription: r.requiredBuild?.description || 'System limitation requires engineering fix',
        buildSuggestion: r.requiredBuild?.suggestedImplementation || 'Investigate and build custom handler',
        rootCauses: [plan.rootCause],
      });
    }
  }

  // Convert groups to roadmap issues
  const issues: RoadmapIssue[] = Array.from(groupMap.entries()).map(([key, group]) => {
    const count = group.resources.length;
    const blocksEnrichment = doesBlockEnrichment(group.failureType);
    const severity = classifySeverity(count, group.subtype, group.failureType, blocksEnrichment);

    return {
      issueName: generateIssueName(group.subtypeLabel, group.failureType, group.buildType),
      affectedResources: count,
      severity,
      businessImpact: describeBusinessImpact(count, group.subtypeLabel, group.failureType),
      rootCauseSummary: group.rootCauses.join(' | '),
      requiredBuild: {
        type: group.buildType as RoadmapIssue['requiredBuild']['type'],
        description: group.buildDescription,
        suggestedImplementation: group.buildSuggestion,
      },
      exampleResources: group.resources.slice(0, 3).map(r => ({ title: r.title, url: r.url })),
      groupKey: key,
      failureType: group.failureType,
      subtype: group.subtype,
      subtypeLabel: group.subtypeLabel,
      resourceIds: group.resources.map(r => r.id),
    };
  });

  // Sort by severity then count
  const severityOrder: Record<IssueSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.affectedResources - a.affectedResources;
  });

  return {
    totalSystemGaps: gapResources.length,
    criticalIssues: issues.filter(i => i.severity === 'critical').length,
    highIssues: issues.filter(i => i.severity === 'high').length,
    mediumIssues: issues.filter(i => i.severity === 'medium').length,
    lowIssues: issues.filter(i => i.severity === 'low').length,
    pctFailuresCausedBySystem: totalBroken > 0
      ? Math.round((gapResources.length / totalBroken) * 100)
      : 0,
    issues,
  };
}

// ── Build prompt generator ────────────────────────────────

export function generateBuildPrompt(issue: RoadmapIssue): string {
  return `## System Gap Fix: ${issue.issueName}

**Severity:** ${issue.severity.toUpperCase()}
**Affected Resources:** ${issue.affectedResources}

### Problem
${issue.rootCauseSummary}

### Business Impact
${issue.businessImpact}

### Required Build
- **Type:** ${issue.requiredBuild.type}
- **Description:** ${issue.requiredBuild.description}

### Suggested Implementation
${issue.requiredBuild.suggestedImplementation}

### Example Resources
${issue.exampleResources.map(r => `- ${r.title}${r.url ? ` (${r.url})` : ''}`).join('\n')}

### Resource IDs
${issue.resourceIds.join(', ')}
`;
}

// ── Helpers ───────────────────────────────────────────────

function inferFailureType(r: VerifiedResource): string {
  if (r.whyNotComplete?.includes('binary') || r.rootCauseCategory?.includes('binary')) return 'binary_content';
  if (r.requiredBuild?.type === 'integration') return 'platform_unsupported';
  if (r.requiredBuild?.type === 'parser') return 'extractor_bug';
  if (r.requiredBuild?.type === 'scoring_fix') return 'scoring_state_mismatch';
  if (r.failureCount >= 2) return 'repeated_same_failure';
  return 'extraction_failure';
}
