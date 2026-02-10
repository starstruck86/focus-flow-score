// Custom fields store - persisted Zustand store for user-defined columns
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CustomFieldType = 'text' | 'number' | 'currency' | 'date' | 'picklist' | 'url' | 'long-text' | 'boolean';
export type TabTarget = 'accounts' | 'renewals' | 'opportunities' | 'opportunities-newlogo' | 'opportunities-renewals';
export type FieldPlacement = 'summary' | 'expanded' | 'both';

export interface CustomFieldDefinition {
  id: string;
  name: string;
  type: CustomFieldType;
  tabTarget: TabTarget;
  placement: FieldPlacement;
  picklistOptions?: string[]; // For picklist type
  createdAt: string;
}

// Column visibility for built-in fields
export interface ColumnVisibility {
  [columnKey: string]: boolean;
}

// Custom field values per record
export interface CustomFieldValues {
  [recordId: string]: {
    [fieldId: string]: string | number | undefined;
  };
}

// Custom field links per record (optional URL attached to any field value)
export interface CustomFieldLinks {
  [recordId: string]: {
    [fieldId: string]: string | undefined;
  };
}

// Column order per tab (array of column keys in display order)
export interface ColumnOrder {
  [tabKey: string]: string[];
}

// Column display style per view (standard or metric)
export type ColumnDisplayStyle = 'standard' | 'metric';
export interface ColumnDisplayStyles {
  [viewKey: string]: {
    [columnKey: string]: ColumnDisplayStyle;
  };
}

interface CustomFieldsStore {
  // Field definitions
  fields: CustomFieldDefinition[];
  addField: (field: Omit<CustomFieldDefinition, 'id' | 'createdAt'>) => void;
  updateField: (id: string, updates: Partial<CustomFieldDefinition>) => void;
  deleteField: (id: string) => void;
  
  // Column visibility per tab
  columnVisibility: Record<TabTarget, ColumnVisibility>;
  setColumnVisible: (tab: TabTarget, columnKey: string, visible: boolean) => void;
  
  // Column ordering per tab
  columnOrder: ColumnOrder;
  setColumnOrder: (tab: string, order: string[]) => void;
  moveColumn: (tab: string, columnKey: string, direction: 'up' | 'down') => void;
  resetColumnOrder: (tab: string) => void;
  
  // Custom field values
  fieldValues: CustomFieldValues;
  setFieldValue: (recordId: string, fieldId: string, value: string | number | undefined) => void;
  getFieldValue: (recordId: string, fieldId: string) => string | number | undefined;
  
  // Custom field links (optional URL per field value)
  fieldLinks: CustomFieldLinks;
  setFieldLink: (recordId: string, fieldId: string, url: string | undefined) => void;
  getFieldLink: (recordId: string, fieldId: string) => string | undefined;
  
  // Column display styles (standard/metric) per view
  columnDisplayStyles: ColumnDisplayStyles;
  setColumnDisplayStyle: (viewKey: string, columnKey: string, style: ColumnDisplayStyle) => void;
  getColumnDisplayStyle: (viewKey: string, columnKey: string) => ColumnDisplayStyle;
  
  // Helpers
  getFieldsForTab: (tab: TabTarget, placement?: FieldPlacement) => CustomFieldDefinition[];
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export const useCustomFields = create<CustomFieldsStore>()(
  persist(
    (set, get) => ({
      fields: [],
      
      addField: (field) => {
        const newField: CustomFieldDefinition = {
          ...field,
          id: generateId(),
          createdAt: new Date().toISOString(),
        };
        set((state) => ({ fields: [...state.fields, newField] }));
      },
      
      updateField: (id, updates) => {
        set((state) => ({
          fields: state.fields.map(f => f.id === id ? { ...f, ...updates } : f),
        }));
      },
      
      deleteField: (id) => {
        set((state) => ({
          fields: state.fields.filter(f => f.id !== id),
          // Also clean up field values
          fieldValues: Object.fromEntries(
            Object.entries(state.fieldValues).map(([recordId, values]) => [
              recordId,
              Object.fromEntries(Object.entries(values).filter(([fId]) => fId !== id)),
            ])
          ),
        }));
      },
      
      columnVisibility: {
        accounts: {},
        renewals: {},
        opportunities: {},
        'opportunities-newlogo': {},
        'opportunities-renewals': {},
      },
      
      setColumnVisible: (tab, columnKey, visible) => {
        set((state) => ({
          columnVisibility: {
            ...state.columnVisibility,
            [tab]: {
              ...state.columnVisibility[tab],
              [columnKey]: visible,
            },
          },
        }));
      },
      
      columnOrder: {},
      
      setColumnOrder: (tab, order) => {
        set((state) => ({
          columnOrder: { ...state.columnOrder, [tab]: order },
        }));
      },
      
      moveColumn: (tab, columnKey, direction) => {
        set((state) => {
          const current = state.columnOrder[tab];
          if (!current) return state;
          const idx = current.indexOf(columnKey);
          if (idx === -1) return state;
          const newIdx = direction === 'up' ? idx - 1 : idx + 1;
          if (newIdx < 0 || newIdx >= current.length) return state;
          const newOrder = [...current];
          [newOrder[idx], newOrder[newIdx]] = [newOrder[newIdx], newOrder[idx]];
          return { columnOrder: { ...state.columnOrder, [tab]: newOrder } };
        });
      },
      
      resetColumnOrder: (tab) => {
        set((state) => {
          const newOrder = { ...state.columnOrder };
          delete newOrder[tab];
          return { columnOrder: newOrder };
        });
      },
      
      fieldValues: {},
      
      setFieldValue: (recordId, fieldId, value) => {
        set((state) => ({
          fieldValues: {
            ...state.fieldValues,
            [recordId]: {
              ...(state.fieldValues[recordId] || {}),
              [fieldId]: value,
            },
          },
        }));
      },
      
      getFieldValue: (recordId, fieldId) => {
        return get().fieldValues[recordId]?.[fieldId];
      },
      
      fieldLinks: {},
      
      setFieldLink: (recordId, fieldId, url) => {
        set((state) => ({
          fieldLinks: {
            ...state.fieldLinks,
            [recordId]: {
              ...(state.fieldLinks[recordId] || {}),
              [fieldId]: url,
            },
          },
        }));
      },
      
      getFieldLink: (recordId, fieldId) => {
        return get().fieldLinks[recordId]?.[fieldId];
      },
      
      columnDisplayStyles: {},
      
      setColumnDisplayStyle: (viewKey, columnKey, style) => {
        set((state) => ({
          columnDisplayStyles: {
            ...state.columnDisplayStyles,
            [viewKey]: {
              ...(state.columnDisplayStyles[viewKey] || {}),
              [columnKey]: style,
            },
          },
        }));
      },
      
      getColumnDisplayStyle: (viewKey, columnKey) => {
        return get().columnDisplayStyles[viewKey]?.[columnKey] || 'standard';
      },
      
      getFieldsForTab: (tab, placement) => {
        return get().fields.filter(f => {
          if (f.tabTarget !== tab) return false;
          if (placement && f.placement !== placement && f.placement !== 'both') return false;
          return true;
        });
      },
    }),
    {
      name: 'quota-compass-custom-fields',
    }
  )
);
