import { Component, ErrorInfo, ReactNode, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { StrategyShell } from '@/components/strategy/v2/StrategyShell';

class StrategyErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Strategy crash]', error.message, error.stack, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6 space-y-4 max-w-2xl mx-auto">
          <h2 className="text-lg font-bold text-destructive">Strategy crashed</h2>
          <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-4 space-y-2">
            <p className="text-sm font-semibold text-destructive">{this.state.error.message}</p>
            <pre className="text-[11px] text-muted-foreground overflow-auto max-h-64 whitespace-pre-wrap">
              {this.state.error.stack}
            </pre>
          </div>
          <button
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm"
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Strategy() {
  return (
    <Layout>
      <StrategyErrorBoundary>
        <StrategyShell />
      </StrategyErrorBoundary>
    </Layout>
  );
}
