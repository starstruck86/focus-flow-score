import { motion } from 'framer-motion';
import { Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Props {
  size?: 'default' | 'large';
  onOpenDave?: (stream: MediaStream) => void;
}

export function VoiceCommandButton({ size = 'default', onOpenDave }: Props) {
  const isLarge = size === 'large';

  const handleClick = async () => {
    try {
      // Acquire mic directly in tap handler — required for iOS Safari / PWA
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      onOpenDave?.(stream);
    } catch (err: any) {
      console.error('Mic permission denied:', err);
      if (err.name === 'NotAllowedError') {
        toast.error('Microphone access denied', {
          description: 'Please enable microphone access in your device settings to use Dave.',
        });
      } else if (err.name === 'NotFoundError') {
        toast.error('No microphone found', {
          description: 'Please connect a microphone to use Dave.',
        });
      } else {
        toast.error('Could not access microphone', { description: err.message });
      }
    }
  };

  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={handleClick}
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
