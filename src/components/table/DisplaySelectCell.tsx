// Display-mode select cell - shows as badge/pill, click to edit
import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface SelectOption {
  value: string;
  label: string;
  className?: string;
}

interface DisplaySelectCellProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  badgeClassName?: string;
}

export function DisplaySelectCell({
  value,
  options,
  onChange,
  className,
  badgeClassName,
}: DisplaySelectCellProps) {
  const [isEditing, setIsEditing] = useState(false);

  const currentOption = options.find((o) => o.value === value) || options[0];

  const handleChange = (newValue: string) => {
    if (newValue !== value) {
      onChange(newValue);
      toast.success('Saved', { duration: 1500 });
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <Select value={value} onValueChange={handleChange} open onOpenChange={(open) => !open && setIsEditing(false)}>
        <SelectTrigger className={cn("h-8 text-sm", className)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Badge
      className={cn(
        "cursor-pointer hover:opacity-80 transition-opacity text-xs",
        currentOption?.className,
        badgeClassName
      )}
      onClick={() => setIsEditing(true)}
    >
      {currentOption?.label || value}
    </Badge>
  );
}
