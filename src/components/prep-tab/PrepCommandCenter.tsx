/**
 * Deal Execution Command Center — the main Prep experience.
 * Organized around the deal lifecycle with 8 stages.
 */

import { useState } from 'react';
import { DealStageNav } from './DealStageNav';
import { StageWorkspace } from './StageWorkspace';

import { STAGES } from './stageConfig';

export function PrepCommandCenter() {
  const [activeStage, setActiveStage] = useState('discovery');

  const stage = STAGES.find(s => s.id === activeStage) || STAGES[1];

  return (
    <div className="space-y-4">
      {/* Lifecycle stage navigation */}
      <DealStageNav activeStage={activeStage} onStageChange={setActiveStage} />

      {/* Stage workspace */}
      <StageWorkspace
        key={stage.id}
        stage={stage}
        onChangeStage={setActiveStage}
      />

      {/* Promotion Engine — classify & promote enriched resources */}
      <PromotionEngine />
    </div>
  );
}
