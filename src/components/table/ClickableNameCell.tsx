// Clickable name with Salesforce link integration
// - If SFDC link exists: name is a clickable link to Salesforce
// - If SFDC link missing: clicking name opens popover to add link
// - Pencil icon to edit the name text itself
import { useState, useEffect, useRef } from 'react';
import { ExternalLink, Plus, Pencil, Link } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ClickableNameCellProps {
  name: string;
  salesforceLink?: string;
  onNameChange?: (name: string) => void;
  onSalesforceLinkChange: (link: string) => void;
  onOpenDetails?: () => void;
  className?: string;
  fontWeight?: 'normal' | 'medium' | 'semibold';
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

export function ClickableNameCell({
  name,
  salesforceLink,
  onNameChange,
  onSalesforceLinkChange,
  className,
  fontWeight = 'medium',
}: ClickableNameCellProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingLink, setIsEditingLink] = useState(false);
  const [editName, setEditName] = useState(name);
  const [editLink, setEditLink] = useState(salesforceLink || '');
  const [popoverOpen, setPopoverOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditName(name);
  }, [name]);

  useEffect(() => {
    setEditLink(salesforceLink || '');
  }, [salesforceLink]);

  const fontClass = {
    normal: 'font-normal',
    medium: 'font-medium',
    semibold: 'font-semibold',
  }[fontWeight];

  // Save name changes
  const handleSaveName = () => {
    if (editName.trim() && editName !== name && onNameChange) {
      onNameChange(editName.trim());
      toast.success('Saved', { duration: 1500 });
    }
    setIsEditingName(false);
  };

  // Save link changes
  const handleSaveLink = () => {
    const normalized = normalizeUrl(editLink);
    
    if (normalized && !isValidUrl(normalized)) {
      toast.error('Invalid URL format');
      return;
    }
    
    if (normalized !== salesforceLink) {
      onSalesforceLinkChange(normalized);
      toast.success('Saved', { duration: 1500 });
    }
    setIsEditingLink(false);
    setPopoverOpen(false);
  };

  const handleKeyDownName = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveName();
    } else if (e.key === 'Escape') {
      setEditName(name);
      setIsEditingName(false);
    }
  };

  const handleKeyDownLink = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveLink();
    } else if (e.key === 'Escape') {
      setEditLink(salesforceLink || '');
      setIsEditingLink(false);
      setPopoverOpen(false);
    }
  };

  // Editing name mode
  if (isEditingName) {
    return (
      <Input
        ref={inputRef}
        value={editName}
        onChange={(e) => setEditName(e.target.value)}
        onBlur={handleSaveName}
        onKeyDown={handleKeyDownName}
        autoFocus
        className="h-8 text-sm"
      />
    );
  }

  // Has Salesforce link - name is a clickable link
  if (salesforceLink) {
    const normalizedLink = salesforceLink.startsWith('http') 
      ? salesforceLink 
      : `https://${salesforceLink}`;
    
    return (
      <div className={cn("group flex items-center gap-1", className)}>
        <a
          href={normalizedLink}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "hover:underline underline-offset-2 decoration-primary/50 cursor-pointer",
            fontClass
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {name}
        </a>
        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-70 transition-opacity shrink-0" />
        
        {/* Edit SFDC link button */}
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                setPopoverOpen(true);
              }}
              title="Edit Salesforce Link"
            >
              <Link className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-3" align="start" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Salesforce Link</label>
              <Input
                value={editLink}
                onChange={(e) => setEditLink(e.target.value)}
                onKeyDown={handleKeyDownLink}
                placeholder="https://salesforce.com/..."
                autoFocus
                className="h-8 text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSaveLink}>
                  Save
                </Button>
                <Button 
                  size="sm" 
                  variant="ghost" 
                  className="h-7 text-xs"
                  onClick={() => {
                    setEditLink(salesforceLink || '');
                    setPopoverOpen(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Edit name button */}
        {onNameChange && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditingName(true);
            }}
            title="Edit Name"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
    );
  }

  // No Salesforce link - clicking name opens add link popover
  return (
    <div className={cn("group flex items-center gap-1", className)}>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "text-left hover:text-primary transition-colors cursor-pointer",
              fontClass
            )}
            onClick={(e) => {
              e.stopPropagation();
              setPopoverOpen(true);
            }}
          >
            {name}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3" align="start" onClick={(e) => e.stopPropagation()}>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Plus className="h-3 w-3" />
              Add Salesforce Link
            </label>
            <Input
              value={editLink}
              onChange={(e) => setEditLink(e.target.value)}
              onKeyDown={handleKeyDownLink}
              placeholder="https://salesforce.com/..."
              autoFocus
              className="h-8 text-sm"
            />
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSaveLink}>
                Save
              </Button>
              <Button 
                size="sm" 
                variant="ghost" 
                className="h-7 text-xs"
                onClick={() => {
                  setEditLink('');
                  setPopoverOpen(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      
      {/* Small link icon hint when no link exists */}
      <Plus className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />

      {/* Edit name button */}
      {onNameChange && (
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            setIsEditingName(true);
          }}
          title="Edit Name"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

/**
 * AccountNameCell - Account name with Salesforce link
 */
export function AccountNameCell({
  name,
  salesforceLink,
  onNameChange,
  onSalesforceLinkChange,
  onOpenDetails,
  className,
}: {
  name: string;
  salesforceLink?: string;
  onNameChange?: (name: string) => void;
  onSalesforceLinkChange: (link: string) => void;
  onOpenDetails?: () => void;
  className?: string;
}) {
  return (
    <ClickableNameCell
      name={name}
      salesforceLink={salesforceLink}
      onNameChange={onNameChange}
      onSalesforceLinkChange={onSalesforceLinkChange}
      onOpenDetails={onOpenDetails}
      fontWeight="medium"
      className={className}
    />
  );
}

/**
 * OpportunityNameCell - Opportunity name with Salesforce link
 */
export function OpportunityNameCell({
  name,
  salesforceLink,
  onNameChange,
  onSalesforceLinkChange,
  onOpenDetails,
  className,
}: {
  name: string;
  salesforceLink?: string;
  onNameChange?: (name: string) => void;
  onSalesforceLinkChange: (link: string) => void;
  onOpenDetails?: () => void;
  className?: string;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [editLink, setEditLink] = useState(salesforceLink || '');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(name);

  useEffect(() => {
    setEditName(name);
  }, [name]);

  useEffect(() => {
    setEditLink(salesforceLink || '');
  }, [salesforceLink]);

  const handleSaveName = () => {
    if (editName.trim() && editName !== name && onNameChange) {
      onNameChange(editName.trim());
      toast.success('Saved', { duration: 1500 });
    }
    setIsEditingName(false);
  };

  const handleSaveLink = () => {
    const normalized = editLink.trim() ? (editLink.startsWith('http') ? editLink : `https://${editLink}`) : '';
    if (normalized !== salesforceLink) {
      onSalesforceLinkChange(normalized);
      toast.success('Saved', { duration: 1500 });
    }
    setPopoverOpen(false);
  };

  const handleKeyDownName = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveName();
    } else if (e.key === 'Escape') {
      setEditName(name);
      setIsEditingName(false);
    }
  };

  const handleKeyDownLink = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveLink();
    } else if (e.key === 'Escape') {
      setEditLink(salesforceLink || '');
      setPopoverOpen(false);
    }
  };

  if (isEditingName) {
    return (
      <Input
        value={editName}
        onChange={(e) => setEditName(e.target.value)}
        onBlur={handleSaveName}
        onKeyDown={handleKeyDownName}
        autoFocus
        className="h-8 text-sm"
      />
    );
  }

  // Has Salesforce link - name links to SFDC
  if (salesforceLink) {
    const normalizedLink = salesforceLink.startsWith('http') ? salesforceLink : `https://${salesforceLink}`;
    
    return (
      <div className={cn("group flex items-center gap-1", className)}>
        <a
          href={normalizedLink}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary hover:underline underline-offset-2"
          onClick={(e) => e.stopPropagation()}
        >
          {name}
        </a>
        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-70 transition-opacity shrink-0" />
        
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
              title="Edit Salesforce Link"
            >
              <Link className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-3" align="start" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Salesforce Link</label>
              <Input
                value={editLink}
                onChange={(e) => setEditLink(e.target.value)}
                onKeyDown={handleKeyDownLink}
                placeholder="https://salesforce.com/..."
                autoFocus
                className="h-8 text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSaveLink}>Save</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPopoverOpen(false)}>Cancel</Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {onNameChange && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditingName(true);
            }}
            title="Edit Name"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
    );
  }

  // No Salesforce link - clicking opens details drawer (if provided) or add link popover
  return (
    <div className={cn("group flex items-center gap-1", className)}>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            className="font-medium text-primary hover:underline text-left"
            onClick={(e) => {
              e.stopPropagation();
              setPopoverOpen(true);
            }}
          >
            {name}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3" align="start" onClick={(e) => e.stopPropagation()}>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Plus className="h-3 w-3" />
              Add Salesforce Link
            </label>
            <Input
              value={editLink}
              onChange={(e) => setEditLink(e.target.value)}
              onKeyDown={handleKeyDownLink}
              placeholder="https://salesforce.com/..."
              autoFocus
              className="h-8 text-sm"
            />
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSaveLink}>Save</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPopoverOpen(false)}>Cancel</Button>
            </div>
            {onOpenDetails && (
              <Button
                variant="link"
                size="sm"
                className="h-6 text-xs p-0 text-muted-foreground"
                onClick={() => {
                  setPopoverOpen(false);
                  onOpenDetails();
                }}
              >
                Open details instead →
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      
      <Plus className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />

      {onNameChange && (
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            setIsEditingName(true);
          }}
          title="Edit Name"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
