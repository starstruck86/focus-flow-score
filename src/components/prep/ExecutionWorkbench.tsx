import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Zap, Target, BookOpen, AlertTriangle, 
  Play, FileText, CheckCircle,
  TrendingUp, Mic
} from 'lucide-react';
import { isSystemOSEnabled, isVoiceOSEnabled } from '@/lib/featureFlags';
import { getExecutionContext, type ExecutionDeal, type RiskSignal } from '@/lib/workflowOrchestrator';
import { useLiveSystemSummary } from '@/hooks/useSystemState';
import { useCopilot } from '@/contexts/CopilotContext';
import { useVoiceOperatingContext } from '@/hooks/useVoiceOperatingContext';
import { CapabilityPromptCard } from './CapabilityPromptCard';
import type { CapabilityContext } from '@/lib/capabilityEngine';

interface ExecutionWorkbenchProps {
  deals?: ExecutionDeal[];
  playbooks?: { id: string; title: string; problemType: string; confidence: number }[];
  riskSignals?: RiskSignal[];
}

export function ExecutionWorkbench({ deals = [], playbooks = [], riskSignals = [] }: ExecutionWorkbenchProps) {
  const { ask: askCopilot } = useCopilot();
  const context = useMemo(() => getExecutionContext(deals, playbooks, riskSignals), [deals, playbooks, riskSignals]);
  const systemSummary = useLiveSystemSummary();
  const voiceOS = isVoiceOSEnabled();
  const { context: voiceCtx } = useVoiceOperatingContext();

  if (!isSystemOSEnabled()) return null;

  const healthDotColor = systemSummary.health === 'healthy' 
    ? 'bg-primary' 
    : systemSummary.health === 'degraded' 
    ? 'bg-amber-500' 
    : 'bg-destructive';

  return (
    <div data-testid="execution-workbench" className="space-y-3">
      {/* System Status Bar — only when NOT healthy */}
      {systemSummary.health !== 'healthy' && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 rounded-lg">
          <div className={`h-2 w-2 rounded-full ${healthDotColor}`} />
          <span className="text-xs text-muted-foreground">{systemSummary.recommendation}</span>
          <Badge variant="outline" className="text-[10px] ml-auto">
            {systemSummary.mode} · {systemSummary.confidence}%
          </Badge>
        </div>
      )}

      {/* Voice OS Context — UI safety net */}
      {voiceOS && (voiceCtx.currentDeal || voiceCtx.pendingAction || voiceCtx.chainedWorkflow) && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/5 rounded-lg border border-primary/10">
          <Mic className="h-3 w-3 text-primary" />
          <div className="flex-1 flex items-center gap-2 text-[10px] text-muted-foreground overflow-hidden">
            {voiceCtx.currentDeal && (
              <span className="truncate">Deal: <span className="text-foreground font-medium">{voiceCtx.currentDeal.name}</span></span>
            )}
            {voiceCtx.pendingAction && (
              <Badge variant="outline" className="text-[9px] shrink-0">Pending: {voiceCtx.pendingAction.tool.replace(/_/g, ' ')}</Badge>
            )}
            {voiceCtx.chainedWorkflow && (
              <Badge variant="outline" className="text-[9px] shrink-0">
                Chain {voiceCtx.chainedWorkflow.currentStep + 1}/{voiceCtx.chainedWorkflow.steps.length}
              </Badge>
            )}
          </div>
        </div>
      )}

      {context.topDeals.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              Right Now
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-2">
            {context.topDeals.map(deal => (
              <div key={deal.id} className="flex items-start gap-2 p-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium truncate">{deal.name}</p>
                    <Badge variant="secondary" className="text-[9px] shrink-0">{deal.stage}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{deal.nextAction}</p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[10px] font-medium text-primary">{deal.urgency}%</span>
                  <p className="text-[9px] text-muted-foreground">${deal.arrK}K</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Next Best Action */}
      {context.nextBestAction && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-3">
            <div className="flex items-start gap-2">
              <Target className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">{context.nextBestAction.action}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{context.nextBestAction.reasoning}</p>
                <p className="text-[10px] text-destructive mt-1">⏱ {context.nextBestAction.consequenceOfDelay}</p>
              </div>
              <Badge className="text-[9px] shrink-0">{context.nextBestAction.confidence}%</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recommended Playbook */}
      {context.recommendedPlaybook && (
        <Card>
          <CardContent className="p-3">
            <div className="flex items-start gap-2">
              <BookOpen className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">{context.recommendedPlaybook.playbookTitle}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{context.recommendedPlaybook.explanation}</p>
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                  Risk if ignored: {context.recommendedPlaybook.riskIfIgnored}
                </p>
              </div>
            </div>
            <div className="flex gap-1.5 mt-2">
              <Button size="sm" variant="outline" className="h-6 text-[10px]"
                onClick={() => askCopilot(`Start a roleplay using the "${context.recommendedPlaybook!.playbookTitle}" playbook`, 'deal-strategy')}>
                <Play className="h-3 w-3 mr-1" /> Practice
              </Button>
              <Button size="sm" variant="outline" className="h-6 text-[10px]"
                onClick={() => askCopilot(`Apply the "${context.recommendedPlaybook!.playbookTitle}" playbook to my current deal`, 'deal-strategy')}>
                <CheckCircle className="h-3 w-3 mr-1" /> Apply
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Coach Nudge */}
      {context.coachNudge && (
        <Card className="bg-accent/5 border-accent/30">
          <CardContent className="p-3">
            <div className="flex items-start gap-2">
              <TrendingUp className="h-4 w-4 text-accent-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs">{context.coachNudge.message}</p>
                <Badge variant="outline" className="text-[9px] mt-1">{context.coachNudge.skillFocus}</Badge>
              </div>
              {context.coachNudge.practiceCTA && (
                <Button size="sm" variant="ghost" className="h-6 text-[10px] shrink-0"
                  onClick={() => askCopilot(`Practice ${context.coachNudge!.skillFocus} scenarios`, 'deal-strategy')}>
                  <Play className="h-3 w-3 mr-1" /> Practice
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Risk Monitor */}
      {context.riskSignals.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              Risk Monitor
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-1.5">
            {context.riskSignals.map((signal, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  signal.severity === 'high' ? 'bg-destructive' : signal.severity === 'medium' ? 'bg-amber-500' : 'bg-muted-foreground'
                }`} />
                <span className="text-muted-foreground">{signal.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Fast Actions */}
      <div className="flex gap-1.5 flex-wrap">
        <Button size="sm" variant="outline" className="h-7 text-[10px]"
          onClick={() => askCopilot('Start a practice roleplay for my most urgent deal', 'deal-strategy')}>
          <Play className="h-3 w-3 mr-1" /> Practice
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-[10px]"
          onClick={() => askCopilot('Draft a follow-up email for my latest call', 'recap-email')}>
          <FileText className="h-3 w-3 mr-1" /> Draft Follow-up
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-[10px]"
          onClick={() => askCopilot('Log the outcome of my last action', 'quick')}>
          <CheckCircle className="h-3 w-3 mr-1" /> Log Outcome
        </Button>
      </div>
    </div>
  );
}
