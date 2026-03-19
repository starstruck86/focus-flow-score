import { motion } from 'framer-motion';
import { Mic } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  size?: 'default' | 'large';
  onOpenDave?: () => void;
}

export function VoiceCommandButton({ size = 'default', onOpenDave }: Props) {
  const isLarge = size === 'large';

  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={() => onOpenDave?.()}
      className={cn(
        'rounded-full flex items-center justify-center shadow-md transition-all relative',
        isLarge ? 'h-14 w-14' : 'h-10 w-10',
        'bg-primary/10 hover:bg-primary/20 text-primary',
      )}
      title="Talk to Dave"
    >
      <Mic className={cn(isLarge ? 'h-6 w-6' : 'h-4 w-4')} />
    </motion.button>
  );
}
