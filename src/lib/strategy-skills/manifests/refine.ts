import type { SkillManifest } from '../types';

export const refineManifest: SkillManifest = {
  id: 'refine',
  label: 'Refine',
  description: 'Tighten a draft against library standards without losing intent.',
  behaviorIntent: 'refine_message',
  workspace: 'refine',
  depth: 'quick',
  sourceMode: 'library_relevant',
  retrieval: {
    scopes: ['standards', 'exemplars'],
    termBindings: ['${inputs.draft_topic}', '${inputs.persona}', '${inputs.channel}'],
    minRelevantItems: 1,
  },
  output: {
    shape: 'prose',
    targetWords: { min: 40, max: 220 },
    forbid: ['headings'],
  },
  rubric: {
    mustHave: ['preserves user intent', 'sharper', 'matches library voice'],
    genericMarkers: ['I hope this finds you well', 'circling back', 'just checking in'],
    maxGenericMarkers: 0,
  },
  version: '1',
};
