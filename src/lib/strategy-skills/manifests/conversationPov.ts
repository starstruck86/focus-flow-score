import type { SkillManifest } from '../types';

export const conversationPovManifest: SkillManifest = {
  id: 'conversation-pov',
  label: 'Conversation POV',
  description: 'Compressed, POV-bearing prep for an upcoming live conversation.',
  behaviorIntent: 'conversation_strategy',
  workspace: 'work',
  depth: 'standard',
  sourceMode: 'library_first',
  retrieval: {
    scopes: ['knowledge_items', 'playbooks', 'standards'],
    termBindings: ['${inputs.account}', '${inputs.persona}', '${inputs.stage}', '${inputs.topic}'],
    minRelevantItems: 2,
  },
  output: {
    shape: 'prose',
    targetWords: { min: 80, max: 220 },
    forbid: ['headings', 'bullets'],
  },
  rubric: {
    mustHave: [
      'verified signals',
      'current state reasoning',
      'change vectors',
      'commercial insight',
      'strategic why',
      'friction',
    ],
    genericMarkers: ['build rapport', 'understand their needs', 'add value'],
    maxGenericMarkers: 1,
  },
  version: '1',
};
