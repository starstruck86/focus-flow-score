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
import { Badge } from '@/components/ui/badge';
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
import type { QuotaConfig, Opportunity, OpportunityStatus, OpportunityStage, ChurnRisk, DealType } from '@/types';
import { DollarSign, Target, FileText, Settings2, AlertTriangle } from 'lucide-react';
import { useDbOpportunities, type DbOpportunity } from '@/hooks/useAccountsData';

// Normalize status based on stage (e.g., stage="Closed Won" but status="active")
function normalizeOppStatus(status: OpportunityStatus, stage: OpportunityStage): OpportunityStatus {
  if (stage === 'Closed Won' && status !== 'closed-won') return 'closed-won';
  if (stage === 'Closed Lost' && status !== 'closed-lost') return 'closed-lost';
  // Also handle stage values with prefixes like "6 - Closed Won"
  if (typeof stage === 'string' && stage.includes('Closed Won') && status !== 'closed-won') return 'closed-won';
  if (typeof stage === 'string' && stage.includes('Closed Lost') && status !== 'closed-lost') return 'closed-lost';
  return status;
}

// Transform DB opportunity to UI format for commission calculations
function dbToUiOpportunity(db: DbOpportunity): Opportunity {
  const rawStatus = (db.status as OpportunityStatus) || 'active';
  const stage = (db.stage as OpportunityStage) || '';
  return {
    id: db.id,
    name: db.name,
    accountId: db.account_id ?? undefined,
    salesforceLink: db.salesforce_link ?? undefined,
    salesforceId: db.salesforce_id ?? undefined,
    linkedContactIds: [],
    status: normalizeOppStatus(rawStatus, stage),
    stage,
    arr: db.arr ?? undefined,
    churnRisk: (db.churn_risk as ChurnRisk) ?? undefined,
    closeDate: db.close_date ?? undefined,
    nextStep: db.next_step ?? undefined,
    nextStepDate: db.next_step_date ?? undefined,
    lastTouchDate: db.last_touch_date ?? undefined,
    notes: db.notes ?? undefined,
    activityLog: (db.activity_log as any[]) || [],
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    dealType: (db.deal_type as DealType) ?? undefined,
    paymentTerms: db.payment_terms as any,
    termMonths: db.term_months ?? undefined,
    priorContractArr: db.prior_contract_arr ?? undefined,
    renewalArr: db.renewal_arr ?? undefined,
    oneTimeAmount: db.one_time_amount ?? undefined,
    isNewLogo: db.is_new_logo ?? undefined,
    accountName: undefined,
  };
}

type TimeView = 'ytd' | 'qtd' | 'mtd';

export default function Quota() {
  // Use DB hooks for opportunities (source of truth)
  const { data: dbOpportunities = [] } = useDbOpportunities();
  const dbOpps = useMemo(() => dbOpportunities.map(dbToUiOpportunity), [dbOpportunities]);
  
  // Also merge any Zustand-only opportunities (for backward compat) — normalize status there too
  const { opportunities: rawStoreOpps, quotaConfig, setQuotaConfig } = useStore();
  const storeOpps = useMemo(() => rawStoreOpps.map(o => ({
    ...o,
    status: normalizeOppStatus(o.status, o.stage),
  })), [rawStoreOpps]);
  
  // Combine: prefer DB opps, fall back to store opps not in DB
  const opportunities = useMemo(() => {
    const dbIds = new Set(dbOpps.map(o => o.id));
    const storeOnly = storeOpps.filter(o => !dbIds.has(o.id));
    return [...dbOpps, ...storeOnly];
  }, [dbOpps, storeOpps]);
  
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
  
  // "Needs Review" - closed-won opps missing required fields
  const needsReviewDeals = useMemo(() => {
    const closedWon = opportunities.filter(o => o.status === 'closed-won');
    return closedWon.filter(o => {
      const missingFields: string[] = [];
      if (!o.closeDate) missingFields.push('Close Date');
      if (!o.arr && !o.renewalArr && !o.oneTimeAmount) missingFields.push('ARR');
      if (!o.dealType) missingFields.push('Deal Type');
      return missingFields.length > 0;
    }).map(o => {
      const missing: string[] = [];
      if (!o.closeDate) missing.push('Close Date');
      if (!o.arr && !o.renewalArr && !o.oneTimeAmount) missing.push('ARR');
      if (!o.dealType) missing.push('Deal Type');
      return { ...o, missingFields: missing };
    });
  }, [opportunities]);
  
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
  
  // All closed won count for header
  const closedWonCount = opportunities.filter(o => o.status === 'closed-won').length;
  
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
              {closedWonCount} closed-won deal{closedWonCount !== 1 ? 's' : ''} • {needsReviewDeals.length > 0 && (
                <span className="text-status-yellow">{needsReviewDeals.length} need review</span>
              )}
              {needsReviewDeals.length === 0 && 'Tracking attainment and estimated commission'}
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
            {/* Needs Review Banner */}
            {needsReviewDeals.length > 0 && (
              <div className="rounded-lg border border-status-yellow/30 bg-status-yellow/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-status-yellow" />
                  <h3 className="text-sm font-medium text-status-yellow">Needs Review</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  These closed-won deals are missing required fields for commission calculation:
                </p>
                <div className="space-y-1.5">
                  {needsReviewDeals.map(deal => (
                    <div key={deal.id} className="flex items-center justify-between text-sm px-2 py-1 rounded bg-muted/30">
                      <span className="font-medium">{deal.name}</span>
                      <div className="flex gap-1">
                        {deal.missingFields.map(f => (
                          <Badge key={f} variant="outline" className="text-[10px] border-status-yellow/30 text-status-yellow">
                            {f}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
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
              
              {/* Needs Review in ledger */}
              {needsReviewDeals.length > 0 && (
                <div className="rounded-lg border border-status-yellow/30 bg-status-yellow/5 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-status-yellow" />
                    <span className="text-xs font-medium text-status-yellow">
                      {needsReviewDeals.length} deal{needsReviewDeals.length !== 1 ? 's' : ''} need review before they can count toward quota
                    </span>
                  </div>
                  {needsReviewDeals.map(deal => (
                    <div key={deal.id} className="text-xs text-muted-foreground ml-5">
                      <span className="font-medium text-foreground">{deal.name}</span> — missing: {deal.missingFields.join(', ')}
                    </div>
                  ))}
                </div>
              )}
              
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
