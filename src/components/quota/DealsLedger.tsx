// Deals Ledger - Auto-generated from Closed Won opportunities
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatPercent } from '@/lib/commissionCalculations';
import type { DealsLedgerEntry } from '@/types';
import { CheckCircle2, Star, Calendar as CalendarIcon } from 'lucide-react';

interface DealsLedgerProps {
  entries: DealsLedgerEntry[];
}

const ledgerTypeLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  'new-arr': { label: 'New ARR', variant: 'default' },
  'renewal-arr': { label: 'Renewal ARR', variant: 'secondary' },
  'one-time': { label: 'One-Time', variant: 'outline' },
};

export function DealsLedger({ entries }: DealsLedgerProps) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-20" />
        <p>No closed-won deals yet.</p>
        <p className="text-sm mt-1">Mark an opportunity as "Closed Won" to see it here.</p>
      </div>
    );
  }
  
  // Sort by close date descending
  const sortedEntries = [...entries].sort((a, b) => 
    b.closeDate.localeCompare(a.closeDate)
  );
  
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Close Date</TableHead>
            <TableHead>Opportunity</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Flags</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">Commission</TableHead>
            <TableHead className="text-right">Quota Credit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedEntries.map((entry) => {
            const typeInfo = ledgerTypeLabels[entry.ledgerType];
            return (
              <TableRow key={entry.id}>
                <TableCell className="text-sm">
                  <div className="flex items-center gap-1.5">
                    <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                    {new Date(entry.closeDate).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </div>
                </TableCell>
                <TableCell>
                  <div>
                    <div className="font-medium">{entry.opportunityName}</div>
                    {entry.accountName && (
                      <div className="text-xs text-muted-foreground">{entry.accountName}</div>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={typeInfo.variant}>{typeInfo.label}</Badge>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(entry.amount)}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {entry.isNewLogo && (
                      <Badge variant="outline" className="text-xs bg-status-green/10 text-status-green border-status-green/20">
                        <Star className="h-2.5 w-2.5 mr-0.5" />
                        NL
                      </Badge>
                    )}
                    {entry.isAnnualTerms && (
                      <Badge variant="outline" className="text-xs">Annual</Badge>
                    )}
                    {entry.isMultiYear && (
                      <Badge variant="outline" className="text-xs">Multi-Yr</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {formatPercent(entry.effectiveRate, 2)}
                </TableCell>
                <TableCell className="text-right font-medium text-status-green">
                  {formatCurrency(entry.commissionAmount)}
                </TableCell>
                <TableCell className="text-right">
                  {entry.quotaCredit > 0 ? formatCurrency(entry.quotaCredit) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
