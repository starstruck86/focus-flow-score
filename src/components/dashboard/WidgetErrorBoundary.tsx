import { Component, ErrorInfo, ReactNode } from 'react';

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
    console.error(`[Widget "${this.props.widgetId}" crashed]`, error.message, errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-destructive">Widget failed to load</p>
          <p className="mt-1 text-xs">{this.state.error?.message}</p>
        </div>
      );
    }

    return this.props.children;
  }
}
