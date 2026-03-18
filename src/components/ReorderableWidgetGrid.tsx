// Reusable drag-and-drop widget grid using framer-motion Reorder
// Used across all pages for consistent modular widget reordering
import { Reorder } from 'framer-motion';
import { GripVertical } from 'lucide-react';
import { WidgetErrorBoundary } from '@/components/dashboard/WidgetErrorBoundary';
import { WidgetCustomizer } from '@/components/dashboard/WidgetCustomizer';
import { useWidgetLayout, type WidgetConfig } from '@/hooks/useWidgetLayout';

interface ReorderableWidgetGridProps {
  pageId: string;
  defaultWidgets: WidgetConfig[];
  renderWidget: (widgetId: string) => React.ReactNode;
  /** Optional title for the customizer popover */
  customizerTitle?: string;
  /** Show the customizer button inline? If false, returns it for external placement */
  showCustomizer?: boolean;
}

export function ReorderableWidgetGrid({
  pageId,
  defaultWidgets,
  renderWidget,
  customizerTitle,
  showCustomizer = false,
}: ReorderableWidgetGridProps) {
  const {
    widgets,
    visibleWidgets,
    visibleWidgetIds,
    toggleWidget,
    moveWidget,
    reorderVisibleIds,
    resetWidgets,
  } = useWidgetLayout(pageId, defaultWidgets);

  return (
    <div className="space-y-4">
      {showCustomizer && (
        <div className="flex justify-end">
          <WidgetCustomizer
            widgets={widgets}
            onToggle={toggleWidget}
            onMove={moveWidget}
            onReset={resetWidgets}
          />
        </div>
      )}
      <Reorder.Group
        axis="y"
        values={visibleWidgetIds}
        onReorder={reorderVisibleIds}
        className="space-y-4"
      >
        {visibleWidgets.map((widget) => (
          <Reorder.Item
            key={widget.id}
            value={widget.id}
            className="relative group list-none"
            whileDrag={{ scale: 1.02, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', zIndex: 50 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            <div className="absolute -left-3 top-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
              <div className="bg-muted/80 backdrop-blur-sm rounded-md p-1">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
            <WidgetErrorBoundary widgetId={widget.id}>
              {renderWidget(widget.id)}
            </WidgetErrorBoundary>
          </Reorder.Item>
        ))}
      </Reorder.Group>
    </div>
  );
}

/**
 * Hook variant: use when you need more control over layout
 * (e.g., customizer placed in a header, or widgets rendered in a custom grid)
 */
export function useReorderableWidgets(pageId: string, defaultWidgets: WidgetConfig[]) {
  return useWidgetLayout(pageId, defaultWidgets);
}
