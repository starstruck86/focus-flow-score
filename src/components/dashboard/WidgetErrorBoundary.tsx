import { Component, ErrorInfo, ReactNode } from 'react';
import { normalizeError, recordError } from '@/lib/appError';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface Props {
  widgetId: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class WidgetErrorBoundary extends Component<Props, State> {
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
      componentName: `Widget:${this.props.widgetId}`,
      route: window.location.pathname,
      metadata: { componentStack: errorInfo.componentStack?.slice(0, 500) },
    });
    recordError(appError);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-muted-foreground">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-destructive">Widget failed to load</p>
              <p className="mt-1 text-xs">{this.state.error?.message}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={this.handleRetry} className="shrink-0">
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Retry
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
