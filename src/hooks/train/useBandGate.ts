import { useQuery } from '@tanstack/react-query';
import { getBandExemplarPool, getBandGate } from '@/lib/train/curriculum';
import type { Band } from '@/types/train';

export function useBandGate(spoke: string, topic: string, band: Band | undefined) {
  return useQuery({
    queryKey: ['train', 'band-gate', spoke, topic, band],
    enabled: !!band,
    queryFn: async () => {
      const [gate, pool] = await Promise.all([
        getBandGate(spoke, topic, band!),
        getBandExemplarPool(spoke, topic, band!),
      ]);
      return { gate, pool };
    },
  });
}
