import { Compass, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

interface WeeklyReviewBannerProps {
  onOpen: () => void;
}

export function WeeklyReviewBanner({ onOpen }: WeeklyReviewBannerProps) {
  const isMonday = new Date().getDay() === 1;
  
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex items-center gap-4"
    >
      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
        <Compass className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-display text-sm font-bold">
          {isMonday ? "Start your week right" : "Weekly review not yet completed"}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {isMonday
            ? "Set your goals, commitments, and review last week's performance."
            : "Complete your weekly goals & pipeline review to stay on track."}
        </p>
      </div>
      <Button size="sm" onClick={onOpen} className="shrink-0 gap-1">
        Open Review <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </motion.div>
  );
}
