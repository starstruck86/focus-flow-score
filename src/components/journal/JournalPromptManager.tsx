import { useState, useEffect } from 'react';
import { DailyScorecardModal } from './DailyScorecardModal';
import { ConfirmYesterdayModal } from './ConfirmYesterdayModal';
import { 
  useJournalPromptStatus,
  useYesterdayJournalEntry,
} from '@/hooks/useDailyJournal';
import { 
  useWorkScheduleConfig, 
  useHolidays, 
  usePtoDays, 
  useWorkdayOverrides,
  isEligibleDay,
} from '@/hooks/useStreakData';
import { format, subDays } from 'date-fns';

interface JournalPromptManagerProps {
  children?: React.ReactNode;
}

export function JournalPromptManager({ children }: JournalPromptManagerProps) {
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [hasShownEodToday, setHasShownEodToday] = useState(false);
  const [hasShownMorningToday, setHasShownMorningToday] = useState(false);
  const [editDate, setEditDate] = useState<string | undefined>(undefined);
  
  const { data: config } = useWorkScheduleConfig();
  const { data: holidays } = useHolidays();
  const { data: ptoDays } = usePtoDays();
  const { data: overrides } = useWorkdayOverrides();
  const { data: yesterdayEntry } = useYesterdayJournalEntry();
  
  const {
    shouldShowEodCheckIn,
    shouldShowMorningConfirm,
    isLoading,
  } = useJournalPromptStatus();
  
  const today = new Date();
  const isTodayEligible = config && holidays && ptoDays && overrides
    ? isEligibleDay(today, config, holidays, ptoDays, overrides)
    : false;
  
  const yesterday = subDays(today, 1);
  const yesterdayStr = format(yesterday, 'yyyy-MM-dd');
  const wasYesterdayEligible = config && holidays && ptoDays && overrides
    ? isEligibleDay(yesterday, config, holidays, ptoDays, overrides)
    : false;
  
  // Auto-show EOD check-in
  useEffect(() => {
    if (!isLoading && isTodayEligible && shouldShowEodCheckIn && !hasShownEodToday && !showCheckIn && !showConfirm) {
      const timer = setTimeout(() => {
        setEditDate(undefined);
        setShowCheckIn(true);
        setHasShownEodToday(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isLoading, isTodayEligible, shouldShowEodCheckIn, hasShownEodToday, showCheckIn, showConfirm]);
  
  // Auto-show morning confirmation
  useEffect(() => {
    if (!isLoading && wasYesterdayEligible && shouldShowMorningConfirm && !hasShownMorningToday && !showCheckIn && !showConfirm && yesterdayEntry) {
      const timer = setTimeout(() => {
        setShowConfirm(true);
        setHasShownMorningToday(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isLoading, wasYesterdayEligible, shouldShowMorningConfirm, hasShownMorningToday, showCheckIn, showConfirm, yesterdayEntry]);
  
  const handleEditYesterday = () => {
    setEditDate(yesterdayStr);
    setShowConfirm(false);
    setShowCheckIn(true);
  };
  
  const handleCloseCheckIn = (open: boolean) => {
    setShowCheckIn(open);
    if (!open) {
      setEditDate(undefined);
    }
  };
  
  return (
    <>
      {children}
      
      <DailyScorecardModal
        open={showCheckIn}
        onOpenChange={handleCloseCheckIn}
        date={editDate}
      />
      
      {yesterdayEntry && (
        <ConfirmYesterdayModal
          open={showConfirm}
          onOpenChange={setShowConfirm}
          entry={yesterdayEntry}
          onEdit={handleEditYesterday}
        />
      )}
    </>
  );
}

// Hook to manually trigger the check-in modal
export function useJournalModal() {
  const [isOpen, setIsOpen] = useState(false);
  
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    setIsOpen,
  };
}
