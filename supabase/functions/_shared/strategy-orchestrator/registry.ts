// ════════════════════════════════════════════════════════════════
// Task Registry — single map of task_type → handler.
// Adding a new Strategy task = add an entry here.
// ════════════════════════════════════════════════════════════════

import type { TaskHandler, TaskType } from "./types.ts";
import { discoveryPrepHandler } from "./handlers/discoveryPrep.ts";
import { accountBriefHandler } from "./handlers/accountBrief.ts";
import { ninetyDayPlanHandler } from "./handlers/ninetyDayPlan.ts";

export const TASK_REGISTRY: Record<TaskType, TaskHandler> = {
  discovery_prep: discoveryPrepHandler,
  account_brief: accountBriefHandler,
  ninety_day_plan: ninetyDayPlanHandler,
};

export function getHandler(taskType: string): TaskHandler {
  const h = (TASK_REGISTRY as any)[taskType];
  if (!h) throw new Error(`Unknown task_type: ${taskType}`);
  return h;
}
