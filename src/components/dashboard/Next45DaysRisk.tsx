// Next 45 Days Risk Window - Opportunities + Renewals tables
import { motion } from 'framer-motion';
import { AlertTriangle, Calendar, ExternalLink, FileText, Link2 } from 'lucide-react';
import { format, differenceInDays, parseISO, addDays, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import { isWarningEligible } from '@/lib/warningEligibility';
import { ClickableName } from '@/components/ClickableName';
import { formatCurrency } from '@/lib/commissionCalculations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Opportunity, Renewal } from '@/types';

interface Next45DaysRiskProps {
  opportunities: Opportunity[];
  renewals: Renewal[];
}

function parseIsoDateSafe(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

function RiskBadges({ 
  missingNextStep, 
  stalled, 
  closingSoon,
  missingPlanhat,
  missingAgreement,
}: { 
  missingNextStep?: boolean;
  stalled?: boolean;
  closingSoon?: boolean;
  missingPlanhat?: boolean;
  missingAgreement?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {closingSoon && (
        <Badge variant="destructive" className="text-xs">
          <Calendar className="h-3 w-3 mr-1" />
          &lt;14 days
        </Badge>
      )}
      {stalled && (
        <Badge variant="outline" className="text-xs text-status-yellow border-status-yellow">
          Stalled
        </Badge>
      )}
      {missingNextStep && (
        <Badge variant="outline" className="text-xs text-status-red border-status-red">
          No Next Step
        </Badge>
      )}
      {missingPlanhat && (
        <Badge variant="outline" className="text-xs text-muted-foreground">
          No Planhat
        </Badge>
      )}
      {missingAgreement && (
        <Badge variant="outline" className="text-xs text-muted-foreground">
          No Agreement
        </Badge>
      )}
    </div>
  );
}

function OpportunitiesTable({ opportunities }: { opportunities: Opportunity[] }) {
  const today = new Date();
  const fortyFiveDaysFromNow = addDays(today, 45);
  
  // Filter to next 45 days, exclude closed
  const filtered = opportunities
    .filter(o => 
      o.status !== 'closed-won' && 
      isWarningEligible({ status: o.status }) &&
      o.closeDate
    )
    .filter(o => {
      const closeDate = parseIsoDateSafe(o.closeDate);
      return closeDate ? closeDate <= fortyFiveDaysFromNow && closeDate >= today : false;
    })
    .sort((a, b) => {
      // Sort by close date, then ARR
      const aClose = parseIsoDateSafe(a.closeDate);
      const bClose = parseIsoDateSafe(b.closeDate);

      if (aClose && bClose && aClose.getTime() !== bClose.getTime()) {
        return aClose.getTime() - bClose.getTime();
      }

      return (b.arr || 0) - (a.arr || 0);
    });

  if (filtered.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No opportunities closing in the next 45 days</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Opportunity</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">ARR</TableHead>
            <TableHead>Close Date</TableHead>
            <TableHead>Next Step</TableHead>
            <TableHead>Risk Flags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map(opp => {
            const closeDate = parseIsoDateSafe(opp.closeDate);
            if (!closeDate) return null;

            const daysUntil = differenceInDays(closeDate, today);
            const closingSoon = daysUntil <= 14;
            const stalled = opp.status === 'stalled';
            const missingNextStep = !opp.nextStep;
            
            return (
              <TableRow key={opp.id}>
                <TableCell>
                  <ClickableName
                    name={opp.name}
                    salesforceLink={opp.salesforceLink}
                  />
                </TableCell>
                <TableCell>
                  <ClickableName
                    name={opp.accountName || '-'}
                    salesforceLink={undefined} // Would need account SF link
                  />
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">
                    {opp.stage || '-'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className={cn(
                    "text-xs",
                    opp.status === 'active' && 'text-status-green',
                    opp.status === 'stalled' && 'text-status-yellow',
                  )}>
                    {opp.status}
                  </span>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {opp.arr ? formatCurrency(opp.arr) : '-'}
                </TableCell>
                <TableCell>
                  <span className={cn(
                    closingSoon && 'text-status-red font-medium'
                  )}>
                    {format(closeDate, 'MMM d')}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({daysUntil}d)
                  </span>
                </TableCell>
                <TableCell className="max-w-[200px]">
                  {opp.nextStep ? (
                    <div className="text-xs truncate">
                      {(() => {
                        const nextStepDate = parseIsoDateSafe(opp.nextStepDate);
                        return nextStepDate ? (
                          <span className="text-muted-foreground">
                            {format(nextStepDate, 'M/d')}: 
                          </span>
                        ) : null;
                      })()}
                      {opp.nextStep}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <RiskBadges 
                    closingSoon={closingSoon}
                    stalled={stalled}
                    missingNextStep={missingNextStep}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function RenewalsTable({ renewals }: { renewals: Renewal[] }) {
  const today = new Date();
  const fortyFiveDaysFromNow = addDays(today, 45);
  
  // Filter to next 45 days
  const filtered = renewals
    .filter(r => {
      const renewalDate = parseIsoDateSafe(r.renewalDue);
      return renewalDate ? renewalDate <= fortyFiveDaysFromNow && renewalDate >= today : false;
    })
    .sort((a, b) => {
      // Sort by renewal date, then ARR
      const aRenewal = parseIsoDateSafe(a.renewalDue);
      const bRenewal = parseIsoDateSafe(b.renewalDue);

      if (aRenewal && bRenewal && aRenewal.getTime() !== bRenewal.getTime()) {
        return aRenewal.getTime() - bRenewal.getTime();
      }

      return b.arr - a.arr;
    });

  if (filtered.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No renewals due in the next 45 days</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead>Renewal Date</TableHead>
            <TableHead className="text-right">ARR</TableHead>
            <TableHead>Planhat</TableHead>
            <TableHead>Agreement</TableHead>
            <TableHead>Next Step</TableHead>
            <TableHead>CS Notes</TableHead>
            <TableHead>Risk Flags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map(renewal => {
            const renewalDate = parseIsoDateSafe(renewal.renewalDue);
            if (!renewalDate) return null;

            const daysUntil = differenceInDays(renewalDate, today);
            const closingSoon = daysUntil <= 14;
            const missingPlanhat = !renewal.planhatLink;
            const missingAgreement = !renewal.currentAgreementLink;
            const missingNextStep = !renewal.nextStep;
            
            return (
              <TableRow key={renewal.id}>
                <TableCell>
                  <ClickableName
                    name={renewal.accountName}
                    salesforceLink={undefined} // Would need account SF link
                  />
                </TableCell>
                <TableCell>
                  <span className={cn(
                    closingSoon && 'text-status-red font-medium'
                  )}>
                    {format(renewalDate, 'MMM d')}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({daysUntil}d)
                  </span>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(renewal.arr)}
                </TableCell>
                <TableCell>
                  {renewal.planhatLink ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs gap-1"
                      onClick={() => window.open(renewal.planhatLink, '_blank')}
                    >
                      <Link2 className="h-3 w-3" />
                      Planhat
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  {renewal.currentAgreementLink ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs gap-1"
                      onClick={() => window.open(renewal.currentAgreementLink, '_blank')}
                    >
                      <FileText className="h-3 w-3" />
                      Agreement
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="max-w-[150px]">
                  {renewal.nextStep ? (
                    <div className="text-xs truncate">{renewal.nextStep}</div>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="max-w-[150px]">
                  {renewal.csNotes ? (
                    <div className="text-xs truncate">{renewal.csNotes}</div>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <RiskBadges 
                    closingSoon={closingSoon}
                    missingNextStep={missingNextStep}
                    missingPlanhat={missingPlanhat}
                    missingAgreement={missingAgreement}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function Next45DaysRisk({ opportunities, renewals }: Next45DaysRiskProps) {
  const today = new Date();
  const fortyFiveDaysFromNow = addDays(today, 45);
  
  const oppsCount = opportunities.filter(o => {
    if (o.status === 'closed-won' || !isWarningEligible({ status: o.status })) return false;
    const closeDate = parseIsoDateSafe(o.closeDate);
    return closeDate ? closeDate <= fortyFiveDaysFromNow && closeDate >= today : false;
  }).length;
  
  const renewalsCount = renewals.filter(r => {
    const renewalDate = parseIsoDateSafe(r.renewalDue);
    return renewalDate ? renewalDate <= fortyFiveDaysFromNow && renewalDate >= today : false;
  }).length;

  return (
    <motion.div 
      className="metric-card p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
    >
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="h-5 w-5 text-status-yellow" />
        <h3 className="font-display font-semibold">Next 45 Days Risk Window</h3>
      </div>
      
      <Tabs defaultValue="opportunities">
        <TabsList className="mb-4">
          <TabsTrigger value="opportunities" className="gap-1.5">
            Opportunities
            {oppsCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                {oppsCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="renewals" className="gap-1.5">
            Renewals
            {renewalsCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                {renewalsCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="opportunities">
          <OpportunitiesTable opportunities={opportunities} />
        </TabsContent>
        
        <TabsContent value="renewals">
          <RenewalsTable renewals={renewals} />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
