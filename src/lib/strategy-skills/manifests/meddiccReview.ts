import type { SkillManifest } from '../types';

export const meddiccReviewManifest: SkillManifest = {
  id: 'meddicc-review',
  label: 'MEDDICC Deal Review',
  description: 'Structured MEDDICC review of a deal grounded in library standards.',
  behaviorIntent: 'account_brief',
  workspace: 'artifacts',
  depth: 'deep',
  sourceMode: 'library_required',
  retrieval: {
    scopes: ['knowledge_items', 'playbooks', 'standards'],
    termBindings: ['${inputs.account}', '${inputs.opportunity}', '${inputs.stage}', '${inputs.persona}'],
    minRelevantItems: 3,
  },
  output: {
    shape: 'structured_artifact',
  },
  rubric: {
    mustHave: [
      'metrics',
      'economic buyer',
      'decision criteria',
      'decision process',
      'identified pain',
      'champion',
      'competition',
      'gaps named',
    ],
    genericMarkers: ['looks healthy', 'no concerns', 'on track'],
    maxGenericMarkers: 0,
  },
  version: '1',
};
