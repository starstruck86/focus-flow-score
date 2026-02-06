import { useState, useEffect } from 'react';
import { DailyCheckInModal } from './DailyCheckInModal';
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
  const [editMode, setEditMode] = useState(false);
  const [editDate, setEditDate] = useState<string | null>(null);
  
  const { data: config } = useWorkScheduleConfig();
  const { data: holidays } = useHolidays();
  const { data: ptoDays } = usePtoDays();
  const { data: overrides } = useWorkdayOverrides();
  const { data: yesterdayEntry } = useYesterdayJournalEntry();
  
  const {
    shouldShowEodCheckIn,
    shouldShowMorningConfirm,
    todayEntry,
    yesterdayEntry: promptYesterday,
    isLoading,
  } = useJournalPromptStatus();
  
  // Check if today is eligible
  const today = new Date();
  const isTodayEligible = config && holidays && ptoDays && overrides
    ? isEligibleDay(today, config, holidays, ptoDays, overrides)
    : false;
  
  // Check if yesterday was eligible
  const yesterday = subDays(today, 1);
  const yesterdayStr = format(yesterday, 'yyyy-MM-dd');
  const wasYesterdayEligible = config && holidays && ptoDays && overrides
    ? isEligibleDay(yesterday, config, holidays, ptoDays, overrides)
    : false;
  
  // Auto-show EOD check-in (only on eligible days)
  useEffect(() => {
    if (
      !isLoading &&
      isTodayEligible &&
      shouldShowEodCheckIn &&
      !hasShownEodToday &&
      !showCheckIn &&
      !showConfirm
    ) {
      // Small delay to avoid flashing
      const timer = setTimeout(() => {
        setShowCheckIn(true);
        setHasShownEodToday(true);
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [isLoading, isTodayEligible, shouldShowEodCheckIn, hasShownEodToday, showCheckIn, showConfirm]);
  
  // Auto-show morning confirmation (only if yesterday was eligible)
  useEffect(() => {
    if (
      !isLoading &&
      wasYesterdayEligible &&
      shouldShowMorningConfirm &&
      !hasShownMorningToday &&
      !showCheckIn &&
      !showConfirm &&
      yesterdayEntry
    ) {
      const timer = setTimeout(() => {
        setShowConfirm(true);
        setHasShownMorningToday(true);
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [isLoading, wasYesterdayEligible, shouldShowMorningConfirm, hasShownMorningToday, showCheckIn, showConfirm, yesterdayEntry]);
  
  const handleEditYesterday = () => {
    setEditMode(true);
    setEditDate(yesterdayStr);
    setShowConfirm(false);
    setShowCheckIn(true);
  };
  
  const handleCloseCheckIn = (open: boolean) => {
    setShowCheckIn(open);
    if (!open) {
      setEditMode(false);
      setEditDate(null);
    }
  };
  
  return (
    <>
      {children}
      
      <DailyCheckInModal
        open={showCheckIn}
        onOpenChange={handleCloseCheckIn}
        date={editDate || undefined}
        initialActivity={editMode && yesterdayEntry ? yesterdayEntry.activity : undefined}
        initialPreparedness={editMode && yesterdayEntry ? yesterdayEntry.preparedness : undefined}
        initialRecovery={editMode && yesterdayEntry ? yesterdayEntry.recovery : undefined}
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
