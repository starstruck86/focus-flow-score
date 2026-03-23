export interface RebuildPlanBlock {
  start_time: string;
  end_time: string;
  label: string;
  type: string;
}

function normalizeLabel(label: string) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function blockKey(block: RebuildPlanBlock) {
  return `${block.start_time}-${block.end_time}-${normalizeLabel(block.label)}-${block.type}`;
}

export function getVisiblePlanBlocks<T>(blocks: T[] | null | undefined, dismissed: Set<number>) {
  return (blocks || []).filter((_, index) => !dismissed.has(index));
}

export function planBlockSignature(blocks: RebuildPlanBlock[] | null | undefined) {
  return (blocks || []).map(blockKey).join('|');
}

export function summarizePlanDelta(
  beforeBlocks: RebuildPlanBlock[] | null | undefined,
  afterBlocks: RebuildPlanBlock[] | null | undefined,
) {
  const before = beforeBlocks || [];
  const after = afterBlocks || [];

  if (!before.length && after.length) return `created ${after.length} blocks`;
  if (planBlockSignature(before) === planBlockSignature(after)) return 'plan unchanged';

  const beforeKeys = new Set(before.map(blockKey));
  const afterKeys = new Set(after.map(blockKey));

  let added = 0;
  let removed = 0;

  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) added += 1;
  }

  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) removed += 1;
  }

  const changed = Math.max(added, removed);
  if (added && removed) return `${changed} block${changed === 1 ? '' : 's'} changed`;
  if (added) return `added ${added} block${added === 1 ? '' : 's'}`;
  if (removed) return `removed ${removed} block${removed === 1 ? '' : 's'}`;

  return 'plan updated';
}