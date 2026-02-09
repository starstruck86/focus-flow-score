// Reusable inline editable cells - Display mode by default, edit on click
import React, { useState, useEffect, useRef } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface EditableCellProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  emptyText?: string;
}

// Text cell - single line input
export function EditableTextCell({
  value,
  onChange,
  placeholder = '—',
  className,
  emptyText = 'Add',
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    if (editValue !== value) {
      onChange(editValue);
      toast.success('Saved', { duration: 1500 });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      setEditValue(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn("h-8 text-sm", className)}
      />
    );
  }

  if (!value) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
        onClick={() => setIsEditing(true)}
      >
        <Plus className="h-3 w-3 mr-1" />
        {emptyText}
      </Button>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-1 cursor-pointer rounded px-2 py-1 -mx-2 hover:bg-muted/50 transition-colors min-h-[28px]",
        className
      )}
      onClick={() => setIsEditing(true)}
    >
      <span className="text-sm break-words flex-1">{value}</span>
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </div>
  );
}

// Textarea cell - multi-line input
export function EditableTextareaCell({
  value,
  onChange,
  placeholder = '—',
  className,
  emptyText = 'Add',
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    if (editValue !== value) {
      onChange(editValue);
      toast.success('Saved', { duration: 1500 });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setEditValue(value);
      setIsEditing(false);
    }
    // Enter creates new line in textarea, blur to save
  };

  if (isEditing) {
    return (
      <Textarea
        ref={textareaRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn("min-h-[60px] text-sm resize-none", className)}
        style={{ fieldSizing: 'content' } as React.CSSProperties}
        rows={2}
      />
    );
  }

  if (!value) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
        onClick={() => setIsEditing(true)}
      >
        <Plus className="h-3 w-3 mr-1" />
        {emptyText}
      </Button>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-start gap-1 cursor-pointer rounded px-2 py-1 -mx-2 hover:bg-muted/50 transition-colors min-h-[28px]",
        className
      )}
      onClick={() => setIsEditing(true)}
    >
      <span className="text-sm whitespace-pre-wrap break-words flex-1">{value}</span>
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
    </div>
  );
}

// Number/Currency cell
interface EditableNumberCellProps {
  value: number;
  onChange: (value: number) => void;
  format?: 'currency' | 'number';
  className?: string;
}

export function EditableNumberCell({
  value,
  onChange,
  format = 'number',
  className,
}: EditableNumberCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value?.toString() || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(value?.toString() || '');
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const formatDisplay = (num: number) => {
    if (format === 'currency') {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(num);
    }
    return num.toLocaleString();
  };

  const handleSave = () => {
    const numValue = Number(editValue) || 0;
    if (numValue !== value) {
      onChange(numValue);
      toast.success('Saved', { duration: 1500 });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      setEditValue(value?.toString() || '');
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        type="number"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className={cn("h-8 w-28 text-sm font-mono text-right", className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center justify-end gap-1 cursor-pointer rounded px-2 py-1 -mx-2 hover:bg-muted/50 transition-colors min-h-[28px]",
        className
      )}
      onClick={() => setIsEditing(true)}
    >
      <span className="text-sm font-mono">{formatDisplay(value)}</span>
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </div>
  );
}
