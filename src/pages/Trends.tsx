import { Layout } from '@/components/Layout';
import { TrendingUp, BarChart3, LineChart } from 'lucide-react';

export default function Trends() {
  return (
    <Layout>
      <div className="p-6 lg:p-8">
        <div className="mb-8">
          <h1 className="font-display text-2xl font-bold">Trends & Insights</h1>
          <p className="text-sm text-muted-foreground">Performance analytics over time</p>
        </div>

        <div className="metric-card text-center py-16">
          <div className="flex items-center justify-center gap-4 mb-6">
            <BarChart3 className="h-12 w-12 text-strain" />
            <LineChart className="h-12 w-12 text-recovery" />
            <TrendingUp className="h-12 w-12 text-productivity" />
          </div>
          <h2 className="font-display text-xl font-semibold mb-2">Coming Soon</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Trend analysis, lagged correlations, and performance insights will be available 
            once you've logged a few days of activity.
          </p>
        </div>
      </div>
    </Layout>
  );
}
