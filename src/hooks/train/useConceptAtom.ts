import { useQuery } from '@tanstack/react-query';
import { getConceptWithItems } from '@/lib/train/curriculum';

export function useConceptAtom(conceptId: string | undefined, drillCap?: number) {
  return useQuery({
    queryKey: ['train', 'concept', conceptId, drillCap],
    enabled: !!conceptId,
    queryFn: () => getConceptWithItems(conceptId!, { drillCap }),
  });
}
