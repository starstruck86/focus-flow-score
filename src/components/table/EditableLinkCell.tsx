// Editable link cells with clean display labels and click-to-add functionality
import { useState, useEffect } from 'react';
import { ExternalLink, Plus, Pencil, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface EditableLinkCellProps {
  value?: string;
  onChange: (value: string) => void;
  label: string;
  addLabel?: string;
  placeholder?: string;
  className?: string;
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (!trimmed.match(/^https?:\/\//i)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function isValidUrl(url: string): boolean {
  if (!url) return true;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * EditableLinkCell - displays a clean label link, click to add if empty
 */
export function EditableLinkCell({
  value = '',
  onChange,
  label,
  addLabel,
  placeholder = 'https://...',
  className,
}: EditableLinkCellProps) {
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
    
    if (normalized !== value) {
      onChange(normalized);
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

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
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
        className={cn("h-8 text-sm", className)}
      />
    );
  }

  // Has value - show clickable label link
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
            "text-xs font-medium"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3" />
          {label}
        </a>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity"
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
          className="h-6 w-6 opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(true);
          }}
          title="Edit"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  // No value - show "+ Add" button
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
      onClick={(e) => {
        e.stopPropagation();
        setIsEditing(true);
      }}
    >
      <Plus className="h-3 w-3 mr-1" />
      {addLabel || label}
    </Button>
  );
}

/**
 * WebsiteLinkCell - Website field with "Website" label
 */
export function WebsiteLinkCell({
  value,
  onChange,
  className,
}: {
  value?: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <EditableLinkCell
      value={value}
      onChange={onChange}
      label="Website"
      addLabel="Website"
      className={className}
    />
  );
}

/**
 * PlanhatLinkCell - Planhat field with "Planhat" label
 */
export function PlanhatLinkCell({
  value,
  onChange,
  className,
}: {
  value?: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <EditableLinkCell
      value={value}
      onChange={onChange}
      label="Planhat"
      addLabel="Planhat"
      className={className}
    />
  );
}

/**
 * AgreementLinkCell - Current Agreement field with "Agreement" label
 */
export function AgreementLinkCell({
  value,
  onChange,
  className,
}: {
  value?: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <EditableLinkCell
      value={value}
      onChange={onChange}
      label="Agreement"
      addLabel="Agreement"
      className={className}
    />
  );
}
