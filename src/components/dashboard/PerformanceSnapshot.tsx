// Performance Snapshot - WTD/MTD rollups from check-ins
import { motion } from 'framer-motion';
import { BarChart3, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface RollupData {
  dials: number;
  conversations: number;
  meetingsSet: number;
  customerMeetingsHeld: number;
  oppsCreated: number;
  accountsResearched: number;
  contactsPrepped: number;
}

interface PerformanceSnapshotProps {
  wtd: RollupData;
  mtd: RollupData;
  wtdDays: number;
  mtdDays: number;
  targets: {
    dialsPerDay: number;
    connectsPerDay: number;
    meetingsPerWeek: number;
    oppsPerWeek: number;
    customerMeetingsPerWeek: number;
    accountsResearchedPerDay: number;
    contactsPreppedPerDay: number;
  };
  isLoading?: boolean;
}

interface MetricRowProps {
  label: string;
  value: number;
  target: number;
  days: number;
  isWeekly?: boolean;
}

function MetricRow({ label, value, target, days, isWeekly }: MetricRowProps) {
  const expectedValue = isWeekly 
    ? target 
    : target * days;
  
  const ratio = expectedValue > 0 ? value / expectedValue : value > 0 ? 1.5 : 0;
  const status = ratio >= 1.0 ? 'ahead' : ratio >= 0.8 ? 'on-track' : 'behind';
  
  const StatusIcon = status === 'ahead' 
    ? TrendingUp 
    : status === 'behind' 
      ? TrendingDown 
      : Minus;
  
  const statusColors = {
    ahead: 'text-status-green',
    'on-track': 'text-status-yellow',
    behind: 'text-status-red',
  };

  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <span className="font-medium tabular-nums">{value}</span>
        <span className="text-xs text-muted-foreground">/ {Math.round(expectedValue)}</span>
        <StatusIcon className={cn("h-4 w-4", statusColors[status])} />
      </div>
    </div>
  );
}

function RollupContent({ 
  data, 
  days, 
  targets 
}: { 
  data: RollupData; 
  days: number;
  targets: PerformanceSnapshotProps['targets'];
}) {
  return (
    <div className="space-y-1">
      <MetricRow 
        label="Dials" 
        value={data.dials} 
        target={targets.dialsPerDay} 
        days={days}
      />
      <MetricRow 
        label="Connects" 
        value={data.conversations} 
        target={targets.connectsPerDay} 
        days={days}
      />
      <MetricRow 
        label="Meetings Set" 
        value={data.meetingsSet} 
        target={targets.meetingsPerWeek} 
        days={days}
        isWeekly
      />
      <MetricRow 
        label="Customer Meetings" 
        value={data.customerMeetingsHeld} 
        target={targets.customerMeetingsPerWeek} 
        days={days}
        isWeekly
      />
      <MetricRow 
        label="Opps Created" 
        value={data.oppsCreated} 
        target={targets.oppsPerWeek} 
        days={days}
        isWeekly
      />
      <MetricRow 
        label="Accounts Researched" 
        value={data.accountsResearched} 
        target={targets.accountsResearchedPerDay} 
        days={days}
      />
      <MetricRow 
        label="Contacts Prepped" 
        value={data.contactsPrepped} 
        target={targets.contactsPreppedPerDay} 
        days={days}
      />
    </div>
  );
}

export function PerformanceSnapshot({ 
  wtd, 
  mtd, 
  wtdDays, 
  mtdDays, 
  targets,
  isLoading 
}: PerformanceSnapshotProps) {
  if (isLoading) {
    return (
      <motion.div 
        className="metric-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h3 className="font-display font-semibold">Performance Snapshot</h3>
        </div>
        <div className="animate-pulse space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-8 bg-muted rounded" />
          ))}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      className="metric-card p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
    >
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h3 className="font-display font-semibold">Performance Snapshot</h3>
      </div>
      
      <Tabs defaultValue="wtd">
        <TabsList className="mb-4">
          <TabsTrigger value="wtd">
            WTD
            <span className="text-xs text-muted-foreground ml-1">({wtdDays}d)</span>
          </TabsTrigger>
          <TabsTrigger value="mtd">
            MTD
            <span className="text-xs text-muted-foreground ml-1">({mtdDays}d)</span>
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="wtd">
          <RollupContent data={wtd} days={wtdDays || 1} targets={targets} />
        </TabsContent>
        
        <TabsContent value="mtd">
          <RollupContent data={mtd} days={mtdDays || 1} targets={targets} />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
