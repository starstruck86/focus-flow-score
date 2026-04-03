// Quota & Commission Page - Single Source of Truth from Closed Won Opportunities
import { useState, useMemo, useCallback } from 'react';
import { Reorder, AnimatePresence, motion } from 'framer-motion';
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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/store/useStore';
import { QuotaGauge } from '@/components/quota/QuotaGauge';
import { CommissionCard } from '@/components/quota/CommissionCard';
import { RemainingCard } from '@/components/quota/RemainingCard';
import { DealsLedger } from '@/components/quota/DealsLedger';
import { QuotaConfigSettings } from '@/components/quota/QuotaConfigSettings';
import { EditableDatePicker } from '@/components/EditableDatePicker';
import { DisplaySelectCell } from '@/components/table/DisplaySelectCell';
import { 
  DEFAULT_QUOTA_CONFIG, 
  calculateCommissionSummary,
  calculateRequiredWeeklyRate,
  generateLedgerEntries,
  formatCurrency,
} from '@/lib/commissionCalculations';
import type { QuotaConfig, Opportunity, OpportunityStatus, OpportunityStage, ChurnRisk, DealType } from '@/types';
import { DollarSign, Target, FileText, Settings2, AlertTriangle, Pencil, ChevronDown, GripVertical } from 'lucide-react';
import { useDbOpportunities, useUpdateOpportunity, type DbOpportunity } from '@/hooks/useAccountsData';
import { toast } from 'sonner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { WidgetErrorBoundary } from '@/components/dashboard/WidgetErrorBoundary';
import {
  PipelineHygieneCard,
  QuotaScenarioSimulator,
  UnifiedPipeline,
  PaceToQuotaCard,
  PerformanceSnapshot,
  CommissionSnapshot,
  Next45DaysRisk,
  QuotaAccelerationCard,
} from '@/components/dashboard';
import { usePaceToQuota, usePerformanceRollups, useQuotaTargets } from '@/hooks/useSalesAge';
import { DEFAULT_QUOTA_TARGETS } from '@/lib/salesAgeCalculations';
import { useWidgetLayout, type WidgetConfig } from '@/hooks/useWidgetLayout';
import { WidgetCustomizer } from '@/components/dashboard/WidgetCustomizer';

// Default widget config for the Quota Dashboard tab
const QUOTA_WIDGETS: WidgetConfig[] = [
  { id: 'attainment-gauges', label: 'Attainment Gauges', visible: true, order: 0 },
  { id: 'commission-remaining', label: 'Commission + Remaining', visible: true, order: 1 },
  { id: 'quota-acceleration', label: 'Close the Gap', visible: true, order: 2 },
  { id: 'quick-stats', label: 'Quick Stats', visible: true, order: 3 },
  { id: 'strategic-planning', label: 'Strategic Planning', visible: true, order: 4 },
];

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
  const [strategicOpen, setStrategicOpen] = useState(true);
  const quotaLayout = useWidgetLayout('quota-dashboard', QUOTA_WIDGETS);
  // Use DB hooks for opportunities (source of truth)
  const { data: dbOpportunities = [] } = useDbOpportunities();
  const dbOpps = useMemo(() => dbOpportunities.map(dbToUiOpportunity), [dbOpportunities]);
  
  // Also merge any Zustand-only opportunities (for backward compat) — normalize status there too
  const { opportunities: rawStoreOpps, renewals, quotaConfig, setQuotaConfig } = useStore();
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
  const [fixingDeal, setFixingDeal] = useState<(Opportunity & { missingFields: string[] }) | null>(null);
  const updateOpportunityMutation = useUpdateOpportunity();
  const paceToQuota = usePaceToQuota();
  const { data: quotaTargets } = useQuotaTargets();
  const { data: performanceRollups, isLoading: rollupsLoading } = usePerformanceRollups();
  const effectiveTargets = quotaTargets || DEFAULT_QUOTA_TARGETS;
  const performanceTargets = {
    dialsPerDay: effectiveTargets.targetDialsPerDay,
    connectsPerDay: effectiveTargets.targetConnectsPerDay,
    meetingsPerWeek: effectiveTargets.targetMeetingsSetPerWeek,
    oppsPerWeek: effectiveTargets.targetOppsCreatedPerWeek,
    customerMeetingsPerWeek: effectiveTargets.targetCustomerMeetingsPerWeek,
    accountsResearchedPerDay: effectiveTargets.targetAccountsResearchedPerDay,
    contactsPreppedPerDay: effectiveTargets.targetContactsPreppedPerDay,
  };
  const totalQuota = (effectiveTargets.newArrQuota || 0) + (effectiveTargets.renewalArrQuota || 0);
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

  const combinedAttainment = totalQuota > 0
    ? (summary.newArrBooked + summary.renewalArrBooked) / totalQuota
    : 0;

  
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

  // Widget renderer for Quota dashboard
  const renderQuotaWidget = useCallback((widgetId: string) => {
    switch (widgetId) {
      case 'attainment-gauges':
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <QuotaGauge title="New ARR" booked={summary.newArrBooked} quota={summary.newArrQuota} attainment={summary.newArrAttainment} color="green" />
            <QuotaGauge title="Renewal ARR" booked={summary.renewalArrBooked} quota={summary.renewalArrQuota} attainment={summary.renewalArrAttainment} color="blue" />
            <div className="metric-card p-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">One-Time (Non-Quota)</h3>
              <div className="text-xl font-bold">{formatCurrency(summary.oneTimeBooked)}</div>
              <div className="text-sm text-status-green mt-1">+{formatCurrency(summary.oneTimeCommission)} commission @ 3%</div>
            </div>
          </div>
        );
      case 'commission-remaining':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CommissionCard totalCommission={summary.totalCommission} newArrBase={summary.newArrBaseCommission} newArrAccelerator={summary.newArrAcceleratorBonus} renewalArrBase={summary.renewalArrBaseCommission} renewalArrAccelerator={summary.renewalArrAcceleratorBonus} oneTimeCommission={summary.oneTimeCommission} />
            <RemainingCard newArrRemaining={summary.newArrRemainingToHundred} renewalArrRemaining={summary.renewalArrRemainingToHundred} weeklyRateNeeded={weeklyRateNeeded} endDate={config.fiscalYearEnd} />
          </div>
        );
      case 'quick-stats':
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="metric-card p-4 text-center"><div className="text-2xl font-bold text-primary">{ledgerEntries.filter(e => e.ledgerType === 'new-arr').length}</div><div className="text-xs text-muted-foreground">New ARR Deals</div></div>
            <div className="metric-card p-4 text-center"><div className="text-2xl font-bold text-primary">{ledgerEntries.filter(e => e.ledgerType === 'renewal-arr').length}</div><div className="text-xs text-muted-foreground">Renewal Deals</div></div>
            <div className="metric-card p-4 text-center"><div className="text-2xl font-bold text-primary">{ledgerEntries.filter(e => e.isMultiYear).length}</div><div className="text-xs text-muted-foreground">Multi-Year Deals</div></div>
            <div className="metric-card p-4 text-center"><div className="text-2xl font-bold text-primary">{ledgerEntries.filter(e => e.isNewLogo).length}</div><div className="text-xs text-muted-foreground">New Logos</div></div>
          </div>
        );
      case 'quota-acceleration':
        return <QuotaAccelerationCard />;
      case 'strategic-planning':
        return (
          <Collapsible open={strategicOpen} onOpenChange={setStrategicOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-3 group">
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", strategicOpen && "rotate-180")} />
              <span className="font-display text-sm font-semibold text-muted-foreground group-hover:text-foreground transition-colors">Strategic Planning & Pipeline Analysis</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-6 pt-2">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <WidgetErrorBoundary widgetId="pace-to-quota"><PaceToQuotaCard paceToQuota={paceToQuota} /></WidgetErrorBoundary>
                <WidgetErrorBoundary widgetId="pipeline-hygiene"><PipelineHygieneCard /></WidgetErrorBoundary>
              </div>
              <WidgetErrorBoundary widgetId="unified-pipeline"><UnifiedPipeline /></WidgetErrorBoundary>
              <WidgetErrorBoundary widgetId="next-45-risk"><Next45DaysRisk opportunities={opportunities} renewals={renewals} /></WidgetErrorBoundary>
              <WidgetErrorBoundary widgetId="scenario-simulator"><QuotaScenarioSimulator /></WidgetErrorBoundary>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <WidgetErrorBoundary widgetId="performance-snapshot">
                  <PerformanceSnapshot wtd={performanceRollups?.wtd || { dials: 0, conversations: 0, meetingsSet: 0, customerMeetingsHeld: 0, oppsCreated: 0, accountsResearched: 0, contactsPrepped: 0 }} mtd={performanceRollups?.mtd || { dials: 0, conversations: 0, meetingsSet: 0, customerMeetingsHeld: 0, oppsCreated: 0, accountsResearched: 0, contactsPrepped: 0 }} wtdDays={performanceRollups?.wtdDays || 0} mtdDays={performanceRollups?.mtdDays || 0} targets={performanceTargets} isLoading={rollupsLoading} />
                </WidgetErrorBoundary>
                <WidgetErrorBoundary widgetId="commission-snapshot">
                  <CommissionSnapshot totalCommission={summary.totalCommission} newArrAttainment={summary.newArrAttainment} renewalArrAttainment={summary.renewalArrAttainment} combinedAttainment={combinedAttainment} projectedImpact={{ additionalNewArr: 50000, additionalCommission: 50000 * config.newArrAcr }} />
                </WidgetErrorBoundary>
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      default:
        return null;
    }
  }, [summary, ledgerEntries, config, weeklyRateNeeded, strategicOpen, paceToQuota, performanceRollups, rollupsLoading, performanceTargets, combinedAttainment, opportunities, renewals]);
  return (
    <Layout>
      <div data-testid="quota-page" className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
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
          <div className="flex items-center justify-between">
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
            <WidgetCustomizer
              widgets={quotaLayout.widgets}
              onToggle={quotaLayout.toggleWidget}
              onMove={quotaLayout.moveWidget}
              onReset={quotaLayout.resetWidgets}
            />
          </div>
          
          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6">
            {/* Needs Review Banner — always on top, not reorderable */}
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
                    <div key={deal.id} className="flex items-center justify-between text-sm px-2 py-1.5 rounded bg-muted/30">
                      <button
                        className="font-medium hover:text-primary hover:underline underline-offset-2 transition-colors text-left"
                        onClick={() => setFixingDeal(deal)}
                      >
                        {deal.name}
                      </button>
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          {deal.missingFields.map(f => (
                            <Badge key={f} variant="outline" className="text-[10px] border-status-yellow/30 text-status-yellow">
                              {f}
                            </Badge>
                          ))}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs gap-1 border-status-yellow/30 text-status-yellow hover:bg-status-yellow/10"
                          onClick={() => setFixingDeal(deal)}
                        >
                          <Pencil className="h-3 w-3" />
                          Fix
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Reorderable Widget Grid */}
            <Reorder.Group
              axis="y"
              values={quotaLayout.visibleWidgetIds}
              onReorder={quotaLayout.reorderVisibleIds}
              className="space-y-6"
            >
              {quotaLayout.visibleWidgets.map((widget) => (
                <Reorder.Item
                  key={widget.id}
                  value={widget.id}
                  className="relative group list-none"
                  whileDrag={{ scale: 1.02, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', zIndex: 50 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                >
                  <div className="absolute -left-3 top-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
                    <div className="bg-muted/80 backdrop-blur-sm rounded-md p-1">
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                  <div className="absolute -right-3 top-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => quotaLayout.collapseWidget(widget.id)}
                      className="bg-muted/80 backdrop-blur-sm rounded-md p-1 hover:bg-muted transition-colors"
                    >
                      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", widget.collapsed && "-rotate-90")} />
                    </button>
                  </div>
                  <AnimatePresence initial={false}>
                    {widget.collapsed ? (
                      <motion.div
                        key="collapsed"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="rounded-lg border border-border/50 bg-card/50 px-4 py-2 cursor-pointer"
                        onClick={() => quotaLayout.collapseWidget(widget.id)}
                      >
                        <span className="text-xs font-medium text-muted-foreground">{widget.label}</span>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="expanded"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                      >
                        <WidgetErrorBoundary widgetId={widget.id}>
                          {renderQuotaWidget(widget.id)}
                        </WidgetErrorBoundary>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Reorder.Item>
              ))}
            </Reorder.Group>
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
                    <div key={deal.id} className="flex items-center justify-between text-xs text-muted-foreground ml-5 py-0.5">
                      <span>
                        <button
                          className="font-medium text-foreground hover:text-primary hover:underline underline-offset-2 transition-colors"
                          onClick={() => setFixingDeal(deal)}
                        >
                          {deal.name}
                        </button>
                        {' '}— missing: {deal.missingFields.join(', ')}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 text-[10px] gap-1 text-status-yellow"
                        onClick={() => setFixingDeal(deal)}
                      >
                        <Pencil className="h-2.5 w-2.5" />
                        Fix
                      </Button>
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

        {/* Fix Deal Dialog */}
        <FixDealDialog
          deal={fixingDeal}
          onClose={() => setFixingDeal(null)}
          onSave={(id, updates) => {
            const dbUpdates: Partial<DbOpportunity> = {};
            if (updates.closeDate !== undefined) dbUpdates.close_date = updates.closeDate || null;
            if (updates.arr !== undefined) dbUpdates.arr = updates.arr;
            if (updates.dealType !== undefined) dbUpdates.deal_type = updates.dealType;
            if (updates.stage !== undefined) dbUpdates.stage = updates.stage;
            if (updates.status !== undefined) dbUpdates.status = updates.status;
            if (updates.priorContractArr !== undefined) dbUpdates.prior_contract_arr = updates.priorContractArr;
            if (updates.renewalArr !== undefined) dbUpdates.renewal_arr = updates.renewalArr;
            if (updates.oneTimeAmount !== undefined) dbUpdates.one_time_amount = updates.oneTimeAmount;
            updateOpportunityMutation.mutate({ id, updates: dbUpdates });
            // Also update store opps for immediate reflection
            const { updateOpportunity: storeUpdate } = useStore.getState();
            storeUpdate(id, updates);
            toast.success('Deal updated — quota recalculating');
            setFixingDeal(null);
          }}
        />
      </div>
    </Layout>
  );
}

// ===== Fix Deal Dialog =====
const DEAL_TYPE_OPTIONS = [
  { value: 'new-logo', label: 'New Logo' },
  { value: 'expansion', label: 'Expansion' },
  { value: 'renewal', label: 'Renewal' },
  { value: 'one-time', label: 'One-Time' },
];

const STAGE_OPTIONS = [
  { value: 'Closed Won', label: '6 - Closed Won' },
  { value: 'Closed Lost', label: '7 - Closed Lost' },
];

function FixDealDialog({
  deal,
  onClose,
  onSave,
}: {
  deal: (Opportunity & { missingFields: string[] }) | null;
  onClose: () => void;
  onSave: (id: string, updates: Partial<Opportunity>) => void;
}) {
  const [closeDate, setCloseDate] = useState('');
  const [arr, setArr] = useState('');
  const [dealType, setDealType] = useState('');
  const [priorContractArr, setPriorContractArr] = useState('');
  const [oneTimeAmount, setOneTimeAmount] = useState('');

  // Reset form when deal changes
  const dealId = deal?.id;
  useState(() => {
    if (deal) {
      setCloseDate(deal.closeDate || '');
      setArr(deal.arr?.toString() || '');
      setDealType(deal.dealType || '');
      setPriorContractArr(deal.priorContractArr?.toString() || '');
      setOneTimeAmount(deal.oneTimeAmount?.toString() || '');
    }
  });

  if (!deal) return null;

  const handleSave = () => {
    const updates: Partial<Opportunity> = {};
    if (closeDate) updates.closeDate = closeDate;
    if (arr) updates.arr = Number(arr);
    if (dealType) updates.dealType = dealType as DealType;
    if (priorContractArr) updates.priorContractArr = Number(priorContractArr);
    if (oneTimeAmount) updates.oneTimeAmount = Number(oneTimeAmount);
    onSave(deal.id, updates);
  };

  return (
    <Dialog open={!!deal} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-status-yellow" />
            Fix: {deal.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex flex-wrap gap-1 mb-2">
            {deal.missingFields.map(f => (
              <Badge key={f} variant="outline" className="text-xs border-status-yellow/30 text-status-yellow">
                Missing: {f}
              </Badge>
            ))}
          </div>

          {deal.missingFields.includes('Close Date') && (
            <div className="space-y-1.5">
              <Label className="text-xs">Close Date</Label>
              <EditableDatePicker
                value={closeDate || undefined}
                onChange={(v) => setCloseDate(v || '')}
                placeholder="Select close date"
              />
            </div>
          )}

          {deal.missingFields.includes('ARR') && (
            <div className="space-y-1.5">
              <Label className="text-xs">ARR</Label>
              <Input
                type="number"
                value={arr}
                onChange={(e) => setArr(e.target.value)}
                placeholder="e.g. 50000"
                className="h-8"
              />
            </div>
          )}

          {deal.missingFields.includes('Deal Type') && (
            <div className="space-y-1.5">
              <Label className="text-xs">Deal Type</Label>
              <Select value={dealType} onValueChange={setDealType}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Select deal type..." />
                </SelectTrigger>
                <SelectContent>
                  {DEAL_TYPE_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Always show these for context */}
          {!deal.missingFields.includes('ARR') && (
            <div className="text-xs text-muted-foreground">
              ARR: {formatCurrency(deal.arr || 0)}
            </div>
          )}
          {!deal.missingFields.includes('Close Date') && deal.closeDate && (
            <div className="text-xs text-muted-foreground">
              Close Date: {deal.closeDate}
            </div>
          )}

          {dealType === 'renewal' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Prior Contract ARR (baseline)</Label>
              <Input
                type="number"
                value={priorContractArr}
                onChange={(e) => setPriorContractArr(e.target.value)}
                placeholder="e.g. 40000"
                className="h-8"
              />
            </div>
          )}

          {dealType === 'one-time' && (
            <div className="space-y-1.5">
              <Label className="text-xs">One-Time Amount</Label>
              <Input
                type="number"
                value={oneTimeAmount}
                onChange={(e) => setOneTimeAmount(e.target.value)}
                placeholder="e.g. 5000"
                className="h-8"
              />
            </div>
          )}
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave}>Save & Recalculate</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
