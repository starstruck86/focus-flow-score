import { useState, useEffect, useMemo } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Target, Building2, Check, ChevronsUpDown, Plus, Pencil, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { 
  OpportunityStatus, 
  OpportunityStage, 
  DealType, 
  PaymentTerms,
  ChurnRisk 
} from '@/types';

interface AddUpdateOpportunityModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillOpportunityId?: string;
  prefillAccountId?: string;
  prefillAccountName?: string;
  prefillRenewalId?: string;
  mode?: 'create' | 'update';
}

type OpportunityType = 'new-logo' | 'renewal';

const STAGES: { value: string; label: string }[] = [
  { value: 'none', label: 'No Stage' },
  { value: 'Prospect', label: '1 - Prospect' },
  { value: 'Discover', label: '2 - Discover' },
  { value: 'Demo', label: '3 - Demo' },
  { value: 'Proposal', label: '4 - Proposal' },
  { value: 'Negotiate', label: '5 - Negotiate' },
  { value: 'Closed Won', label: '6 - Closed Won' },
  { value: 'Closed Lost', label: '7 - Closed Lost' },
];
const STATUSES: OpportunityStatus[] = ['active', 'stalled', 'closed-lost', 'closed-won'];
const DEAL_TYPES: { value: DealType; label: string }[] = [
  { value: 'new-logo', label: 'New Logo' },
  { value: 'renewal', label: 'Renewal' },
  { value: 'expansion', label: 'Expansion' },
  { value: 'one-time', label: 'One-Time' },
];
const PAYMENT_TERMS: { value: PaymentTerms; label: string }[] = [
  { value: 'annual', label: 'Annual' },
  { value: 'prepaid', label: 'Prepaid' },
  { value: 'other', label: 'Other' },
];

export function AddUpdateOpportunityModal({
  open,
  onOpenChange,
  prefillOpportunityId,
  prefillAccountId,
  prefillAccountName,
  prefillRenewalId,
  mode: initialMode = 'create',
}: AddUpdateOpportunityModalProps) {
  const { opportunities, accounts, renewals, addOpportunity, updateOpportunity, updateRenewal } = useStore();
  
  const [mode, setMode] = useState<'create' | 'update'>(initialMode);
  const [oppSelectOpen, setOppSelectOpen] = useState(false);
  const [accountSelectOpen, setAccountSelectOpen] = useState(false);
  const [renewalSelectOpen, setRenewalSelectOpen] = useState(false);
  
  // Form state
  const [opportunityType, setOpportunityType] = useState<OpportunityType>('new-logo');
  const [selectedOppId, setSelectedOppId] = useState('');
  const [selectedRenewalId, setSelectedRenewalId] = useState('');
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [status, setStatus] = useState<OpportunityStatus>('active');
  const [stage, setStage] = useState<OpportunityStage>('');
  const [arr, setArr] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [dealType, setDealType] = useState<DealType | ''>('');
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms | ''>('');
  const [termMonths, setTermMonths] = useState('12');
  const [priorContractArr, setPriorContractArr] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [notes, setNotes] = useState('');
  const [churnRisk, setChurnRisk] = useState<ChurnRisk>('low');
  
  // Reset form
  useEffect(() => {
    if (open) {
      if (prefillOpportunityId) {
        setMode('update');
        setSelectedOppId(prefillOpportunityId);
        loadOpportunity(prefillOpportunityId);
      } else {
        setMode(initialMode);
        if (initialMode === 'create') {
          resetForm();
          if (prefillAccountId) setAccountId(prefillAccountId);
          if (prefillAccountName) setAccountName(prefillAccountName);
          if (prefillRenewalId) {
            setOpportunityType('renewal');
            setSelectedRenewalId(prefillRenewalId);
            loadRenewalDefaults(prefillRenewalId);
          }
        }
      }
    }
  }, [open, prefillOpportunityId, prefillAccountId, prefillAccountName, prefillRenewalId, initialMode]);
  
  const resetForm = () => {
    setOpportunityType('new-logo');
    setSelectedOppId('');
    setSelectedRenewalId('');
    setName('');
    setAccountId('');
    setAccountName('');
    setStatus('active');
    setStage('Prospect');
    setArr('');
    setCloseDate('');
    setDealType('');
    setPaymentTerms('');
    setTermMonths('12');
    setPriorContractArr('');
    setNextStep('');
    setNotes('');
    setChurnRisk('low');
  };
  
  const loadRenewalDefaults = (renewalId: string) => {
    const renewal = renewals.find(r => r.id === renewalId);
    if (renewal) {
      setName(`${renewal.accountName} Renewal`);
      setAccountName(renewal.accountName);
      setArr(renewal.arr?.toString() || '');
      setChurnRisk(renewal.churnRisk || 'low');
      // Close date is day before renewal
      if (renewal.renewalDue) {
        const dueDate = new Date(renewal.renewalDue);
        dueDate.setDate(dueDate.getDate() - 1);
        setCloseDate(dueDate.toISOString().split('T')[0]);
      }
    }
  };
  
  const loadOpportunity = (id: string) => {
    const opp = opportunities.find(o => o.id === id);
    if (opp) {
      setName(opp.name);
      setAccountId(opp.accountId || '');
      setAccountName(opp.accountName || '');
      setStatus(opp.status);
      setStage(opp.stage);
      setArr(opp.arr?.toString() || '');
      setCloseDate(opp.closeDate || '');
      setDealType(opp.dealType || '');
      setPaymentTerms(opp.paymentTerms || '');
      setTermMonths(opp.termMonths?.toString() || '12');
      setPriorContractArr(opp.priorContractArr?.toString() || '');
      setNextStep(opp.nextStep || '');
      setNotes(opp.notes || '');
      setChurnRisk(opp.churnRisk || 'low');
      // Check if this opp is linked to a renewal
      const linkedRenewal = renewals.find(r => r.linkedOpportunityId === id);
      if (linkedRenewal) {
        setOpportunityType('renewal');
        setSelectedRenewalId(linkedRenewal.id);
      }
    }
  };
  
  const selectedOpp = useMemo(() => 
    opportunities.find(o => o.id === selectedOppId),
    [opportunities, selectedOppId]
  );
  
  const selectedRenewal = useMemo(() =>
    renewals.find(r => r.id === selectedRenewalId),
    [renewals, selectedRenewalId]
  );

  const selectedAccount = useMemo(() =>
    accounts.find(a => a.id === accountId),
    [accounts, accountId]
  );
  
  const validateClosedWon = (): string | null => {
    if (status !== 'closed-won') return null;
    
    if (!arr || parseFloat(arr) <= 0) {
      return 'ARR is required for Closed Won deals';
    }
    if (!closeDate) {
      return 'Close Date is required for Closed Won deals';
    }
    if (!dealType) {
      return 'Deal Type is required for Closed Won deals';
    }
    if (dealType === 'renewal' && (!priorContractArr || parseFloat(priorContractArr) <= 0)) {
      return 'Prior Contract ARR is required for Renewal deals';
    }
    return null;
  };
  
  const handleSave = () => {
    if (mode === 'create') {
      if (!name.trim()) {
        toast.error('Opportunity name is required');
        return;
      }
      // For renewals, require a renewal selection
      if (opportunityType === 'renewal' && !selectedRenewalId) {
        toast.error('Please select a renewal account');
        return;
      }
      // For new-logo, require an account
      if (opportunityType === 'new-logo' && !accountId && !accountName.trim()) {
        toast.error('Please select or enter an account');
        return;
      }
    }
    
    const closedWonError = validateClosedWon();
    if (closedWonError) {
      toast.error(closedWonError);
      return;
    }
    
    const oppData = {
      name: name.trim(),
      accountId: accountId || undefined,
      accountName: accountName.trim() || selectedAccount?.name || selectedRenewal?.accountName || undefined,
      status,
      stage,
      arr: arr ? parseFloat(arr) : undefined,
      churnRisk: opportunityType === 'renewal' ? churnRisk : undefined,
      closeDate: closeDate || undefined,
      dealType: dealType || undefined,
      paymentTerms: paymentTerms || undefined,
      termMonths: termMonths ? parseInt(termMonths) : undefined,
      priorContractArr: priorContractArr ? parseFloat(priorContractArr) : undefined,
      nextStep: nextStep.trim() || undefined,
      notes: notes.trim() || undefined,
      linkedContactIds: selectedOpp?.linkedContactIds || [],
      activityLog: selectedOpp?.activityLog || [],
    };
    
    if (mode === 'create') {
      addOpportunity(oppData as any);
      
      // If creating a renewal opportunity, link it to the renewal
      if (opportunityType === 'renewal' && selectedRenewalId) {
        // We need to get the newly created opportunity and link it
        setTimeout(() => {
          const { opportunities: updatedOpps } = useStore.getState();
          const newOpp = updatedOpps.find(o => 
            o.name === name.trim() && 
            o.accountName === (accountName.trim() || selectedRenewal?.accountName) &&
            !renewals.some(r => r.linkedOpportunityId === o.id)
          );
          if (newOpp) {
            updateRenewal(selectedRenewalId, { linkedOpportunityId: newOpp.id });
          }
        }, 0);
      }
      
      toast.success('Opportunity created', {
        description: name.trim(),
      });
    } else {
      updateOpportunity(selectedOppId, oppData);
      toast.success('Opportunity updated', {
        description: name.trim(),
      });
    }
    
    onOpenChange(false);
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            {mode === 'create' ? 'Create Opportunity' : 'Update Opportunity'}
          </DialogTitle>
        </DialogHeader>
        
        {/* Mode Toggle */}
        <Tabs value={mode} onValueChange={(v) => {
          setMode(v as 'create' | 'update');
          if (v === 'create') resetForm();
        }}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="create" className="gap-2">
              <Plus className="h-4 w-4" />
              Create
            </TabsTrigger>
            <TabsTrigger value="update" className="gap-2">
              <Pencil className="h-4 w-4" />
              Update
            </TabsTrigger>
          </TabsList>
          
          <div className="space-y-4 py-4">
            {/* Select Opportunity (Update mode) */}
            {mode === 'update' && (
              <div className="space-y-2">
                <Label>Select Opportunity *</Label>
                <Popover open={oppSelectOpen} onOpenChange={setOppSelectOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between"
                    >
                      {selectedOpp ? (
                        <span className="flex items-center gap-2 truncate">
                          <Target className="h-4 w-4 text-muted-foreground" />
                          {selectedOpp.name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Select opportunity...</span>
                      )}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[350px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search opportunities..." />
                      <CommandList>
                        <CommandEmpty>No opportunities found.</CommandEmpty>
                        <CommandGroup>
                          {opportunities.map(opp => (
                            <CommandItem
                              key={opp.id}
                              value={opp.name}
                              onSelect={() => {
                                setSelectedOppId(opp.id);
                                loadOpportunity(opp.id);
                                setOppSelectOpen(false);
                              }}
                            >
                              <Target className="h-4 w-4 mr-2 text-muted-foreground" />
                              <span className="truncate">{opp.name}</span>
                              <Check
                                className={cn(
                                  "ml-auto h-4 w-4",
                                  selectedOppId === opp.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            )}
            
            {/* Opportunity Type Toggle (Create mode) */}
            {mode === 'create' && (
              <div className="space-y-2">
                <Label>Opportunity Type</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={opportunityType === 'new-logo' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1 gap-2"
                    onClick={() => {
                      setOpportunityType('new-logo');
                      setSelectedRenewalId('');
                    }}
                  >
                    <Building2 className="h-4 w-4" />
                    New Logo
                  </Button>
                  <Button
                    type="button"
                    variant={opportunityType === 'renewal' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1 gap-2"
                    onClick={() => {
                      setOpportunityType('renewal');
                      setAccountId('');
                      setAccountName('');
                    }}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Renewal
                  </Button>
                </div>
              </div>
            )}
            
            {/* Renewal Selector (Create mode, renewal type) */}
            {mode === 'create' && opportunityType === 'renewal' && (
              <div className="space-y-2">
                <Label>Linked Renewal Account *</Label>
                <Popover open={renewalSelectOpen} onOpenChange={setRenewalSelectOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between"
                    >
                      {selectedRenewal ? (
                        <span className="flex items-center gap-2 truncate">
                          <RefreshCw className="h-4 w-4 text-muted-foreground" />
                          {selectedRenewal.accountName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Select renewal...</span>
                      )}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[350px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search renewals..." />
                      <CommandList>
                        <CommandEmpty>No renewals found.</CommandEmpty>
                        <CommandGroup>
                          {renewals.map(renewal => (
                            <CommandItem
                              key={renewal.id}
                              value={renewal.accountName}
                              onSelect={() => {
                                setSelectedRenewalId(renewal.id);
                                loadRenewalDefaults(renewal.id);
                                setRenewalSelectOpen(false);
                              }}
                            >
                              <RefreshCw className="h-4 w-4 mr-2 text-muted-foreground" />
                              <span className="truncate">{renewal.accountName}</span>
                              <Check
                                className={cn(
                                  "ml-auto h-4 w-4",
                                  selectedRenewalId === renewal.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            )}
            
            {/* Name (Create mode) */}
            {mode === 'create' && (
              <div className="space-y-2">
                <Label>Opportunity Name *</Label>
                <Input
                  placeholder="e.g., Acme Corp - Enterprise License"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}
            
            {/* Account Selector (Create mode, new-logo type only) */}
            {mode === 'create' && opportunityType === 'new-logo' && (
              <div className="space-y-2">
                <Label>Linked Account *</Label>
                <Popover open={accountSelectOpen} onOpenChange={setAccountSelectOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between"
                    >
                      {selectedAccount ? (
                        <span className="flex items-center gap-2 truncate">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {selectedAccount.name}
                        </span>
                      ) : accountName ? (
                        <span className="flex items-center gap-2 truncate">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {accountName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Select account...</span>
                      )}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[350px] p-0" align="start">
                    <Command>
                      <CommandInput 
                        placeholder="Search or type new account..." 
                        value={accountName}
                        onValueChange={setAccountName}
                      />
                      <CommandList>
                        <CommandEmpty>
                          <div className="p-2 text-sm text-muted-foreground">
                            No account found. Use "{accountName}" as new account.
                          </div>
                        </CommandEmpty>
                        <CommandGroup>
                          {accounts.map(account => (
                            <CommandItem
                              key={account.id}
                              value={account.name}
                              onSelect={() => {
                                setAccountId(account.id);
                                setAccountName(account.name);
                                setAccountSelectOpen(false);
                              }}
                            >
                              <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
                              <span className="truncate">{account.name}</span>
                              <Check
                                className={cn(
                                  "ml-auto h-4 w-4",
                                  accountId === account.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            )}
            
            {/* Churn Risk (Renewal type only) */}
            {opportunityType === 'renewal' && (
              <div className="space-y-2">
                <Label>Churn Risk</Label>
                <Select value={churnRisk} onValueChange={(v) => setChurnRisk(v as ChurnRisk)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="certain">Certain</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            
            {/* Status & Stage Row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as OpportunityStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(s => (
                      <SelectItem key={s} value={s} className="capitalize">
                        {s.replace('-', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Stage</Label>
                <Select 
                  value={stage || 'none'} 
                  onValueChange={(v) => setStage(v === 'none' ? '' : v as OpportunityStage)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No Stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGES.map(s => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {/* ARR & Close Date Row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>ARR {status === 'closed-won' && '*'}</Label>
                <Input
                  type="number"
                  placeholder="e.g., 50000"
                  value={arr}
                  onChange={(e) => setArr(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Close Date {status === 'closed-won' && '*'}</Label>
                <Input
                  type="date"
                  value={closeDate}
                  onChange={(e) => setCloseDate(e.target.value)}
                />
              </div>
            </div>
            
            {/* Deal Type & Payment Terms (visible when Closed Won) */}
            {status === 'closed-won' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Deal Type *</Label>
                    <Select value={dealType} onValueChange={(v) => setDealType(v as DealType)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type..." />
                      </SelectTrigger>
                      <SelectContent>
                        {DEAL_TYPES.map(dt => (
                          <SelectItem key={dt.value} value={dt.value}>
                            {dt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Payment Terms</Label>
                    <Select value={paymentTerms} onValueChange={(v) => setPaymentTerms(v as PaymentTerms)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select terms..." />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_TERMS.map(pt => (
                          <SelectItem key={pt.value} value={pt.value}>
                            {pt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Term Months</Label>
                    <Input
                      type="number"
                      value={termMonths}
                      onChange={(e) => setTermMonths(e.target.value)}
                    />
                  </div>
                  {dealType === 'renewal' && (
                    <div className="space-y-2">
                      <Label>Prior Contract ARR *</Label>
                      <Input
                        type="number"
                        placeholder="e.g., 45000"
                        value={priorContractArr}
                        onChange={(e) => setPriorContractArr(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
            
            {/* Next Step */}
            <div className="space-y-2">
              <Label>Next Step</Label>
              <Input
                placeholder="e.g., Schedule demo with VP Sales"
                value={nextStep}
                onChange={(e) => setNextStep(e.target.value)}
              />
            </div>
            
            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                placeholder="Additional notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        </Tabs>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} className="gap-2">
            <Target className="h-4 w-4" />
            {mode === 'create' ? 'Create Opportunity' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
