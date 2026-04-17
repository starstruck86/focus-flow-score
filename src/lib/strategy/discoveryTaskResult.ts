import type {
  DiscoverySection,
  LibraryCoverageEntry,
  Redline,
  RubricCheck,
  SourceEntry,
  TaskRunResult,
} from '@/hooks/strategy/useTaskExecution';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter((item) => item != null) : [];
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asStringArray(value: unknown): string[] {
  return asArray(value).map(asString).filter(Boolean);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (isRecord(value)) return Object.values(value).some(hasMeaningfulValue);
  return false;
}

function sanitizeGenericValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeGenericValue(item, depth + 1))
      .filter((item) => item != null && hasMeaningfulValue(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, sanitizeGenericValue(item, depth + 1)] as const)
        .filter(([, item]) => item != null),
    );
  }
  return null;
}

function normalizeObjectRows(value: unknown, keys: string[]): UnknownRecord[] {
  const rows: UnknownRecord[] = [];
  for (const item of asArray(value)) {
    const record = asRecord(item);
    const next: UnknownRecord = Object.fromEntries(
      keys.map((key) => [key, asString(record[key])])
    );
    if (hasMeaningfulValue(next)) rows.push(next);
  }
  return rows;
}

function normalizeCockpitContent(content: unknown) {
  const record = asRecord(content);
  return {
    cards: asArray(record.cards)
      .map((item) => {
        const card = asRecord(item);
        const next = {
          label: asString(card.label),
          value: asString(card.value),
          bullets: asStringArray(card.bullets),
        };
        return hasMeaningfulValue(next) ? next : null;
      })
      .filter((item): item is { label: string; value: string; bullets: string[] } => item !== null),
  };
}

function normalizeParticipantsContent(content: unknown) {
  const record = asRecord(content);
  const normalizePeople = (value: unknown) => asArray(value)
    .map((item) => {
      const person = asRecord(item);
      const next = {
        name: asString(person.name),
        title: asString(person.title),
        role: asString(person.role),
        side: asString(person.side),
      };
      return hasMeaningfulValue(next) ? next : null;
    })
    .filter((item): item is { name: string; title: string; role: string; side: string } => item !== null);

  return {
    prospect: normalizePeople(record.prospect),
    internal: normalizePeople(record.internal),
  };
}

function normalizeDiscoveryQuestionsContent(content: unknown) {
  const record = asRecord(content);
  const valueFlow = asRecord(record.value_flow);
  return {
    questions: asStringArray(record.questions),
    value_flow: {
      current_state: asString(valueFlow.current_state),
      problem: asString(valueFlow.problem),
      impact: asString(valueFlow.impact),
      ideal_solution: asString(valueFlow.ideal_solution),
      business_benefit: asString(valueFlow.business_benefit),
    },
  };
}

function normalizeRevenuePathwayContent(content: unknown) {
  const record = asRecord(content);
  const math = asRecord(record.math);
  return {
    model: normalizeObjectRows(record.model, ['driver', 'current', 'potential', 'assumptions']),
    sensitivity: normalizeObjectRows(record.sensitivity, ['scenario', 'impact', 'question']),
    math: {
      metric: asString(math.metric),
      actual: asString(math.actual),
      target: asString(math.target),
      holding_back: asString(math.holding_back),
    },
  };
}

function normalizeExecutiveSnapshotContent(content: unknown) {
  const record = asRecord(content);
  return {
    company_overview: asString(record.company_overview),
    why_now: asString(record.why_now),
    key_metrics: normalizeObjectRows(record.key_metrics, ['metric', 'value', 'source']),
    exec_priorities: asStringArray(record.exec_priorities),
  };
}

function normalizeLoyaltyAnalysisContent(content: unknown) {
  const record = asRecord(content);
  return {
    program_exists: asBoolean(record.program_exists),
    program_type: asString(record.program_type),
    tiers: asString(record.tiers),
    subscription_tie_in: asString(record.subscription_tie_in),
    key_observations: asStringArray(record.key_observations),
  };
}

function normalizeHypothesesAndRisksContent(content: unknown) {
  const record = asRecord(content);
  return {
    hypotheses: asStringArray(record.hypotheses),
    blockers: asStringArray(record.blockers),
    gap_log: asStringArray(record.gap_log),
    risk_heatmap: normalizeObjectRows(record.risk_heatmap, ['risk', 'likelihood', 'impact', 'mitigation']),
  };
}

function normalizeAppendixContent(content: unknown) {
  const record = asRecord(content);
  return {
    cx_audit_detail: asString(record.cx_audit_detail),
    subscription_teardown: asString(record.subscription_teardown),
    business_model_detail: asString(record.business_model_detail),
    industry_analysis: asString(record.industry_analysis),
    case_studies_full: normalizeObjectRows(record.case_studies_full, ['source', 'program', 'result', 'maturity_implication']),
  };
}

function normalizeSectionContent(sectionId: string, content: unknown): unknown {
  const record = asRecord(content);

  switch (sectionId) {
    case 'cockpit':
      return normalizeCockpitContent(content);
    case 'cover':
      return {
        rep_name: asString(record.rep_name),
        opportunity: asString(record.opportunity),
        stage: asString(record.stage),
        platform_scale: asString(record.platform_scale),
      };
    case 'participants':
      return normalizeParticipantsContent(content);
    case 'cx_audit':
      return { completed: asBoolean(record.completed), notes: asString(record.notes) };
    case 'executive_snapshot':
      return normalizeExecutiveSnapshotContent(content);
    case 'value_selling':
      return {
        money: asString(record.money),
        compete: asString(record.compete),
        pain_hypothesis: asString(record.pain_hypothesis),
        csuite_initiative: asString(record.csuite_initiative),
        current_state: asString(record.current_state),
        industry_pressures: asString(record.industry_pressures),
        problems_and_pain: asString(record.problems_and_pain),
        ideal_state: asString(record.ideal_state),
        value_driver: asString(record.value_driver),
        pov: asString(record.pov),
      };
    case 'discovery_questions':
      return normalizeDiscoveryQuestionsContent(content);
    case 'customer_examples':
      return normalizeObjectRows(content, ['customer', 'link', 'relevance']);
    case 'pivot_statements':
      return {
        pain_statement: asString(record.pain_statement),
        fomo_statement: asString(record.fomo_statement),
      };
    case 'objection_handling':
      return normalizeObjectRows(content, ['objection', 'response']);
    case 'marketing_team':
      return normalizeObjectRows(content, ['name', 'title', 'linkedin']);
    case 'exit_criteria':
      return {
        known: asStringArray(record.known),
        gaps: asStringArray(record.gaps),
        meddpicc_gaps: asStringArray(record.meddpicc_gaps),
      };
    case 'revenue_pathway':
      return normalizeRevenuePathwayContent(content);
    case 'metrics_intelligence':
      return normalizeObjectRows(content, ['metric', 'value', 'date', 'source', 'implication', 'question']);
    case 'loyalty_analysis':
      return normalizeLoyaltyAnalysisContent(content);
    case 'tech_stack':
      return normalizeObjectRows(content, ['layer', 'vendor', 'evidence', 'consolidation_opportunity']);
    case 'competitive_war_game':
      return normalizeObjectRows(content, ['competitor', 'strengths', 'weaknesses', 'differentiation']);
    case 'hypotheses_risks':
      return normalizeHypothesesAndRisksContent(content);
    case 'appendix':
      return normalizeAppendixContent(content);
    default:
      return sanitizeGenericValue(content);
  }
}

export function normalizeDiscoverySections(rawSections: unknown): DiscoverySection[] {
  return asArray(rawSections).map((section, index) => {
    const sectionRecord = asRecord(section);
    const id = asString(sectionRecord.id) || `section-${index + 1}`;
    const name = asString(sectionRecord.name) || id.replace(/_/g, ' ');
    const groundedBy = asStringArray(sectionRecord.grounded_by);

    return {
      id,
      name,
      grounded_by: groundedBy.length > 0 ? groundedBy : undefined,
      content: normalizeSectionContent(id, sectionRecord.content),
    };
  });
}

function normalizeRedlines(rawRedlines: unknown, sections: DiscoverySection[]): Redline[] {
  return asArray(rawRedlines).map((redline, index) => {
    const record = asRecord(redline);
    const sectionId = asString(record.section_id) || sections[index]?.id || `section-${index + 1}`;

    return {
      id: asString(record.id) || `r${index}`,
      section_id: sectionId,
      section_name: asString(record.section_name) || sections.find((section) => section.id === sectionId)?.name || 'Section',
      current_text: asString(record.current_text),
      proposed_text: asString(record.proposed_text),
      rationale: asString(record.rationale),
      grounded_by_id: asString(record.grounded_by_id) || null,
      status: record.status === 'accepted' || record.status === 'rejected' ? record.status : 'pending',
    };
  });
}

function normalizeSources(rawSources: unknown): SourceEntry[] | undefined {
  const sources = asArray(rawSources).map((source, index) => {
    const record = asRecord(source);
    return {
      id: asString(record.id) || `source-${index + 1}`,
      label: asString(record.label) || `Source ${index + 1}`,
      url: asString(record.url) || null,
      accessed: asString(record.accessed) || null,
    };
  });

  return sources.length > 0 ? sources : undefined;
}

function normalizeLibraryCoverage(value: unknown): TaskRunResult['review']['library_coverage'] | undefined {
  const record = asRecord(value);
  if (!hasMeaningfulValue(record)) return undefined;

  const used = asArray(record.used).map((entry) => {
    const item = asRecord(entry);
    return {
      id: asString(item.id),
      title: asString(item.title),
      type: asString(item.type) === 'Playbook' ? 'Playbook' : 'KI',
      sections: asStringArray(item.sections),
    } satisfies LibraryCoverageEntry;
  });

  return {
    used,
    gaps: asStringArray(record.gaps),
    score: typeof record.score === 'number' ? record.score : undefined,
  };
}

function normalizeRubricCheck(value: unknown): RubricCheck | undefined {
  const record = asRecord(value);
  if (!hasMeaningfulValue(record)) return undefined;

  const asCheck = (input: unknown): 'pass' | 'warn' | 'fail' | undefined => (
    input === 'pass' || input === 'warn' || input === 'fail' ? input : undefined
  );

  return {
    citation_density: asCheck(record.citation_density),
    cockpit_completeness: asCheck(record.cockpit_completeness),
    discovery_question_specificity: asCheck(record.discovery_question_specificity),
    library_grounding: asCheck(record.library_grounding),
    appendix_richness: asCheck(record.appendix_richness),
    notes: asStringArray(record.notes),
  };
}

export function normalizeTaskRunResultPayload(
  runId: string,
  payload?: { draft?: unknown; review?: unknown },
): TaskRunResult {
  const rawDraft = asRecord(payload?.draft);
  const rawReview = asRecord(payload?.review);
  const sections = normalizeDiscoverySections(rawDraft.sections);
  const sources = normalizeSources(rawDraft.sources);

  return {
    run_id: runId,
    draft: {
      sections,
      ...(sources ? { sources } : {}),
    },
    review: {
      strengths: asStringArray(rawReview.strengths),
      redlines: normalizeRedlines(rawReview.redlines, sections),
      library_coverage: normalizeLibraryCoverage(rawReview.library_coverage),
      rubric_check: normalizeRubricCheck(rawReview.rubric_check),
    },
  };
}

export function hasRenderableDiscoveryContent(result: TaskRunResult | null | undefined): boolean {
  return !!result?.draft.sections.some((section) => hasMeaningfulValue(section.content));
}