import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Flame, 
  Zap, 
  Target,
  Award,
  TrendingUp,
  Calendar
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { RingGauge } from '@/components/RingGauge';
import { DailyEntryForm } from '@/components/DailyEntryForm';
import { QuickActions } from '@/components/QuickActions';
import { FocusTimer } from '@/components/FocusTimer';
import { useStore } from '@/store/useStore';
import { getRecoveryAdvice, getStrainLabel } from '@/lib/calculations';
import { cn } from '@/lib/utils';

export default function Dashboard() {
  const { currentDay, initializeToday } = useStore();

  useEffect(() => {
    initializeToday();
  }, [initializeToday]);

  if (!currentDay) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-screen">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </Layout>
    );
  }

  const { scores } = currentDay;

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <Calendar className="h-4 w-4" />
            {new Date().toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </div>
          <h1 className="font-display text-3xl font-bold">Daily Performance</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Metrics */}
          <div className="lg:col-span-2 space-y-6">
            {/* Three Ring Gauges */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Strain Card */}
              <motion.div 
                className="metric-card-strain"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <Flame className="h-5 w-5 text-strain" />
                  <h3 className="font-display font-semibold">Strain</h3>
                </div>
                <div className="flex justify-center">
                  <RingGauge
                    value={scores.salesStrain}
                    max={21}
                    type="strain"
                    sublabel={getStrainLabel(scores.strainBand)}
                    size={140}
                  />
                </div>
                <div className="mt-4 space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Top Contributors</p>
                  {scores.strainContributors.slice(0, 3).map((c, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{c.name}</span>
                      <span className="text-strain font-medium">{c.value.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* Recovery Card */}
              <motion.div 
                className="metric-card-recovery"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="h-5 w-5 text-recovery" />
                  <h3 className="font-display font-semibold">Recovery</h3>
                </div>
                <div className="flex justify-center">
                  <RingGauge
                    value={scores.salesRecovery}
                    max={100}
                    type="recovery"
                    label="%"
                    size={140}
                  />
                </div>
                <div className="mt-4">
                  <p className={cn(
                    "text-xs p-2 rounded-lg",
                    scores.recoveryBand === 'green' && 'bg-status-green/10 text-status-green',
                    scores.recoveryBand === 'yellow' && 'bg-status-yellow/10 text-status-yellow',
                    scores.recoveryBand === 'red' && 'bg-status-red/10 text-status-red',
                  )}>
                    {getRecoveryAdvice(scores.recoveryBand)}
                  </p>
                </div>
              </motion.div>

              {/* Productivity Card */}
              <motion.div 
                className="metric-card-productivity"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <Target className="h-5 w-5 text-productivity" />
                  <h3 className="font-display font-semibold">Productivity</h3>
                </div>
                <div className="flex justify-center">
                  <RingGauge
                    value={scores.salesProductivity}
                    max={100}
                    type="productivity"
                    label="%"
                    size={140}
                  />
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Effort Quality</span>
                  <span className={cn(
                    "text-xs font-medium px-2 py-1 rounded",
                    scores.effortQuality === 'high' && 'bg-status-green/10 text-status-green',
                    scores.effortQuality === 'medium' && 'bg-status-yellow/10 text-status-yellow',
                    scores.effortQuality === 'low' && 'bg-status-red/10 text-status-red',
                  )}>
                    {scores.effortQuality.toUpperCase()}
                  </span>
                </div>
              </motion.div>
            </div>

            {/* Stats Row */}
            <motion.div 
              className="grid grid-cols-4 gap-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <div className="metric-card text-center">
                <div className="text-2xl font-display font-bold text-foreground">
                  {scores.dailyScore}
                </div>
                <div className="text-xs text-muted-foreground">Daily Score</div>
              </div>
              <div className="metric-card text-center">
                <div className="text-2xl font-display font-bold text-foreground">
                  {scores.weeklyAverage.toFixed(1)}
                </div>
                <div className="text-xs text-muted-foreground">Week Avg</div>
              </div>
              <div className="metric-card text-center">
                <div className="flex items-center justify-center gap-1">
                  <Award className={cn(
                    "h-5 w-5",
                    scores.goalMet ? "text-status-green" : "text-muted-foreground"
                  )} />
                  <span className={cn(
                    "text-2xl font-display font-bold",
                    scores.goalMet ? "text-status-green" : "text-foreground"
                  )}>
                    {scores.goalMet ? '✓' : '—'}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">Goal Met</div>
              </div>
              <div className="metric-card text-center">
                <div className="flex items-center justify-center gap-1">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  <span className="text-2xl font-display font-bold">
                    {scores.streak}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">Day Streak</div>
              </div>
            </motion.div>

            {/* Focus Timer - Full */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              <FocusTimer />
            </motion.div>
          </div>

          {/* Right Column - Entry Form */}
          <div className="space-y-6">
            <QuickActions />
            <DailyEntryForm />
          </div>
        </div>
      </div>
    </Layout>
  );
}
