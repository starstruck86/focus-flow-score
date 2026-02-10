// Renders a custom field value with display-first behavior, matching the field type
import { useState } from 'react';
import { EditableTextCell, EditableTextareaCell, EditableNumberCell } from './EditableCell';
import { EditableLinkCell } from './EditableLinkCell';
import { DisplaySelectCell } from './DisplaySelectCell';
import { EditableDatePicker } from '@/components/EditableDatePicker';
import { useCustomFields, type CustomFieldDefinition } from '@/hooks/useCustomFields';

interface CustomFieldCellProps {
  field: CustomFieldDefinition;
  recordId: string;
}

export function CustomFieldCell({ field, recordId }: CustomFieldCellProps) {
  const { getFieldValue, setFieldValue } = useCustomFields();
  const value = getFieldValue(recordId, field.id);

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

// Labeled custom field for expanded view
export function CustomFieldRow({ field, recordId }: CustomFieldCellProps) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">
        {field.name}
      </label>
      <CustomFieldCell field={field} recordId={recordId} />
    </div>
  );
}
