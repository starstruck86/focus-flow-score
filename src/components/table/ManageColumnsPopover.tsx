// Manage Columns popover - show/hide columns + add custom fields + column reorder
import { useState, useMemo } from 'react';
import { Settings2, Plus, Trash2, ArrowUp, ArrowDown, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  useCustomFields,
  type TabTarget,
  type CustomFieldType,
  type FieldPlacement,
  type ColumnDisplayStyle,
} from '@/hooks/useCustomFields';

interface BuiltInColumn {
  key: string;
  label: string;
  defaultVisible?: boolean;
}

interface ManageColumnsPopoverProps {
  tabTarget: TabTarget;
  builtInColumns: BuiltInColumn[];
  /** Unique key for per-view column order persistence. Defaults to tabTarget. */
  viewKey?: string;
}

const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  number: 'Number',
  currency: 'Currency',
  date: 'Date',
  picklist: 'Picklist',
  url: 'URL',
  'long-text': 'Long Text',
  boolean: 'Boolean',
};

const PLACEMENT_LABELS: Record<FieldPlacement, string> = {
  summary: 'Summary Table',
  expanded: 'Expanded Details',
  both: 'Both',
};

export function ManageColumnsPopover({ tabTarget, builtInColumns, viewKey }: ManageColumnsPopoverProps) {
  const orderKey = viewKey || tabTarget;
  const { fields, addField, deleteField, columnVisibility, setColumnVisible, columnOrder, setColumnOrder, moveColumn, resetColumnOrder, getColumnDisplayStyle, setColumnDisplayStyle } = useCustomFields();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<CustomFieldType>('text');
  const [newFieldPlacement, setNewFieldPlacement] = useState<FieldPlacement>('expanded');
  const [newPicklistOptions, setNewPicklistOptions] = useState('');
  const [activeTab, setActiveTab] = useState<'visibility' | 'order'>('visibility');

  const tabFields = fields.filter(f => f.tabTarget === tabTarget);
  // Custom fields that appear in summary table (for reorder tab)
  const summaryCustomFields = tabFields.filter(f => f.placement === 'summary' || f.placement === 'both');
  const tabVisibility = columnVisibility[tabTarget] || {};

  const isColumnVisible = (key: string, defaultVisible = true) => {
    return tabVisibility[key] ?? defaultVisible;
  };

  // Get ordered columns for reorder view (built-in + custom fields)
  const orderedColumns = useMemo(() => {
    const builtInKeys = builtInColumns.map(c => c.key);
    const customKeys = summaryCustomFields.map(f => `custom:${f.id}`);
    const allKeys = [...builtInKeys, ...customKeys];
    const savedOrder = columnOrder[orderKey];
    if (!savedOrder) return allKeys;
    const validKeys = new Set(allKeys);
    const ordered = savedOrder.filter(k => validKeys.has(k));
    const missing = allKeys.filter(k => !ordered.includes(k));
    return [...ordered, ...missing];
  }, [builtInColumns, summaryCustomFields, columnOrder, orderKey]);

  const handleAddField = () => {
    if (!newFieldName.trim()) {
      toast.error('Field name is required');
      return;
    }
    
    addField({
      name: newFieldName.trim(),
      type: newFieldType,
      tabTarget,
      placement: newFieldPlacement,
      picklistOptions: newFieldType === 'picklist' 
        ? newPicklistOptions.split(',').map(o => o.trim()).filter(Boolean)
        : undefined,
    });
    
    toast.success(`Added "${newFieldName.trim()}" field`);
    setNewFieldName('');
    setNewFieldType('text');
    setNewFieldPlacement('expanded');
    setNewPicklistOptions('');
    setShowAddForm(false);
  };

  const handleMoveColumn = (key: string, direction: 'up' | 'down') => {
    if (!columnOrder[orderKey]) {
      setColumnOrder(orderKey, orderedColumns);
      setTimeout(() => moveColumn(orderKey, key, direction), 0);
    } else {
      moveColumn(orderKey, key, direction);
    }
  };

  const handleResetOrder = () => {
    resetColumnOrder(orderKey);
    toast.success('Column order reset to default');
  };

  const getColumnLabel = (key: string) => {
    if (key.startsWith('custom:')) {
      const fieldId = key.slice(7);
      const field = summaryCustomFields.find(f => f.id === fieldId);
      return field ? `${field.name} ✦` : key;
    }
    return builtInColumns.find(c => c.key === key)?.label || key;
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Settings2 className="h-3.5 w-3.5" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-3 border-b">
          <h4 className="text-sm font-medium">Manage Columns</h4>
          <p className="text-xs text-muted-foreground mt-0.5">Show/hide, reorder, or add custom fields</p>
          {/* Tab switcher */}
          <div className="flex gap-1 mt-2">
            <Button
              variant={activeTab === 'visibility' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 text-[10px] flex-1"
              onClick={() => setActiveTab('visibility')}
            >
              Show/Hide
            </Button>
            <Button
              variant={activeTab === 'order' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 text-[10px] flex-1"
              onClick={() => setActiveTab('order')}
            >
              Reorder
            </Button>
          </div>
        </div>
        
        {activeTab === 'visibility' ? (
          <>
            {/* Built-in columns */}
            <div className="p-2 max-h-[300px] overflow-y-auto">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-2 py-1">
                Built-in Columns
              </p>
              {builtInColumns.map(col => (
                <div key={col.key} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted/50">
                  <span className="text-sm">{col.label}</span>
                  <Switch
                    checked={isColumnVisible(col.key, col.defaultVisible !== false)}
                    onCheckedChange={(checked) => setColumnVisible(tabTarget, col.key, checked)}
                    className="scale-75"
                  />
                </div>
              ))}
              
              {/* Custom fields */}
              {tabFields.length > 0 && (
                <>
                  <Separator className="my-2" />
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-2 py-1">
                    Custom Fields
                  </p>
                  {tabFields.map(field => (
                    <div key={field.id} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted/50">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm block truncate">{field.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {FIELD_TYPE_LABELS[field.type]} • {PLACEMENT_LABELS[field.placement]}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          deleteField(field.id);
                          toast.success(`Removed "${field.name}"`);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </>
              )}
            </div>
            
            <Separator />
            
            {/* Add Custom Field */}
            {showAddForm ? (
              <div className="p-3 space-y-2.5">
                <div>
                  <Label className="text-xs">Field Name</Label>
                  <Input
                    value={newFieldName}
                    onChange={(e) => setNewFieldName(e.target.value)}
                    placeholder="e.g. Decision Maker"
                    className="h-8 text-sm mt-1"
                    autoFocus
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Type</Label>
                    <Select value={newFieldType} onValueChange={(v) => setNewFieldType(v as CustomFieldType)}>
                      <SelectTrigger className="h-8 text-sm mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Show In</Label>
                    <Select value={newFieldPlacement} onValueChange={(v) => setNewFieldPlacement(v as FieldPlacement)}>
                      <SelectTrigger className="h-8 text-sm mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(PLACEMENT_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {newFieldType === 'picklist' && (
                  <div>
                    <Label className="text-xs">Options (comma-separated)</Label>
                    <Input
                      value={newPicklistOptions}
                      onChange={(e) => setNewPicklistOptions(e.target.value)}
                      placeholder="Option 1, Option 2, Option 3"
                      className="h-8 text-sm mt-1"
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs flex-1" onClick={handleAddField}>
                    Add Field
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAddForm(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-8 text-xs justify-start gap-1.5 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowAddForm(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Custom Field
                </Button>
              </div>
            )}
          </>
        ) : (
          /* Column reorder tab */
          <div className="p-2 max-h-[350px] overflow-y-auto">
            <div className="flex items-center justify-between px-2 py-1 mb-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Column Order
              </p>
              <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={handleResetOrder}>
                <RotateCcw className="h-3 w-3" />
                Reset
              </Button>
            </div>
            {orderedColumns.map((key, idx) => (
              <div key={key} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/50">
                <span className="text-[10px] text-muted-foreground w-4 text-center">{idx + 1}</span>
                <span className="text-sm flex-1">{getColumnLabel(key)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={idx === 0}
                  onClick={() => handleMoveColumn(key, 'up')}
                >
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={idx === orderedColumns.length - 1}
                  onClick={() => handleMoveColumn(key, 'down')}
                >
                  <ArrowDown className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground px-2 mt-2">
              Use arrows to reorder columns. Changes persist automatically.
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
