// Closed Won Fields Modal - Collects required fields when marking opportunity as Closed Won
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import type { Opportunity, DealType, PaymentTerms } from '@/types';

interface ClosedWonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunity: Opportunity;
  onSave: (updates: Partial<Opportunity>) => void;
}

export function ClosedWonModal({
  open,
  onOpenChange,
  opportunity,
  onSave,
}: ClosedWonModalProps) {
  const [dealType, setDealType] = useState<DealType>(opportunity.dealType || 'new-logo');
  const [arr, setArr] = useState(opportunity.arr || 0);
  const [closeDate, setCloseDate] = useState(opportunity.closeDate || new Date().toISOString().split('T')[0]);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>(opportunity.paymentTerms || 'annual');
  const [termMonths, setTermMonths] = useState(opportunity.termMonths || 12);
  const [priorContractArr, setPriorContractArr] = useState(opportunity.priorContractArr || 0);
  const [renewalArr, setRenewalArr] = useState(opportunity.renewalArr || opportunity.arr || 0);
  const [oneTimeAmount, setOneTimeAmount] = useState(opportunity.oneTimeAmount || opportunity.arr || 0);
  const [isNewLogo, setIsNewLogo] = useState(opportunity.isNewLogo ?? true);
  
  // Reset form when opportunity changes
  useEffect(() => {
    setDealType(opportunity.dealType || 'new-logo');
    setArr(opportunity.arr || 0);
    setCloseDate(opportunity.closeDate || new Date().toISOString().split('T')[0]);
    setPaymentTerms(opportunity.paymentTerms || 'annual');
    setTermMonths(opportunity.termMonths || 12);
    setPriorContractArr(opportunity.priorContractArr || 0);
    setRenewalArr(opportunity.renewalArr || opportunity.arr || 0);
    setOneTimeAmount(opportunity.oneTimeAmount || opportunity.arr || 0);
    setIsNewLogo(opportunity.isNewLogo ?? true);
  }, [opportunity]);
  
  const handleSave = () => {
    const updates: Partial<Opportunity> = {
      status: 'closed-won',
      dealType,
      closeDate,
      paymentTerms,
      termMonths,
      isNewLogo: dealType === 'new-logo' ? true : isNewLogo,
    };
    
    if (dealType === 'new-logo' || dealType === 'expansion') {
      updates.arr = arr;
    } else if (dealType === 'renewal') {
      updates.priorContractArr = priorContractArr;
      updates.renewalArr = renewalArr;
      updates.arr = renewalArr;
    } else if (dealType === 'one-time') {
      updates.oneTimeAmount = oneTimeAmount;
      updates.arr = oneTimeAmount;
    }
    
    onSave(updates);
    onOpenChange(false);
  };
  
  const isValid = () => {
    if (!closeDate) return false;
    
    switch (dealType) {
      case 'new-logo':
      case 'expansion':
        return arr > 0;
      case 'renewal':
        return priorContractArr > 0 && renewalArr > 0;
      case 'one-time':
        return oneTimeAmount > 0;
      default:
        return true;
    }
  };
  
  // Calculate split for renewals
  const renewalArrEligible = dealType === 'renewal' ? Math.min(renewalArr, priorContractArr) : 0;
  const expansionUplift = dealType === 'renewal' ? Math.max(0, renewalArr - priorContractArr) : 0;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Close Won: {opportunity.name}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Close Date */}
          <div className="space-y-2">
            <Label>Close Date</Label>
            <Input
              type="date"
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
            />
          </div>
          
          {/* Deal Type */}
          <div className="space-y-2">
            <Label>Deal Type</Label>
            <Select value={dealType} onValueChange={(v) => setDealType(v as DealType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new-logo">New Logo</SelectItem>
                <SelectItem value="expansion">Expansion</SelectItem>
                <SelectItem value="renewal">Renewal</SelectItem>
                <SelectItem value="one-time">One-Time</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* New Logo / Expansion fields */}
          {(dealType === 'new-logo' || dealType === 'expansion') && (
            <>
              <div className="space-y-2">
                <Label>Year-1 ARR ($)</Label>
                <Input
                  type="number"
                  value={arr || ''}
                  onChange={(e) => setArr(Number(e.target.value))}
                  placeholder="100000"
                />
              </div>
              
              {dealType === 'expansion' && (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="isNewLogo"
                    checked={isNewLogo}
                    onCheckedChange={(checked) => setIsNewLogo(checked === true)}
                  />
                  <Label htmlFor="isNewLogo" className="text-sm font-normal">
                    Account is a New Logo (adds +3% kicker)
                  </Label>
                </div>
              )}
            </>
          )}
          
          {/* Renewal fields */}
          {dealType === 'renewal' && (
            <>
              <div className="space-y-2">
                <Label>Prior Contract ARR ($)</Label>
                <Input
                  type="number"
                  value={priorContractArr || ''}
                  onChange={(e) => setPriorContractArr(Number(e.target.value))}
                  placeholder="Prior ARR baseline"
                />
                <p className="text-xs text-muted-foreground">
                  The ARR of the contract being renewed
                </p>
              </div>
              
              <div className="space-y-2">
                <Label>Renewal ARR ($)</Label>
                <Input
                  type="number"
                  value={renewalArr || ''}
                  onChange={(e) => setRenewalArr(Number(e.target.value))}
                  placeholder="New contracted ARR"
                />
              </div>
              
              {/* Show split preview */}
              {priorContractArr > 0 && renewalArr > 0 && (
                <div className="rounded-md bg-muted p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>Renewal ARR (quota credit):</span>
                    <span className="font-medium">${renewalArrEligible.toLocaleString()}</span>
                  </div>
                  {expansionUplift > 0 && (
                    <div className="flex justify-between text-status-green">
                      <span>Expansion Uplift (New ARR):</span>
                      <span className="font-medium">+${expansionUplift.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          
          {/* One-Time fields */}
          {dealType === 'one-time' && (
            <div className="space-y-2">
              <Label>One-Time Amount ($)</Label>
              <Input
                type="number"
                value={oneTimeAmount || ''}
                onChange={(e) => setOneTimeAmount(Number(e.target.value))}
                placeholder="25000"
              />
              <p className="text-xs text-muted-foreground">
                Pays 3% flat commission. No quota retirement.
              </p>
            </div>
          )}
          
          {/* Payment Terms */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Payment Terms</Label>
              <Select value={paymentTerms} onValueChange={(v) => setPaymentTerms(v as PaymentTerms)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="prepaid">Prepaid</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Term (Months)</Label>
              <Input
                type="number"
                value={termMonths || ''}
                onChange={(e) => setTermMonths(Number(e.target.value))}
                placeholder="12"
              />
            </div>
          </div>
          
          {/* Kicker preview */}
          {dealType !== 'one-time' && dealType !== 'renewal' && (
            <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
              <div className="font-medium mb-1">Commission Kickers:</div>
              {(dealType === 'new-logo' || isNewLogo) && (
                <div className="text-status-green">✓ New Logo: +3%</div>
              )}
              {paymentTerms === 'annual' && (
                <div className="text-status-green">✓ Annual Terms: +2%</div>
              )}
              {termMonths >= 24 && (
                <div className="text-status-green">✓ Multi-Year: +1%</div>
              )}
            </div>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid()}>
            Save & Close Won
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
