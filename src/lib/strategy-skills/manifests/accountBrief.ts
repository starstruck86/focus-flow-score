import type { SkillManifest } from '../types';

export const accountBriefManifest: SkillManifest = {
  id: 'account-brief',
  label: 'Account Brief',
  description: 'One-page account brief artifact via existing task pipeline.',
  behaviorIntent: 'account_brief',
  workspace: 'artifacts',
  depth: 'artifact',
  sourceMode: 'library_required',
  retrieval: {
    scopes: ['knowledge_items', 'playbooks', 'patterns'],
    termBindings: ['${inputs.account}', '${inputs.industry}'],
    minRelevantItems: 2,
  },
  output: {
    shape: 'structured_artifact',
    targetWords: { min: 400, max: 1500 },
  },
  rubric: {
    mustHave: ['account context', 'priorities', 'risks', 'next moves'],
    genericMarkers: ['large enterprise', 'market leader', 'digital transformation'],
    maxGenericMarkers: 1,
  },
  version: '1',
};
