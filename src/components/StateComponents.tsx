/**
 * Standardized loading / empty / error state components.
 * Drop these into any page or section for consistent UX.
 */

import { Loader2, RefreshCw, Inbox, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AppError } from '@/lib/appError';

// ── Loading ──────────────────────────────────────────────────

interface LoadingStateProps {
  message?: string;
  className?: string;
  /** 'page' renders centered fullish; 'inline' renders compact */
  variant?: 'page' | 'inline';
}

export function LoadingState({ message = 'Loading…', className, variant = 'page' }: LoadingStateProps) {
  if (variant === 'inline') {
    return (
      <div className={cn('flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center', className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{message}</span>
      </div>
    );
  }
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 gap-3', className)}>
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

// ── Empty ────────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({
  icon,
  title = 'Nothing here yet',
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 gap-3 text-center px-4', className)}>
      <div className="h-10 w-10 rounded-full bg-muted/50 flex items-center justify-center text-muted-foreground">
        {icon || <Inbox className="h-5 w-5" />}
      </div>
      <div>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground mt-1 max-w-xs">{description}</p>}
      </div>
      {action && (
        <Button variant="outline" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

// ── Error ────────────────────────────────────────────────────

interface ErrorStateProps {
  error?: AppError | Error | string | null;
  title?: string;
  onRetry?: () => void;
  className?: string;
  /** 'page' renders centered; 'inline' renders compact */
  variant?: 'page' | 'inline';
}

export function ErrorState({
  error,
  title = 'Something went wrong',
  onRetry,
  className,
  variant = 'page',
}: ErrorStateProps) {
  const message = error
    ? typeof error === 'string'
      ? error
      : 'message' in error
        ? error.message
        : 'An unexpected error occurred'
    : 'An unexpected error occurred';

  const retryable = error && typeof error === 'object' && 'retryable' in error ? (error as AppError).retryable : !!onRetry;
  const traceId = error && typeof error === 'object' && 'traceId' in error ? (error as AppError).traceId : null;

  if (variant === 'inline') {
    return (
      <div className={cn('flex items-center gap-2 text-sm py-3 px-3 rounded-lg border border-destructive/30 bg-destructive/5', className)}>
        <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
        <span className="text-muted-foreground flex-1 min-w-0 truncate">{message}</span>
        {retryable && onRetry && (
          <Button variant="ghost" size="sm" onClick={onRetry} className="shrink-0 h-7">
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col items-center justify-center py-16 gap-3 text-center px-4', className)}>
      <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
        <AlertTriangle className="h-5 w-5 text-destructive" />
      </div>
      <div>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">{message}</p>
        {traceId && <p className="text-[10px] text-muted-foreground/60 mt-1 font-mono">Trace: {traceId}</p>}
      </div>
      {retryable && onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Try Again
        </Button>
      )}
    </div>
  );
}
