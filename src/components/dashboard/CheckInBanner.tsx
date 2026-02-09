// Check-In Banner - Prompt to log day if not completed
import { motion } from 'framer-motion';
import { ClipboardCheck, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CheckInBannerProps {
  checkedIn: boolean;
  isEligibleDay: boolean;
  onStartCheckIn: () => void;
  onEditCheckIn: () => void;
  confirmed?: boolean;
}

export function CheckInBanner({ 
  checkedIn, 
  isEligibleDay, 
  onStartCheckIn, 
  onEditCheckIn,
  confirmed,
}: CheckInBannerProps) {
  // Not an eligible day - don't show anything
  if (!isEligibleDay) return null;
  
  // Already checked in
  if (checkedIn) {
    return (
      <motion.div
        className="mb-6 p-4 rounded-xl bg-status-green/10 border border-status-green/20 flex items-center justify-between"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-status-green/20 flex items-center justify-center">
            <ClipboardCheck className="h-5 w-5 text-status-green" />
          </div>
          <div>
            <p className="font-medium text-status-green">✓ Checked in today</p>
            <p className="text-sm text-muted-foreground">
              {confirmed ? 'Confirmed and locked' : 'Will be confirmed tomorrow morning'}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onEditCheckIn}>
          Edit Check-In
        </Button>
      </motion.div>
    );
  }
  
  // Not checked in yet
  return (
    <motion.div
      className="mb-6 p-4 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-between"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
          <AlertCircle className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="font-medium">Log Day to update tracking</p>
          <p className="text-sm text-muted-foreground">Complete your daily check-in to update Sales Age and recommendations</p>
        </div>
      </div>
      <Button onClick={onStartCheckIn} className="gap-2">
        <ClipboardCheck className="h-4 w-4" />
        Log Day
      </Button>
    </motion.div>
  );
}
