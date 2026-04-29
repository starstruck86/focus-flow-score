import type { SkillManifest } from '../types';

export const ninetyDayPlanManifest: SkillManifest = {
  id: 'ninety-day-plan',
  label: '90-Day Plan',
  description: 'Sequenced 90-day account plan artifact via existing task pipeline.',
  behaviorIntent: 'ninety_day_plan',
  workspace: 'artifacts',
  depth: 'artifact',
  sourceMode: 'library_required',
  retrieval: {
    scopes: ['knowledge_items', 'playbooks', 'standards', 'patterns'],
    termBindings: ['${inputs.account}', '${inputs.stage}', '${inputs.objective}'],
    minRelevantItems: 3,
  },
  output: {
    shape: 'structured_artifact',
    targetWords: { min: 500, max: 2000 },
  },
  rubric: {
    mustHave: ['sequenced moves', 'owners', 'milestones', 'dependencies'],
    genericMarkers: ['align stakeholders', 'drive value'],
    maxGenericMarkers: 1,
  },
  version: '1',
};
