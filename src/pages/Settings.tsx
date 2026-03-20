import { useState } from 'react';
import { useStore } from '@/store/useStore';
import { ConversionBenchmarksSettings } from '@/components/settings/ConversionBenchmarksSettings';
import { NotificationSettings } from '@/components/NotificationSettings';
import { Layout } from '@/components/Layout';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  Plus, 
  Trash2, 
  Settings as SettingsIcon, 
  Palette, 
  Database, 
  Bell,
  ChevronDown,
  Check,
  ClipboardCheck,
  Upload,
  Download,
  FileSpreadsheet,
  Link2,
  ArrowRight,
} from 'lucide-react';
import { ImportWizard } from '@/components/import';
import { DuplicateDetector } from '@/components/DuplicateDetector';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WhoopIntegration } from '@/components/WhoopIntegration';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { 
  useWorkScheduleConfig, 
  useHolidays, 
  usePtoDays,
  useUpdateConfig,
  useAddHoliday,
  useRemoveHoliday,
  useAddPtoDay,
  useRemovePtoDay,
} from '@/hooks/useStreakData';
import {
  useHeaderMappings,
  useDeleteHeaderMapping,
  useValueMappings,
  useDeleteValueMapping,
  useAccountAliases,
  useDeleteAccountAlias,
} from '@/hooks/useImportMappings';
import { useDbAccounts } from '@/hooks/useAccountsData';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, XCircle, Loader2, Mic } from 'lucide-react';

function DaveHealthSection() {
  const [health, setHealth] = useState<{ apiKey: boolean; agentId: boolean; tokenOk: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  const runCheck = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.functions.invoke('dave-health-check');
      if (data) {
        setHealth({ apiKey: data.apiKeyValid, agentId: data.agentIdSet, tokenOk: data.tokenGenOk });
      }
    } catch {
      toast.error('Health check failed');
    } finally {
      setLoading(false);
    }
  };

  const StatusIcon = ({ ok }: { ok: boolean | undefined }) => {
    if (ok === undefined) return null;
    return ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-destructive" />;
  };

  return (
    <div className="metric-card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg"><Mic className="h-5 w-5 text-emerald-500" /></div>
          <div>
            <h3 className="font-semibold">Dave Voice Assistant</h3>
            <p className="text-sm text-muted-foreground">ElevenLabs Conversational AI</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={runCheck} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          Run Health Check
        </Button>
      </div>

      {health && (
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2 text-sm"><StatusIcon ok={health.apiKey} /> API Key valid</div>
          <div className="flex items-center gap-2 text-sm"><StatusIcon ok={health.agentId} /> Agent ID configured</div>
          <div className="flex items-center gap-2 text-sm"><StatusIcon ok={health.tokenOk} /> Token generation working</div>
        </div>
      )}

      <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground text-sm">Required ElevenLabs Settings</p>
        <p>• "System prompt override" must be <strong>enabled</strong> in agent settings</p>
        <p>• "First message override" must be <strong>enabled</strong> in agent settings</p>
        <p>• Triple-tap the status text in Dave to open diagnostics</p>
      </div>
    </div>
  );
}

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

// US Federal Holidays for auto-import
const US_FEDERAL_HOLIDAYS_2025 = [
  { date: '2025-01-01', name: "New Year's Day" },
  { date: '2025-01-20', name: 'Martin Luther King Jr. Day' },
  { date: '2025-02-17', name: "Presidents' Day" },
  { date: '2025-05-26', name: 'Memorial Day' },
  { date: '2025-06-19', name: 'Juneteenth' },
  { date: '2025-07-04', name: 'Independence Day' },
  { date: '2025-09-01', name: 'Labor Day' },
  { date: '2025-10-13', name: 'Columbus Day' },
  { date: '2025-11-11', name: 'Veterans Day' },
  { date: '2025-11-27', name: 'Thanksgiving Day' },
  { date: '2025-12-25', name: 'Christmas Day' },
];

const US_FEDERAL_HOLIDAYS_2026 = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-19', name: 'Martin Luther King Jr. Day' },
  { date: '2026-02-16', name: "Presidents' Day" },
  { date: '2026-05-25', name: 'Memorial Day' },
  { date: '2026-06-19', name: 'Juneteenth' },
  { date: '2026-07-03', name: 'Independence Day (Observed)' },
  { date: '2026-09-07', name: 'Labor Day' },
  { date: '2026-10-12', name: 'Columbus Day' },
  { date: '2026-11-11', name: 'Veterans Day' },
  { date: '2026-11-26', name: 'Thanksgiving Day' },
  { date: '2026-12-25', name: 'Christmas Day' },
];

// Data Import Section Component
function DataImportSection() {
  const [showImportWizard, setShowImportWizard] = useState(false);
  
  return (
    <>
      <div className="metric-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-recovery/10 flex items-center justify-center">
              <Upload className="h-5 w-5 text-recovery" />
            </div>
            <div>
              <h3 className="font-semibold">Import Data</h3>
              <p className="text-sm text-muted-foreground">Import accounts, opportunities, renewals from CSV</p>
            </div>
          </div>
          <Button onClick={() => setShowImportWizard(true)}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
        </div>
        
        <div className="bg-muted/30 rounded-lg p-3">
          <p className="text-sm text-muted-foreground mb-2">
            Combined file support with "Map Once, Reuse Forever":
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 bg-background rounded">New Logo + Renewals</span>
            <span className="px-2 py-1 bg-background rounded">Salesforce Links</span>
            <span className="px-2 py-1 bg-background rounded">Planhat Links</span>
            <span className="px-2 py-1 bg-background rounded">Opportunities</span>
            <span className="px-2 py-1 bg-background rounded">ARR</span>
            <span className="px-2 py-1 bg-background rounded">+more</span>
          </div>
        </div>
      </div>
      
      <ImportWizard open={showImportWizard} onOpenChange={setShowImportWizard} />
    </>
  );
}

// Data Export Section Component
function DataExportSection() {
  const [exporting, setExporting] = useState(false);

  const handleExportJSON = async () => {
    setExporting(true);
    try {
      const state = useStore.getState();
      const exportData = {
        exportedAt: new Date().toISOString(),
        version: 1,
        accounts: state.accounts,
        contacts: state.contacts,
        opportunities: state.opportunities,
        renewals: state.renewals,
        tasks: state.tasks,
        days: state.days,
        recurringTemplates: state.recurringTemplates,
        quotaConfig: state.quotaConfig,
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quota-compass-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Backup downloaded successfully');
    } catch (e) {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const state = useStore.getState();
      
      // Accounts CSV
      const accountHeaders = ['Name', 'Website', 'Industry', 'Tier', 'Status', 'Motion', 'Outreach Status', 'Last Touch', 'Next Step', 'Notes'];
      const accountRows = state.accounts.map(a => [
        a.name, a.website || '', a.industry || '', a.tier, a.accountStatus, a.motion,
        a.outreachStatus, a.lastTouchDate || '', a.nextStep || '', (a.notes || '').replace(/"/g, '""'),
      ].map(v => `"${v}"`).join(','));
      
      // Opportunities CSV
      const oppHeaders = ['Name', 'Stage', 'Status', 'ARR', 'Close Date', 'Next Step', 'Deal Type', 'Notes'];
      const oppRows = state.opportunities.map(o => [
        o.name, o.stage, o.status, o.arr || '', o.closeDate || '', o.nextStep || '',
        o.dealType || '', (o.notes || '').replace(/"/g, '""'),
      ].map(v => `"${v}"`).join(','));

      const csv = [
        '--- ACCOUNTS ---',
        accountHeaders.join(','),
        ...accountRows,
        '',
        '--- OPPORTUNITIES ---',
        oppHeaders.join(','),
        ...oppRows,
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quota-compass-export-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV exported successfully');
    } catch (e) {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="metric-card">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Download className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold">Export & Backup</h3>
          <p className="text-sm text-muted-foreground">Download your data for safekeeping</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button onClick={handleExportJSON} disabled={exporting} variant="outline">
          <Download className="h-4 w-4 mr-2" />
          Full Backup (JSON)
        </Button>
        <Button onClick={handleExportCSV} disabled={exporting} variant="outline">
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        JSON backup includes all data and can be used to restore your workspace. CSV is for spreadsheet viewing.
      </p>
    </div>
  );
}

// Import Mappings Section Component
function ImportMappingsSection() {
  const { data: headerMappings = [] } = useHeaderMappings();
  const { data: valueMappings = [] } = useValueMappings();
  const { data: accountAliases = [] } = useAccountAliases();
  const { data: accounts = [] } = useDbAccounts();
  
  const deleteHeaderMapping = useDeleteHeaderMapping();
  const deleteValueMapping = useDeleteValueMapping();
  const deleteAccountAlias = useDeleteAccountAlias();
  
  const getAccountName = (accountId: string) => {
    const account = accounts.find(a => a.id === accountId);
    return account?.name || 'Unknown';
  };
  
  const hasAnyMappings = headerMappings.length > 0 || valueMappings.length > 0 || accountAliases.length > 0;
  
  return (
    <div className="metric-card">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Link2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold">Import Mappings</h3>
          <p className="text-sm text-muted-foreground">Saved mappings for future imports</p>
        </div>
      </div>
      
      {!hasAnyMappings ? (
        <p className="text-sm text-muted-foreground">
          No saved mappings yet. Mappings are created when you import data and choose to save them.
        </p>
      ) : (
        <Accordion type="multiple" className="w-full">
          {/* Header Mappings */}
          {headerMappings.length > 0 && (
            <AccordionItem value="headers">
              <AccordionTrigger className="text-sm">
                Header Mappings ({headerMappings.length})
              </AccordionTrigger>
              <AccordionContent>
                <ScrollArea className="max-h-48">
                  <div className="space-y-2">
                    {headerMappings.map(hm => (
                      <div key={hm.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-mono text-xs bg-background px-1.5 py-0.5 rounded">{hm.csv_header}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <Badge variant="outline" className="text-xs">
                            {hm.target_object}.{hm.target_field}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => deleteHeaderMapping.mutate(hm.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </AccordionContent>
            </AccordionItem>
          )}
          
          {/* Value Mappings */}
          {valueMappings.length > 0 && (
            <AccordionItem value="values">
              <AccordionTrigger className="text-sm">
                Value Mappings ({valueMappings.length})
              </AccordionTrigger>
              <AccordionContent>
                <ScrollArea className="max-h-48">
                  <div className="space-y-2">
                    {valueMappings.map(vm => (
                      <div key={vm.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-2 text-sm">
                          <Badge variant="secondary" className="text-xs">{vm.field_name}</Badge>
                          <span className="text-xs">"{vm.csv_value}"</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs font-medium">{vm.app_value}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => deleteValueMapping.mutate(vm.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </AccordionContent>
            </AccordionItem>
          )}
          
          {/* Account Aliases */}
          {accountAliases.length > 0 && (
            <AccordionItem value="aliases">
              <AccordionTrigger className="text-sm">
                Account Aliases ({accountAliases.length})
              </AccordionTrigger>
              <AccordionContent>
                <ScrollArea className="max-h-48">
                  <div className="space-y-2">
                    {accountAliases.map(aa => (
                      <div key={aa.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-2 text-sm">
                          <Badge variant="outline" className="text-xs">{aa.alias_type}</Badge>
                          <span className="text-xs">"{aa.alias_value}"</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs font-medium">{getAccountName(aa.account_id)}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => deleteAccountAlias.mutate(aa.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      )}
    </div>
  );
}

export default function Settings() {
  const { data: config, isLoading: configLoading } = useWorkScheduleConfig();
  const { data: holidays, isLoading: holidaysLoading } = useHolidays();
  const { data: ptoDays, isLoading: ptoLoading } = usePtoDays();
  
  const updateConfig = useUpdateConfig();
  const addHoliday = useAddHoliday();
  const removeHoliday = useRemoveHoliday();
  const addPtoDay = useAddPtoDay();
  const removePtoDay = useRemovePtoDay();
  
  const [newHolidayDate, setNewHolidayDate] = useState<Date>();
  const [newHolidayName, setNewHolidayName] = useState('');
  const [newPtoDate, setNewPtoDate] = useState<Date>();
  const [newPtoNote, setNewPtoNote] = useState('');
  
  const handleToggleWorkday = (dayValue: number) => {
    if (!config) return;
    const newDays = config.workingDays.includes(dayValue)
      ? config.workingDays.filter(d => d !== dayValue)
      : [...config.workingDays, dayValue].sort();
    
    updateConfig.mutate({ workingDays: newDays }, {
      onSuccess: () => toast.success('Work schedule updated'),
    });
  };
  
  const handleImportUSHolidays = async () => {
    const allHolidays = [...US_FEDERAL_HOLIDAYS_2025, ...US_FEDERAL_HOLIDAYS_2026];
    const existingDates = new Set(holidays?.map(h => h.date) || []);
    const toAdd = allHolidays.filter(h => !existingDates.has(h.date));
    
    for (const holiday of toAdd) {
      await addHoliday.mutateAsync({ date: holiday.date, name: holiday.name });
    }
    
    toast.success(`Imported ${toAdd.length} US federal holidays`);
  };
  
  const handleAddHoliday = () => {
    if (!newHolidayDate || !newHolidayName.trim()) {
      toast.error('Please enter a date and name');
      return;
    }
    
    addHoliday.mutate({ 
      date: format(newHolidayDate, 'yyyy-MM-dd'), 
      name: newHolidayName.trim() 
    }, {
      onSuccess: () => {
        toast.success('Holiday added');
        setNewHolidayDate(undefined);
        setNewHolidayName('');
      },
    });
  };
  
  const handleAddPto = () => {
    if (!newPtoDate) {
      toast.error('Please select a date');
      return;
    }
    
    addPtoDay.mutate({ 
      date: format(newPtoDate, 'yyyy-MM-dd'), 
      note: newPtoNote.trim() || undefined 
    }, {
      onSuccess: () => {
        toast.success('PTO day added');
        setNewPtoDate(undefined);
        setNewPtoNote('');
      },
    });
  };
  
  const isLoading = configLoading || holidaysLoading || ptoLoading;

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-3xl">
        <div className="mb-8">
          <h1 className="font-display text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">Customize your experience</p>
        </div>

        <Tabs defaultValue="schedule" className="space-y-6">
          <TabsList className="flex-wrap">
            <TabsTrigger value="schedule">Work Schedule</TabsTrigger>
            <TabsTrigger value="coaching">Coaching</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
          </TabsList>
          
          {/* Work Schedule Tab */}
          <TabsContent value="schedule" className="space-y-6">
            {/* Working Days */}
            <div className="metric-card">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <CalendarIcon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Working Days</h3>
                  <p className="text-sm text-muted-foreground">Select which days count as workdays</p>
                </div>
              </div>
              
              {isLoading ? (
                <div className="h-10 bg-muted/30 rounded animate-pulse" />
              ) : (
                <div className="flex gap-2">
                  {DAYS_OF_WEEK.map(day => (
                    <button
                      key={day.value}
                      onClick={() => handleToggleWorkday(day.value)}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-sm font-medium transition-all",
                        config?.workingDays.includes(day.value)
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            {/* Holidays */}
            <div className="metric-card">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-strain/10 flex items-center justify-center">
                    <CalendarIcon className="h-5 w-5 text-strain" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Holidays</h3>
                    <p className="text-sm text-muted-foreground">Non-working holidays</p>
                  </div>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleImportUSHolidays}
                  disabled={addHoliday.isPending}
                >
                  Import US Holidays
                </Button>
              </div>
              
              {/* Add Holiday Form */}
              <div className="flex gap-2 mb-4">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="w-[140px] justify-start">
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {newHolidayDate ? format(newHolidayDate, 'MMM d, yyyy') : 'Pick date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={newHolidayDate}
                      onSelect={setNewHolidayDate}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
                <Input
                  placeholder="Holiday name"
                  value={newHolidayName}
                  onChange={(e) => setNewHolidayName(e.target.value)}
                  className="flex-1"
                />
                <Button size="sm" onClick={handleAddHoliday} disabled={addHoliday.isPending}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              
              {/* Holiday List */}
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {holidays?.map(holiday => (
                  <div 
                    key={holiday.id} 
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/30"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {format(parseISO(holiday.date), 'MMM d, yyyy')}
                      </span>
                      <span className="text-sm font-medium">{holiday.name}</span>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-7 w-7"
                      onClick={() => removeHoliday.mutate(holiday.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
                {holidays?.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No holidays configured. Import US holidays or add manually.
                  </p>
                )}
              </div>
            </div>
            
            {/* PTO */}
            <div className="metric-card">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-recovery/10 flex items-center justify-center">
                  <CalendarIcon className="h-5 w-5 text-recovery" />
                </div>
                <div>
                  <h3 className="font-semibold">PTO Days</h3>
                  <p className="text-sm text-muted-foreground">Personal time off</p>
                </div>
              </div>
              
              {/* Add PTO Form */}
              <div className="flex gap-2 mb-4">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="w-[140px] justify-start">
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {newPtoDate ? format(newPtoDate, 'MMM d, yyyy') : 'Pick date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={newPtoDate}
                      onSelect={setNewPtoDate}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
                <Input
                  placeholder="Note (optional)"
                  value={newPtoNote}
                  onChange={(e) => setNewPtoNote(e.target.value)}
                  className="flex-1"
                />
                <Button size="sm" onClick={handleAddPto} disabled={addPtoDay.isPending}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              
              {/* PTO List */}
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {ptoDays?.map(pto => (
                  <div 
                    key={pto.id} 
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/30"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {format(parseISO(pto.date), 'MMM d, yyyy')}
                      </span>
                      {pto.note && <span className="text-sm">{pto.note}</span>}
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-7 w-7"
                      onClick={() => removePtoDay.mutate(pto.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
                {ptoDays?.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No PTO days scheduled.
                  </p>
                )}
              </div>
            </div>
            
            {/* Streak Settings */}
            <div className="metric-card">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-productivity/10 flex items-center justify-center">
                  <SettingsIcon className="h-5 w-5 text-productivity" />
                </div>
                <div>
                  <h3 className="font-semibold">Streak & Goal Settings</h3>
                  <p className="text-sm text-muted-foreground">Configure goal thresholds</p>
                </div>
              </div>
              
              {isLoading ? (
                <div className="space-y-4">
                  <div className="h-12 bg-muted/30 rounded animate-pulse" />
                  <div className="h-12 bg-muted/30 rounded animate-pulse" />
                </div>
              ) : (
                <div className="space-y-6">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Daily Score Goal</Label>
                      <span className="text-sm font-medium">{config?.goalDailyScoreThreshold}</span>
                    </div>
                    <Slider
                      value={[config?.goalDailyScoreThreshold || 8]}
                      min={1}
                      max={15}
                      step={1}
                      onValueChange={([value]) => updateConfig.mutate({ goalDailyScoreThreshold: value })}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Goal is met if Daily Score ≥ {config?.goalDailyScoreThreshold}
                    </p>
                  </div>
                  
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Productivity Goal (%)</Label>
                      <span className="text-sm font-medium">{config?.goalProductivityThreshold}%</span>
                    </div>
                    <Slider
                      value={[config?.goalProductivityThreshold || 75]}
                      min={50}
                      max={100}
                      step={5}
                      onValueChange={([value]) => updateConfig.mutate({ goalProductivityThreshold: value })}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Alternative: Goal is met if Productivity ≥ {config?.goalProductivityThreshold}%
                    </p>
                  </div>
                  
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Grace Window (hours)</Label>
                      <span className="text-sm font-medium">{config?.graceWindowHours}h</span>
                    </div>
                    <Slider
                      value={[config?.graceWindowHours || 2]}
                      min={0}
                      max={6}
                      step={1}
                      onValueChange={([value]) => updateConfig.mutate({ graceWindowHours: value })}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Late-night entries count for previous day until {config?.graceWindowHours}:00 AM
                    </p>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Daily Reminder</Label>
                      <p className="text-xs text-muted-foreground">Remind to check in on workdays</p>
                    </div>
                    <Switch
                      checked={config?.reminderEnabled}
                      onCheckedChange={(checked) => updateConfig.mutate({ reminderEnabled: checked })}
                    />
                  </div>
                </div>
              )}
            </div>
            
            {/* Journal Schedule Settings */}
            <div className="metric-card">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <ClipboardCheck className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Daily Check-In Schedule</h3>
                  <p className="text-sm text-muted-foreground">Configure when journal prompts appear</p>
                </div>
              </div>
              
              {isLoading ? (
                <div className="space-y-4">
                  <div className="h-12 bg-muted/30 rounded animate-pulse" />
                  <div className="h-12 bg-muted/30 rounded animate-pulse" />
                </div>
              ) : (
                <div className="space-y-6">
                  {/* EOD Check-In Time */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        End-of-Day Check-In Time
                      </Label>
                    </div>
                    <Select
                      value={config?.eodCheckinTime?.slice(0, 5) || '16:30'}
                      onValueChange={(value) => updateConfig.mutate({ eodCheckinTime: value + ':00' })}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="14:00">2:00 PM</SelectItem>
                        <SelectItem value="14:30">2:30 PM</SelectItem>
                        <SelectItem value="15:00">3:00 PM</SelectItem>
                        <SelectItem value="15:30">3:30 PM</SelectItem>
                        <SelectItem value="16:00">4:00 PM</SelectItem>
                        <SelectItem value="16:30">4:30 PM</SelectItem>
                        <SelectItem value="17:00">5:00 PM</SelectItem>
                        <SelectItem value="17:30">5:30 PM</SelectItem>
                        <SelectItem value="18:00">6:00 PM</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      When the daily check-in prompt appears
                    </p>
                  </div>
                  
                  {/* EOD Reminder Time */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="flex items-center gap-2">
                        <Bell className="h-4 w-4 text-muted-foreground" />
                        Reminder Time
                      </Label>
                    </div>
                    <Select
                      value={config?.eodReminderTime?.slice(0, 5) || '18:30'}
                      onValueChange={(value) => updateConfig.mutate({ eodReminderTime: value + ':00' })}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="17:00">5:00 PM</SelectItem>
                        <SelectItem value="17:30">5:30 PM</SelectItem>
                        <SelectItem value="18:00">6:00 PM</SelectItem>
                        <SelectItem value="18:30">6:30 PM</SelectItem>
                        <SelectItem value="19:00">7:00 PM</SelectItem>
                        <SelectItem value="19:30">7:30 PM</SelectItem>
                        <SelectItem value="20:00">8:00 PM</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Reminder banner if not checked in by this time
                    </p>
                  </div>
                  
                  {/* Morning Confirm Time */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="flex items-center gap-2">
                        <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                        Morning Confirmation Time
                      </Label>
                    </div>
                    <Select
                      value={config?.morningConfirmTime?.slice(0, 5) || '08:00'}
                      onValueChange={(value) => updateConfig.mutate({ morningConfirmTime: value + ':00' })}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="06:00">6:00 AM</SelectItem>
                        <SelectItem value="06:30">6:30 AM</SelectItem>
                        <SelectItem value="07:00">7:00 AM</SelectItem>
                        <SelectItem value="07:30">7:30 AM</SelectItem>
                        <SelectItem value="08:00">8:00 AM</SelectItem>
                        <SelectItem value="08:30">8:30 AM</SelectItem>
                        <SelectItem value="09:00">9:00 AM</SelectItem>
                        <SelectItem value="09:30">9:30 AM</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      When "Confirm Yesterday" prompt appears
                    </p>
                  </div>
                  
                  {/* Grace Window End Time */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        Late-Night Grace Window
                      </Label>
                    </div>
                    <Select
                      value={config?.graceWindowEndTime?.slice(0, 5) || '02:00'}
                      onValueChange={(value) => updateConfig.mutate({ graceWindowEndTime: value + ':00' })}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="00:00">12:00 AM</SelectItem>
                        <SelectItem value="01:00">1:00 AM</SelectItem>
                        <SelectItem value="02:00">2:00 AM</SelectItem>
                        <SelectItem value="03:00">3:00 AM</SelectItem>
                        <SelectItem value="04:00">4:00 AM</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Check-ins before this time count for the previous day
                    </p>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
          
          {/* Coaching Tab */}
          <TabsContent value="coaching" className="space-y-4">
            <ConversionBenchmarksSettings />
          </TabsContent>
          
           {/* Integrations Tab */}
           <TabsContent value="integrations" className="space-y-4">
             <WhoopIntegration />
             <DaveHealthSection />
           </TabsContent>
          
          {/* Appearance Tab */}
          <TabsContent value="appearance" className="space-y-4">
            <div className="metric-card">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Palette className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Appearance</h3>
                  <p className="text-sm text-muted-foreground">Theme and display settings</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">Coming soon...</p>
            </div>

            {/* Build Info */}
            <div className="metric-card">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <SettingsIcon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Build Info</h3>
                  <p className="text-sm text-muted-foreground">Current app version details</p>
                </div>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-border/50">
                <span className="text-sm text-muted-foreground">Last built</span>
                <span className="text-sm font-mono">{new Date(__BUILD_TIMESTAMP__).toLocaleString()}</span>
              </div>
            </div>
          </TabsContent>
          
          {/* Notifications Tab */}
          <TabsContent value="notifications" className="space-y-4">
            <NotificationSettings />
          </TabsContent>
          
          {/* Data Tab */}
          <TabsContent value="data" className="space-y-4">
            {/* Duplicate Detection */}
            <DuplicateDetector />
            
            {/* Import Section */}
            <DataImportSection />
            
            {/* Import Mappings Section */}
            <ImportMappingsSection />
            
            {/* Export Section */}
            <DataExportSection />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
