// Quota Compass Global State
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { 
  DayEntry, 
  Account, 
  AccountStatus,
  Contact, 
  Renewal, 
  Task, 
  FocusBlock,
  TimerState,
  TimeRange,
  DailyRawInputs,
  DailyActivityInputs,
  RecoveryInputs,
  Opportunity,
  OpportunityStatus,
  OpportunityStage,
  OpportunityActivity,
  TouchType,
  QuotaConfig,
} from '@/types';
import type { RecurringTaskTemplate } from '@/types/recurring';
import { isDueToday } from '@/lib/recurrence';
import { calculateAllScores } from '@/lib/calculations';
import { DEFAULT_QUOTA_CONFIG } from '@/lib/commissionCalculations';

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
  createMissingRenewalOpportunities: () => number;
  
  // Tasks
  tasks: Task[];
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  toggleTaskComplete: (id: string) => void;
  
  // Recurring Task Templates
  recurringTemplates: RecurringTaskTemplate[];
  addRecurringTemplate: (template: Omit<RecurringTaskTemplate, 'id' | 'createdAt' | 'updatedAt' | 'paused'>) => void;
  updateRecurringTemplate: (id: string, updates: Partial<RecurringTaskTemplate>) => void;
  deleteRecurringTemplate: (id: string) => void;
  generateDueRecurringInstances: () => void;
  
  // Opportunities
  opportunities: Opportunity[];
  addOpportunity: (opportunity: Omit<Opportunity, 'id' | 'createdAt' | 'updatedAt' | 'activityLog'>) => void;
  updateOpportunity: (id: string, updates: Partial<Opportunity>) => void;
  deleteOpportunity: (id: string) => void;
  logOpportunityActivity: (id: string, type: TouchType, notes?: string) => void;
  
  // Quick Actions - increment metrics
  logCall: (hadConversation: boolean) => void;
  logManualEmail: () => void;
  logAutomatedEmail: () => void;
  logMeetingHeld: () => void;
  logProspectsAdded: (count: number) => void;
  
  // Quota Config
  quotaConfig: QuotaConfig | null;
  setQuotaConfig: (config: QuotaConfig) => void;
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
        
        const renewalId = generateId();
        const opportunityId = generateId();
        
        // Calculate close date as day before renewal date
        const closeDateObj = new Date(dueDate);
        closeDateObj.setDate(closeDateObj.getDate() - 1);
        const closeDate = closeDateObj.toISOString().split('T')[0];
        
        // Create linked renewal opportunity
        const newOpportunity: Opportunity = {
          id: opportunityId,
          name: `${renewal.accountName} Renewal`,
          accountName: renewal.accountName,
          linkedContactIds: [],
          status: 'active',
          stage: 'Prospect',
          arr: renewal.arr,
          churnRisk: renewal.churnRisk || 'low',
          closeDate: closeDate,
          activityLog: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        
        const newRenewal: Renewal = {
          ...renewal,
          id: renewalId,
          daysToRenewal,
          renewalQuarter: quarter,
          linkedOpportunityId: opportunityId,
          churnRisk: renewal.churnRisk || 'low',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        
        set((state) => ({ 
          renewals: [...state.renewals, newRenewal],
          opportunities: [...state.opportunities, newOpportunity],
        }));
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
      
      createMissingRenewalOpportunities: () => {
        const { renewals, opportunities } = get();
        const newOpportunities: Opportunity[] = [];
        const updatedRenewals: Renewal[] = [];
        
        renewals.forEach(renewal => {
          // Skip if already has a linked opportunity that exists
          if (renewal.linkedOpportunityId) {
            const existingOpp = opportunities.find(o => o.id === renewal.linkedOpportunityId);
            if (existingOpp) return;
          }
          
          const opportunityId = generateId();
          
          // Calculate close date as day before renewal date
          const dueDate = new Date(renewal.renewalDue);
          const closeDateObj = new Date(dueDate);
          closeDateObj.setDate(closeDateObj.getDate() - 1);
          const closeDate = closeDateObj.toISOString().split('T')[0];
          
          const newOpportunity: Opportunity = {
            id: opportunityId,
            name: `${renewal.accountName} Renewal`,
            accountName: renewal.accountName,
            linkedContactIds: [],
            status: 'active',
            stage: 'Prospect',
            arr: renewal.arr,
            churnRisk: renewal.churnRisk || 'low',
            closeDate: closeDate,
            activityLog: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          
          newOpportunities.push(newOpportunity);
          updatedRenewals.push({
            ...renewal,
            linkedOpportunityId: opportunityId,
            updatedAt: new Date().toISOString(),
          });
        });
        
        if (newOpportunities.length > 0) {
          set((state) => ({
            opportunities: [...state.opportunities, ...newOpportunities],
            renewals: state.renewals.map(r => {
              const updated = updatedRenewals.find(ur => ur.id === r.id);
              return updated || r;
            }),
          }));
        }
        
        return newOpportunities.length;
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
        return newTask;
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
              ? { 
                  ...t, 
                  status: (t.status === 'done' ? 'next' : 'done') as any,
                  completedAt: t.status !== 'done' ? new Date().toISOString() : undefined,
                  updatedAt: new Date().toISOString(),
                }
              : t
          ),
        }));
      },
      
      // Recurring Task Templates
      recurringTemplates: [],
      
      addRecurringTemplate: (template) => {
        const newTemplate: RecurringTaskTemplate = {
          ...template,
          id: generateId(),
          paused: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({ recurringTemplates: [...state.recurringTemplates, newTemplate] }));
        // Immediately try to generate an instance for today
        setTimeout(() => get().generateDueRecurringInstances(), 0);
      },
      
      updateRecurringTemplate: (id, updates) => {
        set((state) => ({
          recurringTemplates: state.recurringTemplates.map(t =>
            t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
          ),
        }));
      },
      
      deleteRecurringTemplate: (id) => {
        set((state) => ({
          recurringTemplates: state.recurringTemplates.filter(t => t.id !== id),
        }));
      },
      
      generateDueRecurringInstances: () => {
        const { recurringTemplates, tasks, addTask } = get();
        const todayStr = getTodayString();
        
        recurringTemplates.forEach(template => {
          // Skip if there's an active (non-done, non-dropped) instance — carry forward as overdue
          if (template.activeInstanceId) {
            const activeTask = tasks.find(t => t.id === template.activeInstanceId);
            if (activeTask && activeTask.status !== 'done' && activeTask.status !== 'dropped') {
              return; // Don't create duplicate, carry forward
            }
          }
          
          const dueDate = isDueToday(template, todayStr);
          if (!dueDate) return;
          
          // Create new task instance
          const newTask: Task = {
            id: generateId(),
            title: template.title,
            workstream: template.workstream,
            status: 'next',
            priority: template.priority,
            dueDate: dueDate,
            linkedAccountId: template.linkedAccountId,
            linkedOpportunityId: template.linkedOpportunityId,
            notes: template.notes,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          
          // Add the task directly to state and update template tracking
          set((state) => ({
            tasks: [...state.tasks, newTask],
            recurringTemplates: state.recurringTemplates.map(t =>
              t.id === template.id
                ? {
                    ...t,
                    lastGeneratedDate: todayStr,
                    activeInstanceId: newTask.id,
                    updatedAt: new Date().toISOString(),
                  }
                : t
            ),
          }));
        });
      },
      
      // Opportunities
      opportunities: getDefaultOpportunities(),
      
      addOpportunity: (opportunity) => {
        const newOpportunity: Opportunity = {
          ...opportunity,
          id: generateId(),
          activityLog: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({ opportunities: [...state.opportunities, newOpportunity] }));
      },
      
      updateOpportunity: (id, updates) => {
        set((state) => {
          const opp = state.opportunities.find(o => o.id === id);
          if (!opp) return state;
          
          const updatedOpp = { ...opp, ...updates, updatedAt: new Date().toISOString() };
          
          // === Auto-promote account status from opp stage changes ===
          let updatedAccounts = state.accounts;
          if (updates.stage && opp.accountId) {
            const account = state.accounts.find(a => a.id === opp.accountId);
            if (account) {
              let newAccountStatus: AccountStatus | undefined;
              if (updates.stage === 'Closed Won' || (typeof updates.stage === 'string' && updates.stage.includes('Closed Won'))) {
                // Don't demote — account may have other active opps
              } else if (updates.stage === 'Demo' || updates.stage === 'Proposal' || updates.stage === 'Negotiate') {
                if (account.accountStatus === 'researching' || account.accountStatus === 'prepped' || account.accountStatus === 'active') {
                  newAccountStatus = 'meeting-booked';
                }
              }
              if (newAccountStatus && newAccountStatus !== account.accountStatus) {
                updatedAccounts = state.accounts.map(a =>
                  a.id === opp.accountId ? { ...a, accountStatus: newAccountStatus!, updatedAt: new Date().toISOString() } : a
                );
              }
            }
          }
          
          return {
            opportunities: state.opportunities.map(o => o.id === id ? updatedOpp : o),
            accounts: updatedAccounts,
          };
        });
      },
      
      deleteOpportunity: (id) => {
        set((state) => ({
          opportunities: state.opportunities.filter(o => o.id !== id),
        }));
      },
      
      logOpportunityActivity: (id, type, notes) => {
        const todayStr = getTodayString();
        set((state) => {
          const opp = state.opportunities.find(o => o.id === id);
          if (!opp) return state;
          
          // Update opportunity with activity
          const updatedOpps = state.opportunities.map(o =>
            o.id === id
              ? {
                  ...o,
                  activityLog: [
                    ...o.activityLog,
                    { id: generateId(), type, date: new Date().toISOString(), notes },
                  ],
                  lastTouchDate: todayStr,
                  updatedAt: new Date().toISOString(),
                }
              : o
          );
          
          // === Auto-cascade last-touch to parent account ===
          const updatedAccounts = opp.accountId
            ? state.accounts.map(a =>
                a.id === opp.accountId
                  ? { 
                      ...a, 
                      lastTouchDate: todayStr, 
                      lastTouchType: type,
                      touchesThisWeek: (a.touchesThisWeek || 0) + 1,
                      updatedAt: new Date().toISOString(),
                    }
                  : a
              )
            : state.accounts;
          
          // === Auto-cascade last-touch to linked contacts ===
          const updatedContacts = opp.linkedContactIds.length > 0
            ? state.contacts.map(c =>
                opp.linkedContactIds.includes(c.id)
                  ? { ...c, lastTouchDate: todayStr, updatedAt: new Date().toISOString() }
                  : c
              )
            : state.contacts;
          
          return {
            opportunities: updatedOpps,
            accounts: updatedAccounts,
            contacts: updatedContacts,
          };
        });
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
      
      // Quota Config
      quotaConfig: null,
      setQuotaConfig: (config) => set({ quotaConfig: config }),
    }),
    {
      name: 'quota-compass-storage',
      partialize: (state) => ({
        days: state.days,
        accounts: state.accounts,
        contacts: state.contacts,
        renewals: state.renewals,
        tasks: state.tasks,
        recurringTemplates: state.recurringTemplates,
        focusBlocks: state.focusBlocks,
        opportunities: state.opportunities,
        quotaConfig: state.quotaConfig,
      }),
    }
  )
);

// Default opportunities (seed data)
function getDefaultOpportunities(): Opportunity[] {
  return [
    // Active
    { id: generateId(), name: 'Isabella Stewart Gardner Museum', status: 'active', stage: 'Prospect', nextStepDate: '2026-02-11', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: generateId(), name: 'Franklin Park Conservatory', status: 'active', stage: 'Discover', nextStepDate: '2026-02-06', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: generateId(), name: 'Golden Lighting', status: 'active', stage: 'Demo', nextStepDate: '2026-02-06', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: generateId(), name: '360 View', status: 'active', stage: 'Proposal', nextStep: 'TBD', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: generateId(), name: 'Peabody Essex Museum', status: 'active', stage: '', nextStep: 'TBD', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: generateId(), name: 'Ingram Book Group LLC', status: 'active', stage: '', nextStepDate: '2026-02-06', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: generateId(), name: 'St Pete/Clearwater', status: 'active', stage: '', nextStepDate: '2026-02-09', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: generateId(), name: 'FTD, Inc.', status: 'active', stage: '', nextStep: 'TBD', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    // Stalled
    { id: generateId(), name: 'Visit Raleigh', status: 'stalled', stage: '', nextStepDate: '2026-02-09', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: generateId(), name: 'Kensington Hotel', status: 'stalled', stage: '', nextStep: 'TBD', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: generateId(), name: 'TopBuild', status: 'stalled', stage: '', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: generateId(), name: 'Groundworks', status: 'stalled', stage: '', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: generateId(), name: 'WorldStrides', status: 'stalled', stage: '', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: generateId(), name: 'World Emblem', status: 'stalled', stage: '', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: generateId(), name: 'Legend Fitness', status: 'stalled', stage: '', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    // Closed Lost
    { id: generateId(), name: 'HUB Industrial', status: 'closed-lost', stage: '', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: generateId(), name: 'Southern Gas', status: 'closed-lost', stage: '', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: generateId(), name: 'Beechwood Hotel', status: 'closed-lost', stage: '', linkedContactIds: [], activityLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ];
}
