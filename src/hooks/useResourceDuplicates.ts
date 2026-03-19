import { useMemo } from 'react';
import { useAllResources, type Resource } from '@/hooks/useResources';
import { normalize, isSimilar } from '@/lib/stringUtils';

export interface ResourceDuplicateGroup {
  key: string;
  matchType: 'url' | 'title';
  items: Resource[];
}

export function useResourceDuplicates() {
  const { data: resources = [] } = useAllResources();

  const groups = useMemo(() => {
    const result: ResourceDuplicateGroup[] = [];
    const usedIds = new Set<string>();

    // Pass 1: exact URL matches
    const byUrl = new Map<string, Resource[]>();
    for (const r of resources) {
      if (r.file_url) {
        const existing = byUrl.get(r.file_url) || [];
        existing.push(r);
        byUrl.set(r.file_url, existing);
      }
    }
    for (const [url, items] of byUrl) {
      if (items.length > 1) {
        result.push({ key: url, matchType: 'url', items });
        items.forEach(i => usedIds.add(i.id));
      }
    }

    // Pass 2: fuzzy title matches (skip already-grouped)
    const remaining = resources.filter(r => !usedIds.has(r.id));
    for (let i = 0; i < remaining.length; i++) {
      if (usedIds.has(remaining[i].id)) continue;
      const cluster = [remaining[i]];
      for (let j = i + 1; j < remaining.length; j++) {
        if (usedIds.has(remaining[j].id)) continue;
        if (isSimilar(remaining[i].title, remaining[j].title)) {
          cluster.push(remaining[j]);
          usedIds.add(remaining[j].id);
        }
      }
      if (cluster.length > 1) {
        usedIds.add(remaining[i].id);
        result.push({ key: normalize(remaining[i].title), matchType: 'title', items: cluster });
      }
    }

    return result;
  }, [resources]);

  return { groups, totalDuplicates: groups.length };
}

export function useCheckDuplicate(title: string, url?: string) {
  const { data: resources = [] } = useAllResources();

  return useMemo(() => {
    if (!title && !url) return null;
    for (const r of resources) {
      if (url && r.file_url === url) return r;
      if (title && isSimilar(title, r.title)) return r;
    }
    return null;
  }, [title, url, resources]);
}
