// Quota & Commission Page - Single Source of Truth from Closed Won Opportunities
import { useState, useMemo } from 'react';
import { Layout } from '@/components/Layout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { useStore } from '@/store/useStore';
import { QuotaGauge } from '@/components/quota/QuotaGauge';
import { CommissionCard } from '@/components/quota/CommissionCard';
import { RemainingCard } from '@/components/quota/RemainingCard';
import { DealsLedger } from '@/components/quota/DealsLedger';
import { QuotaConfigSettings } from '@/components/quota/QuotaConfigSettings';
import { 
  DEFAULT_QUOTA_CONFIG, 
  calculateCommissionSummary,
  calculateRequiredWeeklyRate,
  generateLedgerEntries,
  formatCurrency,
} from '@/lib/commissionCalculations';
import type { QuotaConfig } from '@/types';
import { DollarSign, Target, FileText, Settings2 } from 'lucide-react';

type TimeView = 'ytd' | 'qtd' | 'mtd';

export default function Quota() {
  const { opportunities, quotaConfig, setQuotaConfig } = useStore();
  const config = quotaConfig || DEFAULT_QUOTA_CONFIG;
  const [timeView, setTimeView] = useState<TimeView>('ytd');
  
  // Calculate date filter based on time view
  const dateFilter = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const quarter = Math.floor(month / 3);
    
    switch (timeView) {
      case 'mtd':
        return {
          start: `${year}-${String(month + 1).padStart(2, '0')}-01`,
          end: now.toISOString().split('T')[0],
        };
      case 'qtd':
        const quarterStart = quarter * 3;
        return {
          start: `${year}-${String(quarterStart + 1).padStart(2, '0')}-01`,
          end: now.toISOString().split('T')[0],
        };
      case 'ytd':
      default:
        return {
          start: config.fiscalYearStart,
          end: now.toISOString().split('T')[0],
        };
    }
  }, [timeView, config.fiscalYearStart]);
  
  // Calculate commission summary
  const summary = useMemo(() => {
    return calculateCommissionSummary(opportunities, config, dateFilter);
  }, [opportunities, config, dateFilter]);
  
  // Generate ledger entries for display
  const ledgerEntries = useMemo(() => {
    const closedWon = opportunities.filter(o => o.status === 'closed-won');
    const filtered = closedWon.filter(o => {
      if (!o.closeDate) return false;
      return o.closeDate >= dateFilter.start && o.closeDate <= dateFilter.end;
    });
    return filtered.flatMap(o => generateLedgerEntries(o, config));
  }, [opportunities, config, dateFilter]);
  
  // Calculate weekly rate needed
  const weeklyRateNeeded = useMemo(() => {
    return calculateRequiredWeeklyRate(
      summary.remainingToHundred,
      config.fiscalYearEnd
    );
  }, [summary.remainingToHundred, config.fiscalYearEnd]);
  
  const handleConfigSave = (newConfig: QuotaConfig) => {
    setQuotaConfig(newConfig);
  };
  
  // Combined attainment for header
  const combinedAttainment = (summary.newArrBooked + summary.renewalArrBooked) / 
    (config.newArrQuota + config.renewalArrQuota);
  
  return (
    <Layout>
      <div className="p-6 lg:p-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold flex items-center gap-2">
              <DollarSign className="h-6 w-6 text-status-green" />
              Quota & Compensation
            </h1>
            <p className="text-sm text-muted-foreground">
              Tracking attainment and estimated commission from closed-won deals
            </p>
          </div>
          
          {/* Time View Toggle */}
          <Select value={timeView} onValueChange={(v) => setTimeView(v as TimeView)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mtd">MTD</SelectItem>
              <SelectItem value="qtd">QTD</SelectItem>
              <SelectItem value="ytd">YTD (2H)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {/* Tabs */}
        <Tabs defaultValue="dashboard" className="space-y-6">
          <TabsList>
            <TabsTrigger value="dashboard" className="gap-1.5">
              <Target className="h-4 w-4" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="ledger" className="gap-1.5">
              <FileText className="h-4 w-4" />
              Deals Ledger
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5">
              <Settings2 className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>
          
          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6">
            {/* Attainment Gauges */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <QuotaGauge
                title="New ARR"
                booked={summary.newArrBooked}
                quota={summary.newArrQuota}
                attainment={summary.newArrAttainment}
                color="green"
              />
              <QuotaGauge
                title="Renewal ARR"
                booked={summary.renewalArrBooked}
                quota={summary.renewalArrQuota}
                attainment={summary.renewalArrAttainment}
                color="blue"
              />
              <div className="metric-card p-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">One-Time (Non-Quota)</h3>
                <div className="text-xl font-bold">{formatCurrency(summary.oneTimeBooked)}</div>
                <div className="text-sm text-status-green mt-1">
                  +{formatCurrency(summary.oneTimeCommission)} commission @ 3%
                </div>
              </div>
            </div>
            
            {/* Commission + Remaining Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CommissionCard
                totalCommission={summary.totalCommission}
                newArrBase={summary.newArrBaseCommission}
                newArrAccelerator={summary.newArrAcceleratorBonus}
                renewalArrBase={summary.renewalArrBaseCommission}
                renewalArrAccelerator={summary.renewalArrAcceleratorBonus}
                oneTimeCommission={summary.oneTimeCommission}
              />
              <RemainingCard
                newArrRemaining={summary.newArrRemainingToHundred}
                renewalArrRemaining={summary.renewalArrRemainingToHundred}
                weeklyRateNeeded={weeklyRateNeeded}
                endDate={config.fiscalYearEnd}
              />
            </div>
            
            {/* Quick Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="metric-card p-4 text-center">
                <div className="text-2xl font-bold text-primary">
                  {ledgerEntries.filter(e => e.ledgerType === 'new-arr').length}
                </div>
                <div className="text-xs text-muted-foreground">New ARR Deals</div>
              </div>
              <div className="metric-card p-4 text-center">
                <div className="text-2xl font-bold text-primary">
                  {ledgerEntries.filter(e => e.ledgerType === 'renewal-arr').length}
                </div>
                <div className="text-xs text-muted-foreground">Renewal Deals</div>
              </div>
              <div className="metric-card p-4 text-center">
                <div className="text-2xl font-bold text-primary">
                  {ledgerEntries.filter(e => e.isMultiYear).length}
                </div>
                <div className="text-xs text-muted-foreground">Multi-Year Deals</div>
              </div>
              <div className="metric-card p-4 text-center">
                <div className="text-2xl font-bold text-primary">
                  {ledgerEntries.filter(e => e.isNewLogo).length}
                </div>
                <div className="text-xs text-muted-foreground">New Logos</div>
              </div>
            </div>
          </TabsContent>
          
          {/* Deals Ledger Tab */}
          <TabsContent value="ledger">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Closed Won Deals</h2>
                <div className="text-sm text-muted-foreground">
                  {ledgerEntries.length} ledger entries from {opportunities.filter(o => o.status === 'closed-won').length} deals
                </div>
              </div>
              <DealsLedger entries={ledgerEntries} />
            </div>
          </TabsContent>
          
          {/* Settings Tab */}
          <TabsContent value="settings">
            <div className="max-w-2xl space-y-6">
              <QuotaConfigSettings config={config} onSave={handleConfigSave} />
              
              {/* Accelerator Tiers Info */}
              <div className="metric-card p-4">
                <h3 className="font-medium mb-3">Overachievement Accelerators</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">0% – 100%</span>
                    <span>No accelerator (base ACR)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">100% – 125%</span>
                    <span className="text-status-yellow">1.5x ACR</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">125% – 150%</span>
                    <span className="text-status-yellow">1.7x ACR</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">150%+</span>
                    <span className="text-status-yellow">2.0x ACR</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Accelerators apply only to overachievement dollars, not retroactively.
                </p>
              </div>
              
              {/* Kickers Info */}
              <div className="metric-card p-4">
                <h3 className="font-medium mb-3">Deal Attribute Kickers (Cumulative)</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">New Logo</span>
                    <span className="text-status-green">+3% (New ARR)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Annual Payment Terms</span>
                    <span className="text-status-green">+2% (New ARR)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Multi-Year (24+ months)</span>
                    <span className="text-status-green">+1% (New ARR)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Multi-Year Renewal</span>
                    <span className="text-status-green">Lesser of +2% and 2.0x ACR</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">One-Time</span>
                    <span>3% flat (no quota retirement)</span>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
