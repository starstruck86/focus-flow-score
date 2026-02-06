import { useState } from 'react';
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
  Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
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
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

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
          <TabsList>
            <TabsTrigger value="schedule">Work Schedule</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
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
          </TabsContent>
          
          {/* Data Tab */}
          <TabsContent value="data" className="space-y-4">
            <div className="metric-card">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Database className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Data</h3>
                  <p className="text-sm text-muted-foreground">Export and backup options</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Your data is stored in the cloud. Export features coming soon.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
