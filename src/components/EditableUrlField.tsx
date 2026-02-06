// Editable URL field with clickable link + inline editing
import { useState, useEffect } from 'react';
import { ExternalLink, Plus, Pencil, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface EditableUrlFieldProps {
  value?: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  compact?: boolean;
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  
  // Auto-add https:// if missing
  if (!trimmed.match(/^https?:\/\//i)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function isValidUrl(url: string): boolean {
  if (!url) return true; // Empty is valid (optional field)
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function EditableUrlField({
  value = '',
  onChange,
  label = 'Link',
  placeholder = 'https://...',
  className,
  compact = false,
}: EditableUrlFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  const handleSave = () => {
    const normalized = normalizeUrl(editValue);
    
    if (normalized && !isValidUrl(normalized)) {
      toast.error('Invalid URL format');
      return;
    }
    
    onChange(normalized);
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

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  // Editing mode
  if (isEditing) {
    return (
      <Input
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus
        className={cn(
          compact ? "h-8 text-sm" : "h-9",
          className
        )}
      />
    );
  }

  // Has value - show clickable link
  if (value) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded-md",
            "bg-primary/10 text-primary hover:bg-primary/20 transition-colors",
            "text-sm font-medium"
          )}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {label}
        </a>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-70 hover:opacity-100"
          onClick={handleCopy}
          title="Copy link"
        >
          {copied ? (
            <Check className="h-3 w-3 text-status-green" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-70 hover:opacity-100"
          onClick={() => setIsEditing(true)}
          title="Edit"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  // No value - show Add button
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "text-muted-foreground hover:text-foreground",
        compact ? "h-7 text-xs px-2" : "h-8 text-sm"
      )}
      onClick={() => setIsEditing(true)}
    >
      <Plus className="h-3 w-3 mr-1" />
      Add
    </Button>
  );
}
