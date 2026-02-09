// What To Do Next - Actionable Recommendations
import { motion } from 'framer-motion';
import { Lightbulb, Zap, Phone, Users, RefreshCw, CheckSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { ActionRecommendation } from '@/lib/salesAgeCalculations';

interface WhatToDoNextProps {
  recommendations: ActionRecommendation[];
  isLoading?: boolean;
}

const workflowIcons = {
  'power-hour': Phone,
  'tasks': CheckSquare,
  'renewals': RefreshCw,
  'outreach': Users,
};

const workflowColors = {
  'power-hour': 'bg-status-red/10 text-status-red border-status-red/20',
  'tasks': 'bg-primary/10 text-primary border-primary/20',
  'renewals': 'bg-status-yellow/10 text-status-yellow border-status-yellow/20',
  'outreach': 'bg-status-green/10 text-status-green border-status-green/20',
};

const workflowLabels = {
  'power-hour': 'Power Hour',
  'tasks': 'Tasks',
  'renewals': 'Renewals',
  'outreach': 'Outreach',
};

export function WhatToDoNext({ recommendations, isLoading }: WhatToDoNextProps) {
  if (isLoading) {
    return (
      <motion.div 
        className="metric-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="h-5 w-5 text-status-yellow" />
          <h3 className="font-display font-semibold">What To Do Next</h3>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mb-2" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </div>
          ))}
        </div>
      </motion.div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <motion.div 
        className="metric-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="h-5 w-5 text-status-yellow" />
          <h3 className="font-display font-semibold">What To Do Next</h3>
        </div>
        <div className="text-center py-6 text-muted-foreground">
          <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Complete your Daily Check-In to get personalized recommendations</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      className="metric-card p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Lightbulb className="h-5 w-5 text-status-yellow" />
        <h3 className="font-display font-semibold">What To Do Next</h3>
        <span className="text-xs text-muted-foreground ml-auto">
          {recommendations.length} action{recommendations.length !== 1 ? 's' : ''}
        </span>
      </div>
      
      <div className="space-y-4">
        {recommendations.map((rec, index) => {
          const WorkflowIcon = workflowIcons[rec.workflow];
          
          return (
            <motion.div 
              key={rec.id}
              className="p-4 rounded-lg border bg-card hover:shadow-sm transition-shadow"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 * index }}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  "p-2 rounded-lg border",
                  workflowColors[rec.workflow]
                )}>
                  <WorkflowIcon className="h-4 w-4" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h4 className="font-medium text-sm leading-tight">{rec.action}</h4>
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full whitespace-nowrap",
                      workflowColors[rec.workflow]
                    )}>
                      {workflowLabels[rec.workflow]}
                    </span>
                  </div>
                  
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p><span className="font-medium">Target:</span> {rec.target}</p>
                    <p><span className="font-medium">Timeframe:</span> {rec.timeframe}</p>
                    <p><span className="font-medium">Why:</span> {rec.why}</p>
                    <p className="text-primary font-medium">
                      <Zap className="h-3 w-3 inline mr-1" />
                      {rec.impact}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
