import { Layout } from '@/components/Layout';
import { DollarSign, TrendingUp, Award } from 'lucide-react';

export default function Quota() {
  return (
    <Layout>
      <div className="p-6 lg:p-8">
        <div className="mb-8">
          <h1 className="font-display text-2xl font-bold">Quota & Compensation</h1>
          <p className="text-sm text-muted-foreground">Track attainment and earnings</p>
        </div>

        <div className="metric-card text-center py-16">
          <div className="flex items-center justify-center gap-4 mb-6">
            <DollarSign className="h-12 w-12 text-status-green" />
            <TrendingUp className="h-12 w-12 text-primary" />
            <Award className="h-12 w-12 text-status-yellow" />
          </div>
          <h2 className="font-display text-xl font-semibold mb-2">Coming Soon</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Quota tracking, deal logging, and commission calculations based on your comp plan 
            will be available here.
          </p>
        </div>
      </div>
    </Layout>
  );
}
