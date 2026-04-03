import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, 
  X,
  ListPlus,
  FileText,
  Target,
  Zap,
  Timer,
  ClipboardCheck,
  Bolt,
  ImagePlus,
  BookOpen,
  Link2,
  Camera,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { 
  useTodayJournalEntry,
} from '@/hooks/useDailyJournal';
import { useWorkScheduleConfig, isEligibleDay, useHolidays, usePtoDays, useWorkdayOverrides } from '@/hooks/useStreakData';
import { DailyScorecardModal } from '@/components/journal';
import { QuickAddTaskModal } from '@/components/QuickAddTaskModal';
import { AddTranscriptModal } from './AddTranscriptModal';
import { AddUpdateOpportunityModal } from './AddUpdateOpportunityModal';
import { PowerHourModal } from './PowerHourModal';
import { FocusTimerModal } from './FocusTimerModal';
import { QuickLogModal } from '@/components/journal/QuickLogModal';
import { useLinkedRecordContext } from '@/contexts/LinkedRecordContext';
import { ScreenshotEnrichModal } from '@/components/ScreenshotEnrichModal';
import { ScreenshotImportModal } from '@/components/ScreenshotImportModal';
import { TranscriptViewer } from '@/components/TranscriptViewer';
import { ResourceLibraryModal } from '@/components/ResourceLibraryModal';
import { ClaudeSynopsisModal } from '@/components/ClaudeSynopsisModal';
import { useStore } from '@/store/useStore';

interface GlobalFABProps {
  position?: 'bottom-right' | 'bottom-left';
}

interface FABAction {
  id: string;
  label: string;
  icon: React.ElementType;
  shortcut?: string;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'yellow';
}

export function GlobalFAB({ position = 'bottom-right' }: GlobalFABProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Modal states
  const [showAddTask, setShowAddTask] = useState(false);
  const [showAddTranscript, setShowAddTranscript] = useState(false);
  const [showAddUpdateOpp, setShowAddUpdateOpp] = useState(false);
  const [showPowerHour, setShowPowerHour] = useState(false);
  const [showFocusTimer, setShowFocusTimer] = useState(false);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showQuickLog, setShowQuickLog] = useState(false);
  const [showScreenshots, setShowScreenshots] = useState(false);
  const [showScreenshotImport, setShowScreenshotImport] = useState(false);
  const [showTranscriptViewer, setShowTranscriptViewer] = useState(false);
  const [showResourceLibrary, setShowResourceLibrary] = useState(false);
  const [showSynopsis, setShowSynopsis] = useState(false);
  
  // Context for prefills
  const { currentRecord } = useLinkedRecordContext();
  const prefillOpportunityId = currentRecord.type === 'opportunity' ? currentRecord.id : undefined;
  const prefillAccountId = currentRecord.type === 'account' ? currentRecord.id : currentRecord.accountId;
  const { opportunities } = useStore();
  const synopsisOpp = prefillOpportunityId ? opportunities.find(o => o.id === prefillOpportunityId) : undefined;
  
  // Data hooks
  const { data: todayEntry } = useTodayJournalEntry();
  const { data: config } = useWorkScheduleConfig();
  const { data: holidays } = useHolidays();
  const { data: ptoDays } = usePtoDays();
  const { data: overrides } = useWorkdayOverrides();
  
  // Determine states
  const today = new Date();
  const isTodayEligible = config && holidays && ptoDays && overrides
    ? isEligibleDay(today, config, holidays, ptoDays, overrides)
    : false;
  
  const hasCheckedInToday = todayEntry?.checkedIn || false;
  
  // Handle keyboard shortcuts + custom events
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
      // J for Daily Journal
      if (e.key === 'j' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
          e.preventDefault();
          setShowCheckIn(true);
        }
      }
      // Q for quick log
      if (e.key === 'q' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
          e.preventDefault();
          setShowQuickLog(true);
        }
      }
      // Cmd/Ctrl + K for FAB menu
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsExpanded(true);
      }
      // Escape to close
      if (e.key === 'Escape' && isExpanded) {
        setIsExpanded(false);
      }
    };
    
    // Listen for custom events
    const handleOpenPowerHour = () => setShowPowerHour(true);
    const handleVoiceQuickLog = () => setShowQuickLog(true);
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('open-power-hour', handleOpenPowerHour);
    window.addEventListener('voice-quick-log', handleVoiceQuickLog);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('open-power-hour', handleOpenPowerHour);
      window.removeEventListener('voice-quick-log', handleVoiceQuickLog);
    };
  }, [isExpanded]);
  
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
  
  // FAB Actions - in specified order
  const actions: FABAction[] = [
    {
      id: 'add-task',
      label: '+ Task',
      icon: ListPlus,
      shortcut: 'T',
      onClick: () => {
        setShowAddTask(true);
        setIsExpanded(false);
      },
    },
    {
      id: 'add-transcript',
      label: 'Add Transcript',
      icon: FileText,
      onClick: () => {
        setShowAddTranscript(true);
        setIsExpanded(false);
      },
    },
    {
      id: 'view-transcripts',
      label: 'View Transcripts',
      icon: BookOpen,
      onClick: () => {
        setShowTranscriptViewer(true);
        setIsExpanded(false);
      },
    },
    {
      id: 'add-update-opp',
      label: 'Add/Update Opp',
      icon: Target,
      onClick: () => {
        setShowAddUpdateOpp(true);
        setIsExpanded(false);
      },
    },
    ...(prefillOpportunityId ? [{
      id: 'paste-synopsis',
      label: 'Paste Synopsis',
      icon: Sparkles,
      onClick: () => {
        setShowSynopsis(true);
        setIsExpanded(false);
      },
    }] : []),
    {
      id: 'power-hour',
      label: 'Start Power Hour',
      icon: Zap,
      variant: 'yellow',
      onClick: () => {
        setShowPowerHour(true);
        setIsExpanded(false);
      },
    },
    {
      id: 'focus-timer',
      label: 'Start Focus Timer',
      icon: Timer,
      onClick: () => {
        setShowFocusTimer(true);
        setIsExpanded(false);
      },
    },
    {
      id: 'screenshot-enrich',
      label: 'Screenshot Enrich',
      icon: ImagePlus,
      onClick: () => {
        setShowScreenshots(true);
        setIsExpanded(false);
      },
    },
    {
      id: 'screenshot-import',
      label: 'Screenshot Import',
      icon: Camera,
      onClick: () => {
        setShowScreenshotImport(true);
        setIsExpanded(false);
      },
    },
    {
      id: 'resource-library',
      label: 'Resource Library',
      icon: Link2,
      onClick: () => {
        setShowResourceLibrary(true);
        setIsExpanded(false);
      },
    },
    {
      id: 'quick-log',
      label: 'Quick Log',
      icon: Bolt,
      shortcut: 'Q',
      onClick: () => {
        setShowQuickLog(true);
        setIsExpanded(false);
      },
    },
    {
      id: 'log-day',
      label: hasCheckedInToday ? 'Edit Journal' : 'Daily Journal',
      icon: ClipboardCheck,
      shortcut: 'J',
      variant: 'primary',
      onClick: () => {
        setShowCheckIn(true);
        setIsExpanded(false);
      },
    },
  ];
  
  // Position FAB above the 2-row bottom nav (nav is ~92px + safe-area)
  const positionClasses = position === 'bottom-right' 
    ? 'right-4 bottom-[calc(8.5rem+env(safe-area-inset-bottom))]' 
    : 'left-4 bottom-[calc(8.5rem+env(safe-area-inset-bottom))]';
  
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
              className={cn("flex flex-col gap-2 mb-3", menuAlignment)}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.2 }}
            >
              {actions.map((action, index) => {
                const Icon = action.icon;
                return (
                  <motion.div
                    key={action.id}
                    initial={{ opacity: 0, scale: 0.8, x: position === 'bottom-right' ? 20 : -20 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    transition={{ delay: index * 0.03 }}
                  >
                    <Button
                      variant={action.variant === 'primary' ? 'default' : 'secondary'}
                      size="default"
                      className={cn(
                        "gap-2 shadow-lg whitespace-nowrap",
                        action.variant === 'yellow' && "bg-status-yellow text-status-yellow-foreground hover:bg-status-yellow/90"
                      )}
                      onClick={action.onClick}
                    >
                      <Icon className="h-4 w-4" />
                      {action.label}
                      {action.shortcut && (
                        <kbd className="ml-1 text-[10px] bg-background/20 px-1.5 py-0.5 rounded text-current/70">
                          {action.shortcut}
                        </kbd>
                      )}
                    </Button>
                  </motion.div>
                );
              })}
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
              "h-12 w-12 rounded-full shadow-md relative",
              isExpanded && "bg-muted text-muted-foreground hover:bg-muted",
              !isExpanded && "bg-secondary text-secondary-foreground hover:bg-secondary/80",
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
                  <X className="h-5 w-5" />
                </motion.div>
              ) : (
                <motion.div
                  key="plus"
                  initial={{ rotate: 90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: -90, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <Plus className="h-5 w-5" />
                </motion.div>
              )}
            </AnimatePresence>
          </Button>
        </motion.div>
      </div>
      
      {/* Modals */}
      <QuickAddTaskModal
        open={showAddTask}
        onOpenChange={setShowAddTask}
      />
      
      <AddTranscriptModal
        open={showAddTranscript}
        onOpenChange={setShowAddTranscript}
        prefillOpportunityId={prefillOpportunityId || undefined}
      />
      
      <AddUpdateOpportunityModal
        open={showAddUpdateOpp}
        onOpenChange={setShowAddUpdateOpp}
        prefillOpportunityId={prefillOpportunityId || undefined}
        prefillAccountId={prefillAccountId || undefined}
      />
      
      <PowerHourModal
        open={showPowerHour}
        onOpenChange={setShowPowerHour}
      />
      
      <FocusTimerModal
        open={showFocusTimer}
        onOpenChange={setShowFocusTimer}
      />
      
      <DailyScorecardModal
        open={showCheckIn}
        onOpenChange={setShowCheckIn}
      />
      
      <QuickLogModal
        open={showQuickLog}
        onOpenChange={setShowQuickLog}
      />
      
      <ScreenshotEnrichModal
        open={showScreenshots}
        onOpenChange={setShowScreenshots}
      />
      
      <ScreenshotImportModal
        open={showScreenshotImport}
        onOpenChange={setShowScreenshotImport}
      />
      
      <TranscriptViewer
        open={showTranscriptViewer}
        onOpenChange={setShowTranscriptViewer}
      />
      
      <ResourceLibraryModal
        open={showResourceLibrary}
        onOpenChange={setShowResourceLibrary}
      />
      
      {synopsisOpp && (
        <ClaudeSynopsisModal
          open={showSynopsis}
          onOpenChange={setShowSynopsis}
          opportunity={synopsisOpp}
        />
      )}
    </>
  );
}
