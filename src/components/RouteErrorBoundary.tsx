import { Component, ErrorInfo, ReactNode } from 'react';
import { normalizeError, recordError } from '@/lib/appError';
import { Button } from '@/components/ui/button';
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  routeName: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  showDetails: boolean;
}

export class RouteErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, showDetails: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const appError = normalizeError({
      error,
      source: 'frontend',
      componentName: this.props.routeName,
      route: window.location.pathname,
      metadata: { componentStack: errorInfo.componentStack?.slice(0, 1000) },
    });
    recordError(appError);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, showDetails: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-6 text-center">
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 max-w-lg w-full space-y-3">
            <h2 className="text-lg font-semibold text-foreground">
              Something went wrong in {this.props.routeName}
            </h2>
            <p className="text-sm text-muted-foreground">
              This section crashed but the rest of the app is still working.
            </p>
            <div className="flex gap-2 justify-center">
              <Button variant="default" size="sm" onClick={this.handleRetry}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Retry
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => this.setState(s => ({ showDetails: !s.showDetails }))}
              >
                {this.state.showDetails ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
                Details
              </Button>
            </div>
            {this.state.showDetails && this.state.error && (
              <pre className="mt-3 text-left text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 overflow-auto max-h-40">
                {this.state.error.message}
                {'\n\n'}
                {this.state.error.stack?.slice(0, 800)}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
