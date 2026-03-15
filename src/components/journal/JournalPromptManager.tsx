import { useState } from 'react';
import { DailyScorecardModal } from './DailyScorecardModal';
import { ConfirmYesterdayModal } from './ConfirmYesterdayModal';
import { useYesterdayJournalEntry } from '@/hooks/useDailyJournal';
import { format, subDays } from 'date-fns';

interface JournalPromptManagerProps {
  children?: React.ReactNode;
}

/**
 * JournalPromptManager — NO auto-popups.
 * The journal is accessed inline via JournalDashboardCard or keyboard shortcut (J).
 * This component only provides the modal infrastructure for programmatic triggers.
 */
export function JournalPromptManager({ children }: JournalPromptManagerProps) {
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [editDate, setEditDate] = useState<string | undefined>(undefined);
  const { data: yesterdayEntry } = useYesterdayJournalEntry();

  const yesterday = subDays(new Date(), 1);
  const yesterdayStr = format(yesterday, 'yyyy-MM-dd');

  const handleEditYesterday = () => {
    setEditDate(yesterdayStr);
    setShowConfirm(false);
    setShowCheckIn(true);
  };

  const handleCloseCheckIn = (open: boolean) => {
    setShowCheckIn(open);
    if (!open) setEditDate(undefined);
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
