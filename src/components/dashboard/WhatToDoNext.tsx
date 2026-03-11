// What To Do Next - Actionable Recommendations with click-to-act
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Lightbulb, Zap, Phone, Users, RefreshCw, CheckSquare, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { ActionRecommendation } from '@/lib/salesAgeCalculations';

interface WhatToDoNextProps {
  recommendations: ActionRecommendation[];
  isLoading?: boolean;
}

const workflowIcons: Record<string, React.ElementType> = {
  'power-hour': Phone,
  'Power Hour': Phone,
  'tasks': CheckSquare,
  'Tasks': CheckSquare,
  'renewals': RefreshCw,
  'Renewals': RefreshCw,
  'outreach': Users,
  'Outreach': Users,
  'pipeline': Zap,
  'Pipeline': Zap,
  'Daily Check-In': CheckSquare,
};

const workflowColors: Record<string, string> = {
  'power-hour': 'bg-destructive/10 text-destructive border-destructive/20',
  'Power Hour': 'bg-destructive/10 text-destructive border-destructive/20',
  'tasks': 'bg-primary/10 text-primary border-primary/20',
  'Tasks': 'bg-primary/10 text-primary border-primary/20',
  'renewals': 'bg-accent/50 text-accent-foreground border-accent',
  'Renewals': 'bg-accent/50 text-accent-foreground border-accent',
  'outreach': 'bg-primary/10 text-primary border-primary/20',
  'Outreach': 'bg-primary/10 text-primary border-primary/20',
  'pipeline': 'bg-primary/10 text-primary border-primary/20',
  'Pipeline': 'bg-primary/10 text-primary border-primary/20',
  'Daily Check-In': 'bg-muted text-muted-foreground border-border',
};

const workflowLabels: Record<string, string> = {
  'power-hour': 'Power Hour',
  'Power Hour': 'Power Hour',
  'tasks': 'Tasks',
  'Tasks': 'Tasks',
  'renewals': 'Renewals',
  'Renewals': 'Renewals',
  'outreach': 'Outreach',
  'Outreach': 'Outreach',
  'pipeline': 'Pipeline',
  'Pipeline': 'Pipeline',
  'Daily Check-In': 'Check-In',
};

// Map workflow names to navigation targets
const workflowRoutes: Record<string, string> = {
  'power-hour': '/tasks',
  'Power Hour': '/tasks',
  'tasks': '/tasks',
  'Tasks': '/tasks',
  'renewals': '/renewals',
  'Renewals': '/renewals',
  'outreach': '/outreach',
  'Outreach': '/outreach',
  'pipeline': '/quota',
  'Pipeline': '/quota',
  'Daily Check-In': '/',
};

export function WhatToDoNext({ recommendations, isLoading }: WhatToDoNextProps) {
  const navigate = useNavigate();

  const handleAction = (rec: ActionRecommendation) => {
    const route = workflowRoutes[rec.workflow];
    if (rec.workflow === 'power-hour') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    } else if (route) {
      navigate(route);
    }
  };

  if (isLoading) {
    return (
      <motion.div 
        className="metric-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="h-5 w-5 text-primary" />
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
          <Lightbulb className="h-5 w-5 text-primary" />
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
        <Lightbulb className="h-5 w-5 text-primary" />
        <h3 className="font-display font-semibold">What To Do Next</h3>
        <span className="text-xs text-muted-foreground ml-auto">
          {recommendations.length} action{recommendations.length !== 1 ? 's' : ''}
        </span>
      </div>
      
      <div className="space-y-3">
        {recommendations.map((rec, index) => {
          const WorkflowIcon = workflowIcons[rec.workflow] || Zap;
          const colorClass = workflowColors[rec.workflow] || 'bg-muted text-muted-foreground border-border';
          const label = workflowLabels[rec.workflow] || rec.workflow;
          
          return (
            <motion.button 
              key={rec.id}
              onClick={() => handleAction(rec)}
              className="w-full text-left p-4 rounded-lg border bg-card hover:shadow-md hover:border-primary/30 transition-all group"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 * index }}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  "p-2 rounded-lg border shrink-0",
                  colorClass
                )}>
                  <WorkflowIcon className="h-4 w-4" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h4 className="font-medium text-sm leading-tight">{rec.action}</h4>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded-full whitespace-nowrap",
                        colorClass
                      )}>
                        {label}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                  
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p><span className="font-medium">Target:</span> {rec.target}</p>
                    <p className="text-primary font-medium">
                      <Zap className="h-3 w-3 inline mr-1" />
                      {rec.impact}
                    </p>
                  </div>
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}
