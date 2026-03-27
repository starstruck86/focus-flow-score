/**
 * Coach Performance Panels — 4 new modes for Coach page
 * Feature-flagged behind ENABLE_SYSTEM_OS
 * REACTIVE: uses polling hooks for live data
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Target, AlertTriangle, Play,
  CheckCircle, BarChart3, Lightbulb, Shield
} from 'lucide-react';
import { isSystemOSEnabled } from '@/lib/featureFlags';
import { useLivePersonalProfile, useLiveRecommendationAudit } from '@/hooks/useSystemState';
import { useCopilot } from '@/contexts/CopilotContext';

// ── Weekly Review Panel ────────────────────────────────────

export function WeeklyReviewPanel() {
  const { ask: askCopilot } = useCopilot();
  const { profile } = useLivePersonalProfile();

  if (!isSystemOSEnabled()) return null;

  const weakSignals = profile.conversionSignals.filter(s => s.strength < 0.4);
  const strongSignals = profile.conversionSignals.filter(s => s.strength >= 0.6);

  return (
    <div data-testid="weekly-review-panel" className="space-y-3">
      {strongSignals.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-primary" />
              Wins This Period
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-1.5">
            {strongSignals.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span>{s.signal}</span>
                <Badge variant="secondary" className="text-[9px]">{Math.round(s.strength * 100)}% conversion</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {weakSignals.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              Areas to Improve
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-1.5">
            {weakSignals.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span>{s.signal}</span>
                <Badge variant="outline" className="text-[9px] text-destructive">{Math.round(s.strength * 100)}%</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {profile.topPlaybooks.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5 text-primary" />
              Next Week Focus
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <p className="text-xs text-muted-foreground mb-2">
              Double down on your top-performing playbooks while targeting weak stages.
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {profile.topPlaybooks.map(pb => (
                <Badge key={pb} variant="secondary" className="text-[10px]">{pb}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Button size="sm" variant="outline" className="w-full text-xs"
        onClick={() => askCopilot('Give me a weekly review of my performance — wins, misses, and what to focus on next week', 'quick')}>
        <Lightbulb className="h-3 w-3 mr-1" /> AI Weekly Review
      </Button>

      {profile.totalRecords === 0 && (
        <div className="text-center py-4 text-muted-foreground">
          <p className="text-xs">No performance data yet.</p>
        </div>
      )}
    </div>
  );
}

// ── Skill Lab Panel ────────────────────────────────────────

export function SkillLabPanel() {
  const { ask: askCopilot } = useCopilot();
  const { profile } = useLivePersonalProfile();

  if (!isSystemOSEnabled()) return null;

  const weakAreas = profile.conversionSignals
    .filter(s => s.strength < 0.5)
    .sort((a, b) => a.strength - b.strength)
    .slice(0, 3);

  return (
    <div data-testid="skill-lab-panel" className="space-y-3">
      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Play className="h-3.5 w-3.5 text-primary" />
            Targeted Training
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          {weakAreas.length > 0 ? (
            weakAreas.map((area, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-md bg-muted/30">
                <div>
                  <p className="text-xs font-medium">{area.signal}</p>
                  <p className="text-[10px] text-muted-foreground">{Math.round(area.strength * 100)}% conversion — needs work</p>
                </div>
                <Button size="sm" variant="outline" className="h-6 text-[10px]"
                  onClick={() => askCopilot(`Start a roleplay focused on the ${area.signal} stage. Make it realistic and challenging.`, 'deal-strategy')}>
                  <Play className="h-3 w-3 mr-1" /> Practice
                </Button>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground py-4 text-center">
              Strong performance across all stages. Try advanced scenarios below.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" className="h-9 text-xs"
          onClick={() => askCopilot('Start a challenging objection handling roleplay with a skeptical VP', 'deal-strategy')}>
          <Shield className="h-3 w-3 mr-1" /> Objection Drill
        </Button>
        <Button size="sm" variant="outline" className="h-9 text-xs"
          onClick={() => askCopilot('Start a discovery call roleplay where the prospect is reluctant to share information', 'deal-strategy')}>
          <Target className="h-3 w-3 mr-1" /> Discovery Drill
        </Button>
      </div>
    </div>
  );
}

// ── Pattern Diagnostics Panel ──────────────────────────────

export function PatternDiagnosticsPanel() {
  const { profile, regret } = useLivePersonalProfile();
  const { ask: askCopilot } = useCopilot();

  if (!isSystemOSEnabled()) return null;

  return (
    <div data-testid="pattern-diagnostics-panel" className="space-y-3">
      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5 text-primary" />
            Deal Patterns
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          {profile.bestTimeOfDay !== null && (
            <div className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/30">
              <span>Best time of day</span>
              <Badge variant="secondary" className="text-[9px]">{profile.bestTimeOfDay}:00</Badge>
            </div>
          )}
          {profile.bestDayOfWeek !== null && (
            <div className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/30">
              <span>Best day of week</span>
              <Badge variant="secondary" className="text-[9px]">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][profile.bestDayOfWeek]}</Badge>
            </div>
          )}
          {profile.totalRecords > 0 && (
            <div className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/30">
              <span>Total recorded outcomes</span>
              <Badge variant="outline" className="text-[9px]">{profile.totalRecords}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {regret.highRegretPlaybooks.length > 0 && (
        <Card className="border-destructive/20">
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              Recurring Mistakes
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-1.5">
            {regret.highRegretPlaybooks.map((pb, i) => (
              <div key={i} className="text-xs text-muted-foreground p-2 rounded-md bg-destructive/5">
                Playbook "{pb}" consistently underperforms vs alternatives
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">
              Avg regret: {regret.avgRegret.toFixed(2)} across {regret.count} decisions
            </p>
          </CardContent>
        </Card>
      )}

      <Button size="sm" variant="outline" className="w-full text-xs"
        onClick={() => askCopilot('Analyze my deal patterns — what recurring mistakes am I making and what patterns should I lean into?', 'quick')}>
        <Lightbulb className="h-3 w-3 mr-1" /> AI Pattern Analysis
      </Button>
    </div>
  );
}

// ── Recommendation Audit Panel ─────────────────────────────

export function RecommendationAuditPanel() {
  const audit = useLiveRecommendationAudit();

  if (!isSystemOSEnabled()) return null;

  return (
    <div data-testid="recommendation-audit-panel" className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-primary">{audit.systemRightRate}%</p>
            <p className="text-[10px] text-muted-foreground">System Right Rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{audit.confidenceCalibration}%</p>
            <p className="text-[10px] text-muted-foreground">Confidence Calibration</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-3 text-center">
          <p className="text-lg font-bold">{audit.userOverrideImpact}%</p>
          <p className="text-[10px] text-muted-foreground">User Override Impact</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            How much your personal choices deviate from system defaults
          </p>
        </CardContent>
      </Card>

      {audit.topMisfires.length > 0 && (
        <Card className="border-destructive/20">
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              Top Misfires
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-1">
            {audit.topMisfires.map((m, i) => (
              <div key={i} className="text-xs text-muted-foreground p-1.5 rounded bg-destructive/5">
                {m}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {audit.topMisfires.length === 0 && (
        <div className="text-center py-4 text-muted-foreground">
          <CheckCircle className="h-6 w-6 mx-auto mb-1 opacity-40" />
          <p className="text-xs">No significant misfires detected. System is well-calibrated.</p>
        </div>
      )}
    </div>
  );
}
