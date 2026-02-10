// Renders a custom field value with display-first behavior, matching the field type
import { useState } from 'react';
import { Link2, ExternalLink, X } from 'lucide-react';
import { EditableTextCell, EditableTextareaCell, EditableNumberCell } from './EditableCell';
import { EditableLinkCell } from './EditableLinkCell';
import { DisplaySelectCell } from './DisplaySelectCell';
import { EditableDatePicker } from '@/components/EditableDatePicker';
import { useCustomFields, type CustomFieldDefinition } from '@/hooks/useCustomFields';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface CustomFieldCellProps {
  field: CustomFieldDefinition;
  recordId: string;
  /** When provided, show this formatted string as display value instead of raw number */
  metricDisplay?: string;
}

// Small link icon button that lets users attach a URL to any custom field value
function FieldLinkAttachment({ recordId, fieldId }: { recordId: string; fieldId: string }) {
  const { getFieldLink, setFieldLink } = useCustomFields();
  const link = getFieldLink(recordId, fieldId);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(link || '');

  const handleSave = () => {
    const normalized = url.trim();
    if (normalized && !/^https?:\/\//i.test(normalized)) {
      setFieldLink(recordId, fieldId, `https://${normalized}`);
    } else {
      setFieldLink(recordId, fieldId, normalized || undefined);
    }
    setOpen(false);
  };

  const handleRemove = () => {
    setFieldLink(recordId, fieldId, undefined);
    setUrl('');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setUrl(link || ''); }}>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center justify-center h-4 w-4 rounded hover:bg-muted transition-colors ${link ? 'text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground'}`}
          title={link ? 'Edit link' : 'Add link'}
        >
          <Link2 className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Link URL</label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="h-7 text-xs"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <div className="flex gap-1.5">
            <Button size="sm" className="h-6 text-xs flex-1" onClick={handleSave}>Save</Button>
            {link && (
              <Button size="sm" variant="ghost" className="h-6 text-xs text-destructive" onClick={handleRemove}>
                <X className="h-3 w-3 mr-0.5" /> Remove
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Renders a value alongside a separate link icon (so the value remains editable)
function LinkedValue({ recordId, fieldId, children }: { recordId: string; fieldId: string; children: React.ReactNode }) {
  const { getFieldLink } = useCustomFields();
  const link = getFieldLink(recordId, fieldId);

  if (!link) return <>{children}</>;
  
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 min-w-0">{children}</div>
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-primary/10 text-primary transition-colors flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
        title="Open link"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

export function CustomFieldCell({ field, recordId, metricDisplay }: CustomFieldCellProps) {
  const { getFieldValue, setFieldValue } = useCustomFields();
  const value = getFieldValue(recordId, field.id);
  const [metricEditing, setMetricEditing] = useState(false);

  // For metric display: show formatted value, click to edit
  if (metricDisplay && !metricEditing) {
    return (
      <span
        className="cursor-pointer hover:text-primary transition-colors"
        onClick={() => setMetricEditing(true)}
      >
        {metricDisplay}
      </span>
    );
  }

  // If we were in metric editing mode and the underlying cell blurs, exit
  const wrapOnChange = (setter: (v: any) => void) => (v: any) => {
    setter(v);
    setMetricEditing(false);
  };

  switch (field.type) {
    case 'text':
      return (
        <EditableTextCell
          value={(value as string) || ''}
          onChange={(v) => setFieldValue(recordId, field.id, v)}
          emptyText="Add"
          placeholder={field.name}
        />
      );

    case 'long-text':
      return (
        <EditableTextareaCell
          value={(value as string) || ''}
          onChange={(v) => setFieldValue(recordId, field.id, v)}
          emptyText="Add"
          placeholder={field.name}
        />
      );

    case 'number':
      return (
        <EditableNumberCell
          value={(value as number) || 0}
          onChange={(v) => setFieldValue(recordId, field.id, v)}
          format="number"
        />
      );

    case 'currency':
      return (
        <EditableNumberCell
          value={(value as number) || 0}
          onChange={(v) => setFieldValue(recordId, field.id, v)}
          format="currency"
        />
      );

    case 'date':
      return (
        <EditableDatePicker
          value={(value as string) || undefined}
          onChange={(v) => setFieldValue(recordId, field.id, v || undefined)}
          placeholder="+ Add"
          compact
        />
      );

    case 'url':
      return (
        <EditableLinkCell
          value={(value as string) || ''}
          onChange={(v) => setFieldValue(recordId, field.id, v)}
          label="Link"
          addLabel={field.name}
        />
      );

    case 'picklist':
      const options = (field.picklistOptions || []).map(opt => ({
        value: opt,
        label: opt,
        className: 'bg-muted text-foreground',
      }));
      
      if (options.length === 0) {
        return (
          <EditableTextCell
            value={(value as string) || ''}
            onChange={(v) => setFieldValue(recordId, field.id, v)}
            emptyText="Add"
          />
        );
      }
      
      return (
        <DisplaySelectCell
          value={(value as string) || options[0]?.value || ''}
          options={options}
          onChange={(v) => setFieldValue(recordId, field.id, v)}
        />
      );

    case 'boolean': {
      const boolVal = String(value) === 'true' || value === 1;
      return (
        <span
          className="cursor-pointer select-none"
          onClick={() => setFieldValue(recordId, field.id, boolVal ? undefined : 'true')}
        >
          {boolVal ? (
            <span className="inline-flex items-center gap-1 text-xs text-status-green">✓ Yes</span>
          ) : (
            <span className="text-xs text-muted-foreground">+ Add</span>
          )}
        </span>
      );
    }

    default:
      return null;
  }
}

// Labeled custom field for expanded view - data under title, with link attachment
export function CustomFieldRow({ field, recordId }: CustomFieldCellProps) {
  const { getFieldValue, getFieldLink } = useCustomFields();
  const value = getFieldValue(recordId, field.id);
  const hasValue = value != null && value !== '' && value !== 0;
  const link = getFieldLink(recordId, field.id);

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <label className="text-xs font-medium text-muted-foreground">
          {field.name}
        </label>
        {/* Show link button when there's a value, or when a link already exists */}
        {(hasValue || link) && field.type !== 'url' && (
          <FieldLinkAttachment recordId={recordId} fieldId={field.id} />
        )}
      </div>
      {link && hasValue ? (
        <LinkedValue recordId={recordId} fieldId={field.id}>
          <CustomFieldCell field={field} recordId={recordId} />
        </LinkedValue>
      ) : (
        <CustomFieldCell field={field} recordId={recordId} />
      )}
    </div>
  );
}
