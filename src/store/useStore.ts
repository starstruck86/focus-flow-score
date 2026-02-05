// Quota Compass Global State
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { 
  DayEntry, 
  Account, 
  Contact, 
  Renewal, 
  Task, 
  FocusBlock,
  TimerState,
  TimeRange,
  DailyRawInputs,
  DailyActivityInputs,
  RecoveryInputs,
} from '@/types';
import { calculateAllScores } from '@/lib/calculations';

interface QuotaCompassStore {
  // Time Range
  timeRange: TimeRange;
  setTimeRange: (range: TimeRange) => void;
  
  // Days
  days: DayEntry[];
  currentDay: DayEntry | null;
  initializeToday: () => void;
  updateRawInputs: (inputs: Partial<DailyRawInputs>) => void;
  updateActivityInputs: (inputs: Partial<DailyActivityInputs>) => void;
  updateRecoveryInputs: (inputs: Partial<RecoveryInputs>) => void;
  saveDay: () => void;
  
  // Timer
  timer: TimerState;
  startTimer: (minutes: number, blockType: TimerState['blockType'], accountId?: string) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  resetTimer: () => void;
  tickTimer: () => void;
  completeBlock: () => void;
  
  // Focus Blocks
  focusBlocks: FocusBlock[];
  todayBlockMinutes: (type: TimerState['blockType']) => number;
  
  // Accounts
  accounts: Account[];
  addAccount: (account: Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'touchesThisWeek'>) => void;
  updateAccount: (id: string, updates: Partial<Account>) => void;
  deleteAccount: (id: string) => void;
  
  // Contacts
  contacts: Contact[];
  addContact: (contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateContact: (id: string, updates: Partial<Contact>) => void;
  deleteContact: (id: string) => void;
  
  // Renewals
  renewals: Renewal[];
  addRenewal: (renewal: Omit<Renewal, 'id' | 'createdAt' | 'updatedAt' | 'daysToRenewal' | 'renewalQuarter'>) => void;
  updateRenewal: (id: string, updates: Partial<Renewal>) => void;
  deleteRenewal: (id: string) => void;
  
  // Tasks
  tasks: Task[];
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  toggleTaskComplete: (id: string) => void;
  
  // Quick Actions - increment metrics
  logCall: (hadConversation: boolean) => void;
  logManualEmail: () => void;
  logAutomatedEmail: () => void;
  logMeetingHeld: () => void;
  logProspectsAdded: (count: number) => void;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

function getDefaultRawInputs(): DailyRawInputs {
  return {
    prospectsAddedToCadence: 0,
    coldCallsWithConversations: 0,
    emailsInMailsToManager: 0,
    initialMeetingsSet: 0,
    opportunitiesCreated: 0,
    personalDevelopment: 0,
  };
}

function getDefaultActivityInputs(): DailyActivityInputs {
  return {
    dials: 0,
    emailsTotal: 0,
    automatedPercent: 0,
    execManagerOutreach: 0,
    customerMeetingsHeld: 0,
    accountDeepWorkMinutes: 0,
    prospectingBlockMinutes: 0,
    expansionTouchpoints: 0,
    focusMode: 'balanced',
  };
}

function getDefaultRecoveryInputs(): RecoveryInputs {
  return {
    energy: 3,
    focusQuality: 3,
    stress: 3,
    sleepHours: 7,
    distractions: 'medium',
    adminHeavyDay: false,
    travelDay: false,
    clarity: 3,
    contextSwitching: 'medium',
    meetingMinutes: 0,
  };
}

function createEmptyDay(date: string): DayEntry {
  const raw = getDefaultRawInputs();
  const activity = getDefaultActivityInputs();
  const recovery = getDefaultRecoveryInputs();
  const scores = calculateAllScores(raw, activity, recovery, []);
  
  return {
    id: generateId(),
    date,
    rawInputs: raw,
    activityInputs: activity,
    recoveryInputs: recovery,
    scores,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export const useStore = create<QuotaCompassStore>()(
  persist(
    (set, get) => ({
      // Time Range
      timeRange: 'today',
      setTimeRange: (range) => set({ timeRange: range }),
      
      // Days
      days: [],
      currentDay: null,
      
      initializeToday: () => {
        const today = getTodayString();
        const { days } = get();
        const existingDay = days.find(d => d.date === today);
        
        if (existingDay) {
          set({ currentDay: existingDay });
        } else {
          const newDay = createEmptyDay(today);
          set({ currentDay: newDay });
        }
      },
      
      updateRawInputs: (inputs) => {
        const { currentDay, days } = get();
        if (!currentDay) return;
        
        const newRaw = { ...currentDay.rawInputs, ...inputs };
        const newScores = calculateAllScores(
          newRaw,
          currentDay.activityInputs,
          currentDay.recoveryInputs,
          days.filter(d => d.date < currentDay.date).sort((a, b) => b.date.localeCompare(a.date))
        );
        
        set({
          currentDay: {
            ...currentDay,
            rawInputs: newRaw,
            scores: newScores,
            updatedAt: new Date().toISOString(),
          },
        });
      },
      
      updateActivityInputs: (inputs) => {
        const { currentDay, days } = get();
        if (!currentDay) return;
        
        const newActivity = { ...currentDay.activityInputs, ...inputs };
        const newScores = calculateAllScores(
          currentDay.rawInputs,
          newActivity,
          currentDay.recoveryInputs,
          days.filter(d => d.date < currentDay.date).sort((a, b) => b.date.localeCompare(a.date))
        );
        
        set({
          currentDay: {
            ...currentDay,
            activityInputs: newActivity,
            scores: newScores,
            updatedAt: new Date().toISOString(),
          },
        });
      },
      
      updateRecoveryInputs: (inputs) => {
        const { currentDay, days } = get();
        if (!currentDay) return;
        
        const newRecovery = { ...currentDay.recoveryInputs, ...inputs };
        const newScores = calculateAllScores(
          currentDay.rawInputs,
          currentDay.activityInputs,
          newRecovery,
          days.filter(d => d.date < currentDay.date).sort((a, b) => b.date.localeCompare(a.date))
        );
        
        set({
          currentDay: {
            ...currentDay,
            recoveryInputs: newRecovery,
            scores: newScores,
            updatedAt: new Date().toISOString(),
          },
        });
      },
      
      saveDay: () => {
        const { currentDay, days } = get();
        if (!currentDay) return;
        
        const existingIndex = days.findIndex(d => d.date === currentDay.date);
        const newDays = [...days];
        
        if (existingIndex >= 0) {
          newDays[existingIndex] = currentDay;
        } else {
          newDays.push(currentDay);
        }
        
        set({ days: newDays.sort((a, b) => b.date.localeCompare(a.date)) });
      },
      
      // Timer
      timer: {
        isRunning: false,
        isPaused: false,
        totalSeconds: 0,
        remainingSeconds: 0,
        blockType: 'prospecting',
        breakMode: false,
        breakDuration: 5,
        repeatEnabled: false,
      },
      
      startTimer: (minutes, blockType, accountId) => {
        set({
          timer: {
            isRunning: true,
            isPaused: false,
            totalSeconds: minutes * 60,
            remainingSeconds: minutes * 60,
            blockType,
            accountId,
            breakMode: false,
            breakDuration: 5,
            repeatEnabled: false,
          },
        });
      },
      
      pauseTimer: () => {
        set((state) => ({
          timer: { ...state.timer, isPaused: true },
        }));
      },
      
      resumeTimer: () => {
        set((state) => ({
          timer: { ...state.timer, isPaused: false },
        }));
      },
      
      resetTimer: () => {
        set({
          timer: {
            isRunning: false,
            isPaused: false,
            totalSeconds: 0,
            remainingSeconds: 0,
            blockType: 'prospecting',
            breakMode: false,
            breakDuration: 5,
            repeatEnabled: false,
          },
        });
      },
      
      tickTimer: () => {
        set((state) => {
          if (!state.timer.isRunning || state.timer.isPaused) return state;
          
          const newRemaining = state.timer.remainingSeconds - 1;
          
          if (newRemaining <= 0) {
            return {
              timer: { ...state.timer, remainingSeconds: 0, isRunning: false },
            };
          }
          
          return {
            timer: { ...state.timer, remainingSeconds: newRemaining },
          };
        });
      },
      
      completeBlock: () => {
        const { timer, focusBlocks, currentDay, updateActivityInputs } = get();
        const elapsedMinutes = Math.round((timer.totalSeconds - timer.remainingSeconds) / 60);
        
        if (elapsedMinutes > 0) {
          const newBlock: FocusBlock = {
            id: generateId(),
            date: getTodayString(),
            startTime: new Date(Date.now() - elapsedMinutes * 60000).toISOString(),
            endTime: new Date().toISOString(),
            durationMinutes: elapsedMinutes,
            type: timer.blockType,
            accountId: timer.accountId,
            completed: true,
          };
          
          set({ focusBlocks: [...focusBlocks, newBlock] });
          
          // Update activity inputs
          if (timer.blockType === 'prospecting') {
            updateActivityInputs({
              prospectingBlockMinutes: (currentDay?.activityInputs.prospectingBlockMinutes || 0) + elapsedMinutes,
            });
          } else {
            updateActivityInputs({
              accountDeepWorkMinutes: (currentDay?.activityInputs.accountDeepWorkMinutes || 0) + elapsedMinutes,
            });
          }
        }
        
        get().resetTimer();
      },
      
      // Focus Blocks
      focusBlocks: [],
      
      todayBlockMinutes: (type) => {
        const today = getTodayString();
        return get()
          .focusBlocks
          .filter(b => b.date === today && b.type === type)
          .reduce((sum, b) => sum + b.durationMinutes, 0);
      },
      
      // Accounts
      accounts: [],
      
      addAccount: (account) => {
        const newAccount: Account = {
          ...account,
          id: generateId(),
          touchesThisWeek: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({ accounts: [...state.accounts, newAccount] }));
      },
      
      updateAccount: (id, updates) => {
        set((state) => ({
          accounts: state.accounts.map(a =>
            a.id === id
              ? { ...a, ...updates, updatedAt: new Date().toISOString() }
              : a
          ),
        }));
      },
      
      deleteAccount: (id) => {
        set((state) => ({
          accounts: state.accounts.filter(a => a.id !== id),
        }));
      },
      
      // Contacts
      contacts: [],
      
      addContact: (contact) => {
        const newContact: Contact = {
          ...contact,
          id: generateId(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({ contacts: [...state.contacts, newContact] }));
      },
      
      updateContact: (id, updates) => {
        set((state) => ({
          contacts: state.contacts.map(c =>
            c.id === id
              ? { ...c, ...updates, updatedAt: new Date().toISOString() }
              : c
          ),
        }));
      },
      
      deleteContact: (id) => {
        set((state) => ({
          contacts: state.contacts.filter(c => c.id !== id),
        }));
      },
      
      // Renewals
      renewals: [],
      
      addRenewal: (renewal) => {
        const dueDate = new Date(renewal.renewalDue);
        const today = new Date();
        const daysToRenewal = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        const quarter = `Q${Math.ceil((dueDate.getMonth() + 1) / 3)} ${dueDate.getFullYear()}`;
        
        const newRenewal: Renewal = {
          ...renewal,
          id: generateId(),
          daysToRenewal,
          renewalQuarter: quarter,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({ renewals: [...state.renewals, newRenewal] }));
      },
      
      updateRenewal: (id, updates) => {
        set((state) => ({
          renewals: state.renewals.map(r => {
            if (r.id !== id) return r;
            
            const updated = { ...r, ...updates, updatedAt: new Date().toISOString() };
            
            // Recalculate days if renewal date changed
            if (updates.renewalDue) {
              const dueDate = new Date(updates.renewalDue);
              const today = new Date();
              updated.daysToRenewal = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              updated.renewalQuarter = `Q${Math.ceil((dueDate.getMonth() + 1) / 3)} ${dueDate.getFullYear()}`;
            }
            
            return updated;
          }),
        }));
      },
      
      deleteRenewal: (id) => {
        set((state) => ({
          renewals: state.renewals.filter(r => r.id !== id),
        }));
      },
      
      // Tasks
      tasks: [],
      
      addTask: (task) => {
        const newTask: Task = {
          ...task,
          id: generateId(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({ tasks: [...state.tasks, newTask] }));
      },
      
      updateTask: (id, updates) => {
        set((state) => ({
          tasks: state.tasks.map(t =>
            t.id === id
              ? { ...t, ...updates, updatedAt: new Date().toISOString() }
              : t
          ),
        }));
      },
      
      deleteTask: (id) => {
        set((state) => ({
          tasks: state.tasks.filter(t => t.id !== id),
        }));
      },
      
      toggleTaskComplete: (id) => {
        set((state) => ({
          tasks: state.tasks.map(t =>
            t.id === id
              ? { ...t, status: t.status === 'done' ? 'open' : 'done', updatedAt: new Date().toISOString() }
              : t
          ),
        }));
      },
      
      // Quick Actions
      logCall: (hadConversation) => {
        const { updateActivityInputs, updateRawInputs, currentDay } = get();
        updateActivityInputs({
          dials: (currentDay?.activityInputs.dials || 0) + 1,
        });
        if (hadConversation) {
          updateRawInputs({
            coldCallsWithConversations: (currentDay?.rawInputs.coldCallsWithConversations || 0) + 1,
          });
        }
      },
      
      logManualEmail: () => {
        const { updateActivityInputs, currentDay } = get();
        updateActivityInputs({
          emailsTotal: (currentDay?.activityInputs.emailsTotal || 0) + 1,
          // Keep automated % as is, effectively making this manual
        });
      },
      
      logAutomatedEmail: () => {
        const { updateActivityInputs, currentDay } = get();
        const current = currentDay?.activityInputs;
        if (!current) return;
        
        const newTotal = current.emailsTotal + 1;
        // Recalculate automated percentage
        const currentAuto = current.emailsTotal * (current.automatedPercent / 100);
        const newAuto = currentAuto + 1;
        const newPercent = Math.round((newAuto / newTotal) * 100) as 0 | 25 | 50 | 75 | 100;
        
        updateActivityInputs({
          emailsTotal: newTotal,
          automatedPercent: Math.min(100, Math.round(newPercent / 25) * 25) as 0 | 25 | 50 | 75 | 100,
        });
      },
      
      logMeetingHeld: () => {
        const { updateActivityInputs, currentDay } = get();
        updateActivityInputs({
          customerMeetingsHeld: (currentDay?.activityInputs.customerMeetingsHeld || 0) + 1,
        });
      },
      
      logProspectsAdded: (count) => {
        const { updateRawInputs, currentDay } = get();
        updateRawInputs({
          prospectsAddedToCadence: (currentDay?.rawInputs.prospectsAddedToCadence || 0) + count,
        });
      },
    }),
    {
      name: 'quota-compass-storage',
      partialize: (state) => ({
        days: state.days,
        accounts: state.accounts,
        contacts: state.contacts,
        renewals: state.renewals,
        tasks: state.tasks,
        focusBlocks: state.focusBlocks,
      }),
    }
  )
);
