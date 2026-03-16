import { useState } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import { CalendarIcon, Pencil, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface EditableDatePickerProps {
  value?: string; // ISO date string YYYY-MM-DD
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  className?: string;
  compact?: boolean;
}

export function EditableDatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  className,
  compact = false,
}: EditableDatePickerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || '');
  const [open, setOpen] = useState(false);

  const parsedDate = value ? parseISO(value) : undefined;
  const isValidDate = parsedDate && isValid(parsedDate);

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      const isoDate = format(date, 'yyyy-MM-dd');
      onChange(isoDate);
    } else {
      onChange(undefined);
    }
    setOpen(false);
  };

  const handleManualSave = () => {
    if (!editValue.trim()) {
      onChange(undefined);
    } else {
      // Try to parse the manual input
      const parsed = new Date(editValue);
      if (isValid(parsed)) {
        onChange(format(parsed, 'yyyy-MM-dd'));
      } else {
        // Keep original value if invalid
        onChange(value);
      }
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleManualSave();
    } else if (e.key === 'Escape') {
      setEditValue(value || '');
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <Input
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleManualSave}
        onKeyDown={handleKeyDown}
        placeholder="YYYY-MM-DD"
        className={cn(compact ? "h-7 text-xs" : "h-9", className)}
        autoFocus
      />
    );
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "justify-start text-left font-normal",
              compact ? "h-7 text-xs px-2" : "h-9",
              !value && "text-muted-foreground",
              className
            )}
          >
            <CalendarIcon className={cn("mr-1", compact ? "h-3 w-3" : "h-4 w-4")} />
            {isValidDate ? format(parsedDate, compact ? 'M/d/yy' : 'MMM d, yyyy') : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={isValidDate ? parsedDate : undefined}
            onSelect={handleDateSelect}
            initialFocus
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className={cn("shrink-0 text-muted-foreground hover:text-destructive", compact ? "h-5 w-5" : "h-7 w-7")}
          onClick={() => onChange(undefined)}
          title="Clear date"
        >
          <X className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className={cn("shrink-0", compact ? "h-5 w-5" : "h-7 w-7")}
        onClick={() => {
          setEditValue(value || '');
          setIsEditing(true);
        }}
        title="Edit date manually"
      >
        <Pencil className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      </Button>
    </div>
  );
}

