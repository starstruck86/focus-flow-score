import type { SkillManifest } from '../types';

export const demoStrategyManifest: SkillManifest = {
  id: 'demo-strategy',
  label: 'Demo Strategy',
  description: 'Plan a tailored, POV-led demo for a specific persona and use case.',
  behaviorIntent: 'conversation_strategy',
  workspace: 'work',
  depth: 'standard',
  sourceMode: 'library_first',
  retrieval: {
    scopes: ['knowledge_items', 'playbooks', 'standards', 'exemplars'],
    termBindings: ['${inputs.account}', '${inputs.persona}', '${inputs.use_case}', '${inputs.stage}'],
    minRelevantItems: 2,
  },
  output: {
    shape: 'prose',
    targetWords: { min: 100, max: 260 },
    forbid: ['headings'],
  },
  rubric: {
    mustHave: ['POV-led narrative', 'persona-specific value', 'change vectors', 'proof moments', 'commercial insight'],
    genericMarkers: ['standard demo', 'show all features', 'walk through the product'],
    maxGenericMarkers: 1,
  },
  version: '1',
};
