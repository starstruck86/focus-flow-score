import { useState, useMemo } from 'react';
import { Building2, Target, Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
import { useStore } from '@/store/useStore';
import type { LinkedRecordType, Motion } from '@/types';

interface LinkedRecordOption {
  type: LinkedRecordType;
  id: string;
  label: string;
  accountId?: string; // For opportunities, store the parent account
  suggestedMotion?: Motion;
}

interface LinkedRecordSelectorProps {
  value?: { type: LinkedRecordType; id: string };
  onChange: (value: { type: LinkedRecordType; id: string; accountId?: string; suggestedMotion?: Motion } | null) => void;
  placeholder?: string;
  className?: string;
}

export function LinkedRecordSelector({
  value,
  onChange,
  placeholder = "Select account or opportunity...",
  className,
}: LinkedRecordSelectorProps) {
  const { accounts, opportunities } = useStore();
  const [open, setOpen] = useState(false);

  // Build combined options list
  const options = useMemo(() => {
    const result: LinkedRecordOption[] = [];

    // Add accounts
    accounts.forEach(account => {
      result.push({
        type: 'account',
        id: account.id,
        label: account.name,
        suggestedMotion: account.motion === 'renewal' ? 'renewal' : 'new-logo',
      });
    });

    // Add opportunities
    opportunities.forEach(opp => {
      // Find parent account if linked
      const parentAccount = opp.accountId 
        ? accounts.find(a => a.id === opp.accountId)
        : accounts.find(a => a.name === opp.accountName);
      
      // Suggest motion based on deal type or opportunity context
      let suggestedMotion: Motion = 'new-logo';
      if (opp.dealType === 'renewal') {
        suggestedMotion = 'renewal';
      } else if (opp.dealType === 'new-logo' || opp.dealType === 'expansion') {
        suggestedMotion = 'new-logo';
      }

      result.push({
        type: 'opportunity',
        id: opp.id,
        label: parentAccount ? `${opp.name} (${parentAccount.name})` : opp.name,
        accountId: parentAccount?.id || opp.accountId,
        suggestedMotion,
      });
    });

    return result;
  }, [accounts, opportunities]);

  // Find currently selected option
  const selectedOption = value 
    ? options.find(opt => opt.type === value.type && opt.id === value.id)
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between", className)}
        >
          {selectedOption ? (
            <span className="flex items-center gap-2 truncate">
              {selectedOption.type === 'account' ? (
                <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              ) : (
                <Target className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              )}
              <span className="truncate">{selectedOption.label}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[350px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search accounts or opportunities..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            
            {/* Accounts Group */}
            <CommandGroup heading="Accounts">
              {options
                .filter(opt => opt.type === 'account')
                .map(opt => (
                  <CommandItem
                    key={`account-${opt.id}`}
                    value={`account-${opt.label}`}
                    onSelect={() => {
                      onChange({
                        type: opt.type,
                        id: opt.id,
                        accountId: opt.id, // For accounts, the account IS the record
                        suggestedMotion: opt.suggestedMotion,
                      });
                      setOpen(false);
                    }}
                  >
                    <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
                    <span className="truncate">{opt.label}</span>
                    <Check
                      className={cn(
                        "ml-auto h-4 w-4",
                        selectedOption?.type === 'account' && selectedOption?.id === opt.id
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
            </CommandGroup>

            {/* Opportunities Group */}
            <CommandGroup heading="Opportunities">
              {options
                .filter(opt => opt.type === 'opportunity')
                .map(opt => (
                  <CommandItem
                    key={`opp-${opt.id}`}
                    value={`opportunity-${opt.label}`}
                    onSelect={() => {
                      onChange({
                        type: opt.type,
                        id: opt.id,
                        accountId: opt.accountId,
                        suggestedMotion: opt.suggestedMotion,
                      });
                      setOpen(false);
                    }}
                  >
                    <Target className="h-4 w-4 mr-2 text-muted-foreground" />
                    <span className="truncate">{opt.label}</span>
                    <Check
                      className={cn(
                        "ml-auto h-4 w-4",
                        selectedOption?.type === 'opportunity' && selectedOption?.id === opt.id
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
