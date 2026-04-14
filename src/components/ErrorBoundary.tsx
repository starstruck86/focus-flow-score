import { Component, ErrorInfo, ReactNode } from 'react';
import { useStore } from '@/store/useStore';
import { normalizeError, recordError } from '@/lib/appError';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const appError = normalizeError({
      error,
      source: 'frontend',
      componentName: 'ErrorBoundary',
      route: window.location.pathname,
      metadata: { componentStack: errorInfo.componentStack?.slice(0, 1000) },
    });
    recordError(appError);
    console.error('App crash:', error, errorInfo);
  }

  handleExportData = () => {
    try {
      const state = useStore.getState();
      const exportData = {
        exportedAt: new Date().toISOString(),
        accounts: state.accounts,
        opportunities: state.opportunities,
        renewals: state.renewals,
        contacts: state.contacts,
        tasks: state.tasks,
        days: state.days,
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quota-compass-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen pt-[env(safe-area-inset-top)] flex flex-col items-center justify-center gap-4 bg-background px-4 text-center">
          <h1 className="text-2xl font-bold font-display text-foreground">Quota CoPilot</h1>
          <p className="text-sm text-muted-foreground">Something went wrong.</p>
          <div className="flex gap-3">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
            >
              Reload App
            </button>
            <button
              onClick={this.handleExportData}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Export My Data
            </button>
          </div>
          <p className="text-xs text-muted-foreground max-w-md">
            Your data is safely stored. Click "Export My Data" to download a backup before reloading.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
