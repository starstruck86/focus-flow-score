import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  ChevronLeft, 
  ChevronRight, 
  Check,
  ClipboardList,
  Target,
  Zap,
  BarChart3,
} from 'lucide-react';
import { ActivityStep } from './steps/ActivityStep';
import { PreparednessStep } from './steps/PreparednessStep';
import { RecoveryStep } from './steps/RecoveryStep';
import { ReviewStep } from './steps/ReviewStep';
import { 
  useSaveJournalEntry,
  calculateJournalScores,
} from '@/hooks/useDailyJournal';
import { useRecordCheckIn, useWorkScheduleConfig } from '@/hooks/useStreakData';
import type { 
  ActivityTotals, 
  PreparednessInputs, 
  RecoveryJournalInputs,
} from '@/types/journal';
import {
  getDefaultActivityTotals,
  getDefaultPreparednessInputs,
  getDefaultRecoveryJournalInputs,
} from '@/types/journal';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface DailyCheckInModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date?: string; // defaults to today
  initialActivity?: ActivityTotals;
  initialPreparedness?: PreparednessInputs;
  initialRecovery?: RecoveryJournalInputs;
}

const STEPS = [
  { id: 1, name: 'Activity', icon: ClipboardList },
  { id: 2, name: 'Preparedness', icon: Target },
  { id: 3, name: 'Recovery', icon: Zap },
  { id: 4, name: 'Review', icon: BarChart3 },
];

export function DailyCheckInModal({
  open,
  onOpenChange,
  date,
  initialActivity,
  initialPreparedness,
  initialRecovery,
}: DailyCheckInModalProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [activity, setActivity] = useState<ActivityTotals>(
    initialActivity || getDefaultActivityTotals()
  );
  const [preparedness, setPreparedness] = useState<PreparednessInputs>(
    initialPreparedness || getDefaultPreparednessInputs()
  );
  const [recovery, setRecovery] = useState<RecoveryJournalInputs>(
    initialRecovery || getDefaultRecoveryJournalInputs()
  );
  
  const entryDate = date || format(new Date(), 'yyyy-MM-dd');
  const saveJournal = useSaveJournalEntry();
  const recordCheckIn = useRecordCheckIn();
  const { data: config } = useWorkScheduleConfig();
  
  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setCurrentStep(1);
      setActivity(initialActivity || getDefaultActivityTotals());
      setPreparedness(initialPreparedness || getDefaultPreparednessInputs());
      setRecovery(initialRecovery || getDefaultRecoveryJournalInputs());
    }
  }, [open, initialActivity, initialPreparedness, initialRecovery]);
  
  const progress = (currentStep / STEPS.length) * 100;
  
  const handleNext = () => {
    if (currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1);
    }
  };
  
  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };
  
  const handleSave = async () => {
    try {
      // Save journal entry
      await saveJournal.mutateAsync({
        date: entryDate,
        activity,
        preparedness,
        recovery,
        markAsCheckedIn: true,
      });
      
      // Also record for streak tracking
      const scores = calculateJournalScores(activity, recovery);
      await recordCheckIn.mutateAsync({
        date: entryDate,
        method: 'journal',
        dailyScore: scores.dailyScore,
        productivityScore: scores.salesProductivity,
        isEligible: true,
        goalMet: scores.goalMet,
      });
      
      toast.success('Daily check-in saved!', {
        description: scores.goalMet 
          ? '🔥 Goal met! Your streak continues.' 
          : 'Keep pushing tomorrow!',
      });
      
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to save journal:', error);
      toast.error('Failed to save check-in');
    }
  };
  
  const scores = calculateJournalScores(activity, recovery);
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 font-display text-xl">
            <ClipboardList className="h-5 w-5 text-primary" />
            Daily Check-In
          </DialogTitle>
          
          {/* Step Indicator */}
          <div className="pt-4">
            <div className="flex items-center justify-between mb-2">
              {STEPS.map((step, idx) => {
                const StepIcon = step.icon;
                const isActive = step.id === currentStep;
                const isCompleted = step.id < currentStep;
                
                return (
                  <div key={step.id} className="flex items-center">
                    <button
                      onClick={() => step.id < currentStep && setCurrentStep(step.id)}
                      disabled={step.id > currentStep}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors ${
                        isActive 
                          ? 'bg-primary/10 text-primary' 
                          : isCompleted 
                            ? 'text-primary/70 hover:bg-primary/5 cursor-pointer' 
                            : 'text-muted-foreground'
                      }`}
                    >
                      {isCompleted ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <StepIcon className="h-4 w-4" />
                      )}
                      <span className="text-xs font-medium hidden sm:inline">{step.name}</span>
                    </button>
                    {idx < STEPS.length - 1 && (
                      <div className={`h-px w-4 mx-1 ${
                        isCompleted ? 'bg-primary' : 'bg-border'
                      }`} />
                    )}
                  </div>
                );
              })}
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        </DialogHeader>
        
        {/* Step Content */}
        <div className="flex-1 overflow-y-auto py-4 min-h-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {currentStep === 1 && (
                <ActivityStep 
                  activity={activity} 
                  onChange={setActivity} 
                />
              )}
              {currentStep === 2 && (
                <PreparednessStep
                  preparedness={preparedness}
                  onChange={setPreparedness}
                />
              )}
              {currentStep === 3 && (
                <RecoveryStep
                  recovery={recovery}
                  onChange={setRecovery}
                />
              )}
              {currentStep === 4 && (
                <ReviewStep
                  activity={activity}
                  preparedness={preparedness}
                  recovery={recovery}
                  scores={scores}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        
        {/* Footer */}
        <div className="flex-shrink-0 flex items-center justify-between pt-4 border-t">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={currentStep === 1}
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          
          <div className="text-sm text-muted-foreground">
            Step {currentStep} of {STEPS.length}
          </div>
          
          {currentStep < STEPS.length ? (
            <Button onClick={handleNext} className="gap-1">
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button 
              onClick={handleSave} 
              disabled={saveJournal.isPending}
              className="gap-1"
            >
              {saveJournal.isPending ? 'Saving...' : 'Save Check-In'}
              <Check className="h-4 w-4" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
