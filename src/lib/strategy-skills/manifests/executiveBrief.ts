import type { SkillManifest } from '../types';

export const executiveBriefManifest: SkillManifest = {
  id: 'executive-brief',
  label: 'Executive Brief',
  description: 'Concise, executive-ready brief on an account or deal with POV and asks.',
  behaviorIntent: 'account_brief',
  workspace: 'artifacts',
  depth: 'artifact',
  sourceMode: 'library_required',
  retrieval: {
    scopes: ['knowledge_items', 'playbooks', 'standards'],
    termBindings: ['${inputs.account}', '${inputs.persona}', '${inputs.stage}', '${inputs.topic}'],
    minRelevantItems: 3,
  },
  output: {
    shape: 'structured_artifact',
  },
  rubric: {
    mustHave: ['situation', 'commercial insight', 'risks', 'strategic why', 'specific asks', 'cited sources'],
    genericMarkers: ['going well', 'no major issues', 'continued engagement'],
    maxGenericMarkers: 0,
  },
  version: '1',
};
