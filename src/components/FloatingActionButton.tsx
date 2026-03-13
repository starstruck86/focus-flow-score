import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ClipboardCheck, 
  Plus, 
  ListPlus, 
  Timer, 
  X,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { 
  useTodayJournalEntry, 
  useYesterdayJournalEntry 
} from '@/hooks/useDailyJournal';
import { useWorkScheduleConfig, isEligibleDay, useHolidays, usePtoDays, useWorkdayOverrides } from '@/hooks/useStreakData';
import { DailyScorecardModal, ConfirmYesterdayModal } from '@/components/journal';
import { QuickAddTaskModal } from '@/components/QuickAddTaskModal';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

interface FloatingActionButtonProps {
  position?: 'bottom-right' | 'bottom-left';
  onStartTimer?: () => void;
}

export function FloatingActionButton({ 
  position = 'bottom-right',
  onStartTimer,
}: FloatingActionButtonProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showConfirmYesterday, setShowConfirmYesterday] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  
  // Data hooks
  const { data: todayEntry } = useTodayJournalEntry();
  const { data: yesterdayEntry } = useYesterdayJournalEntry();
  const { data: config } = useWorkScheduleConfig();
  const { data: holidays } = useHolidays();
  const { data: ptoDays } = usePtoDays();
  const { data: overrides } = useWorkdayOverrides();
  
  // Determine states
  const today = new Date();
  const now = today.getHours() * 60 + today.getMinutes();
  const morningConfirmTime = config 
    ? parseInt(config.morningConfirmTime.split(':')[0]) * 60 + parseInt(config.morningConfirmTime.split(':')[1])
    : 8 * 60;
  const eodTime = config
    ? parseInt(config.eodCheckinTime.split(':')[0]) * 60 + parseInt(config.eodCheckinTime.split(':')[1])
    : 16 * 60 + 30;
  
  const isTodayEligible = config && holidays && ptoDays && overrides
    ? isEligibleDay(today, config, holidays, ptoDays, overrides)
    : false;
  
  const hasCheckedInToday = todayEntry?.checkedIn || false;
  const needsConfirmYesterday = yesterdayEntry?.checkedIn && !yesterdayEntry?.confirmed && now >= morningConfirmTime && now < eodTime;
  
  // Primary button label
  const getPrimaryLabel = () => {
    if (hasCheckedInToday) return 'Edit Today';
    return 'Log Day';
  };
  
  // Handle primary action
  const handlePrimaryAction = () => {
    if (needsConfirmYesterday) {
      setShowConfirmYesterday(true);
    } else {
      setShowCheckIn(true);
    }
    setIsExpanded(false);
  };
  
  // Handle keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // T for quick add task
      if (e.key === 't' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
          e.preventDefault();
          setShowAddTask(true);
        }
      }
      // Cmd/Ctrl + K for command palette (could be extended)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsExpanded(true);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  // Close menu when clicking outside
  useEffect(() => {
    if (!isExpanded) return;
    
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-fab-container]')) {
        setIsExpanded(false);
      }
    };
    
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [isExpanded]);
  
  const positionClasses = position === 'bottom-right' 
    ? 'right-6 bottom-6' 
    : 'left-6 bottom-6';
  
  const menuAlignment = position === 'bottom-right' ? 'items-end' : 'items-start';
  
  return (
    <>
      {/* FAB Container */}
      <div 
        className={cn("fixed z-50", positionClasses)}
        data-fab-container
      >
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              className={cn("flex flex-col gap-3 mb-3", menuAlignment)}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.2 }}
            >
              {/* Start Timer */}
              {onStartTimer && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1 }}
                >
                  <Button
                    variant="secondary"
                    size="lg"
                    className="gap-2 shadow-lg"
                    onClick={() => {
                      onStartTimer();
                      setIsExpanded(false);
                    }}
                  >
                    <Timer className="h-4 w-4" />
                    Start Timer
                  </Button>
                </motion.div>
              )}
              
              {/* Add Task */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.05 }}
              >
                <Button
                  variant="secondary"
                  size="lg"
                  className="gap-2 shadow-lg"
                  onClick={() => {
                    setShowAddTask(true);
                    setIsExpanded(false);
                  }}
                >
                  <ListPlus className="h-4 w-4" />
                  Add Task
                  <kbd className="ml-2 text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">T</kbd>
                </Button>
              </motion.div>
              
              {/* Log Day */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <Button
                  variant="default"
                  size="lg"
                  className="gap-2 shadow-lg"
                  onClick={handlePrimaryAction}
                >
                  <ClipboardCheck className="h-4 w-4" />
                  {getPrimaryLabel()}
                  {needsConfirmYesterday && (
                    <Badge variant="secondary" className="ml-1 text-[10px] px-1.5">
                      Confirm
                    </Badge>
                  )}
                </Button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Main FAB Button */}
        <motion.div
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Button
            size="lg"
            className={cn(
              "h-14 w-14 rounded-full shadow-lg relative",
              isExpanded && "bg-muted text-muted-foreground hover:bg-muted",
              !hasCheckedInToday && isTodayEligible && "bg-primary animate-pulse",
            )}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <AnimatePresence mode="wait">
              {isExpanded ? (
                <motion.div
                  key="close"
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <X className="h-6 w-6" />
                </motion.div>
              ) : (
                <motion.div
                  key="plus"
                  initial={{ rotate: 90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: -90, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <Plus className="h-6 w-6" />
                </motion.div>
              )}
            </AnimatePresence>
            
            {/* Badge for pending confirmation */}
            {needsConfirmYesterday && !isExpanded && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-yellow opacity-75"></span>
                <span className="relative inline-flex rounded-full h-5 w-5 bg-status-yellow items-center justify-center">
                  <AlertCircle className="h-3 w-3 text-status-yellow-foreground" />
                </span>
              </span>
            )}
          </Button>
        </motion.div>
      </div>
      
      {/* Modals */}
      <DailyScorecardModal
        open={showCheckIn}
        onOpenChange={setShowCheckIn}
      />
      
      <ConfirmYesterdayModal
        open={showConfirmYesterday}
        onOpenChange={setShowConfirmYesterday}
      />
      
      <QuickAddTaskModal
        open={showAddTask}
        onOpenChange={setShowAddTask}
      />
    </>
  );
}
