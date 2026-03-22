import { useState, useRef, useCallback, useEffect } from 'react';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Shield, Play, RotateCcw, Send, Mic, MicOff, Volume2,
  Loader2, Trophy, Target, Zap, ArrowRight, CheckCircle2,
  AlertTriangle, Clock, Flame, ChevronDown, ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useVoiceMode } from '@/hooks/useVoiceMode';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';

// ── OBJECTION BANK ─────────────────────────────────────────
interface Objection {
  id: string;
  category: string;
  objection: string;
  difficulty: 1 | 2 | 3;
  context: string;
}

const OBJECTION_CATEGORIES = [
  { value: 'pricing', label: '💰 Pricing', color: 'text-yellow-500' },
  { value: 'timing', label: '⏰ Timing', color: 'text-blue-500' },
  { value: 'competition', label: '⚔️ Competition', color: 'text-red-500' },
  { value: 'authority', label: '👔 Authority', color: 'text-purple-500' },
  { value: 'status-quo', label: '🪨 Status Quo', color: 'text-gray-500' },
  { value: 'trust', label: '🤝 Trust', color: 'text-green-500' },
];

const OBJECTION_BANK: Objection[] = [
  // Pricing
  { id: 'p1', category: 'pricing', objection: "We just don't have the budget for this right now.", difficulty: 1, context: 'Mid-market DTC brand, $5M revenue' },
  { id: 'p2', category: 'pricing', objection: "Your competitor quoted us 40% less for essentially the same thing.", difficulty: 2, context: 'Enterprise retail, evaluating 3 vendors' },
  { id: 'p3', category: 'pricing', objection: "Our CFO killed the last three software purchases over $50K. There's no way this gets through.", difficulty: 3, context: 'Fortune 500, procurement-heavy org' },
  { id: 'p4', category: 'pricing', objection: "We'd need to see a 3x ROI in the first 6 months to justify this spend.", difficulty: 2, context: 'PE-backed SaaS, aggressive cost management' },
  // Timing
  { id: 't1', category: 'timing', objection: "This is interesting but we're mid-migration right now. Let's circle back in Q3.", difficulty: 1, context: 'Moving CRM platforms' },
  { id: 't2', category: 'timing', objection: "We literally just renewed our contract with [competitor] for 2 years.", difficulty: 2, context: 'Locked into competitor agreement' },
  { id: 't3', category: 'timing', objection: "My team is drowning right now. We can't take on another implementation.", difficulty: 3, context: 'Team of 4 managing 15 tools' },
  // Competition
  { id: 'c1', category: 'competition', objection: "We're already using [competitor] and it works fine.", difficulty: 1, context: 'Happy with incumbent, no active pain' },
  { id: 'c2', category: 'competition', objection: "Your competitor has a native integration with Salesforce. You don't. That's a dealbreaker.", difficulty: 2, context: 'Salesforce-centric org' },
  { id: 'c3', category: 'competition', objection: "I've seen three demos this week and honestly they're all starting to blur together. What's actually different here?", difficulty: 3, context: 'Decision fatigue, deep in evaluation' },
  // Authority
  { id: 'a1', category: 'authority', objection: "I like this, but I'd need to run it by my VP. They make the call.", difficulty: 1, context: 'Director-level champion' },
  { id: 'a2', category: 'authority', objection: "There are five stakeholders who need to sign off, and two of them are skeptical about adding more tech.", difficulty: 2, context: 'Complex buying committee' },
  { id: 'a3', category: 'authority', objection: "I'm not authorized to sign off on anything over $25K. And the person who can is impossible to get on a call.", difficulty: 3, context: 'Gatekeeper, no exec access' },
  // Status Quo
  { id: 's1', category: 'status-quo', objection: "Honestly, what we're doing today works well enough.", difficulty: 1, context: 'No perceived urgency' },
  { id: 's2', category: 'status-quo', objection: "We built our own internal solution. It's not perfect, but the team knows it.", difficulty: 2, context: 'Homegrown tool, sunk cost' },
  { id: 's3', category: 'status-quo', objection: "We tried something similar two years ago and it was a disaster. My team is skeptical about any vendor now.", difficulty: 3, context: 'Previous failed implementation' },
  // Trust
  { id: 'tr1', category: 'trust', objection: "I've never heard of your company before this call.", difficulty: 1, context: 'Brand awareness gap' },
  { id: 'tr2', category: 'trust', objection: "How do I know you'll still be around in two years? Your company seems pretty small.", difficulty: 2, context: 'Startup risk concern' },
  { id: 'tr3', category: 'trust', objection: "Your last customer case study is from 2024. Do you actually have recent wins in our space?", difficulty: 3, context: 'Industry credibility gap' },
];

const GRADE_COLORS: Record<string, string> = {
  'A+': 'text-grade-excellent', A: 'text-grade-excellent', 'A-': 'text-grade-excellent',
  'B+': 'text-grade-good', B: 'text-grade-good', 'B-': 'text-grade-good',
  'C+': 'text-grade-average', C: 'text-grade-average', 'C-': 'text-grade-average',
  'D+': 'text-grade-poor', D: 'text-grade-poor', F: 'text-grade-failing',
};

interface DrillResult {
  grade: string;
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
  betterResponse: string;
  framework: string;
}

// ── MAIN COMPONENT ─────────────────────────────────────────
export function ObjectionDrillReps() {
  const { user } = useAuth();
  const voice = useVoiceMode();

  // Drill state
  const [mode, setMode] = useState<'setup' | 'drill' | 'results' | 'session-summary'>('setup');
  const [category, setCategory] = useState('all');
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(2);
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  // Current drill
  const [currentObjection, setCurrentObjection] = useState<Objection | null>(null);
  const [response, setResponse] = useState('');
  const [isGrading, setIsGrading] = useState(false);
  const [currentResult, setCurrentResult] = useState<DrillResult | null>(null);

  // Session tracking
  const [sessionResults, setSessionResults] = useState<{ objection: Objection; result: DrillResult }[]>([]);
  const [usedIds, setUsedIds] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const pickObjection = useCallback(() => {
    const pool = OBJECTION_BANK.filter(o =>
      (category === 'all' || o.category === category) &&
      o.difficulty <= difficulty &&
      !usedIds.has(o.id)
    );
    if (pool.length === 0) {
      // Reset used IDs if we've exhausted the pool
      setUsedIds(new Set());
      const fullPool = OBJECTION_BANK.filter(o =>
        (category === 'all' || o.category === category) && o.difficulty <= difficulty
      );
      return fullPool[Math.floor(Math.random() * fullPool.length)];
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }, [category, difficulty, usedIds]);

  const startDrill = useCallback(() => {
    const obj = pickObjection();
    if (!obj) return;
    setCurrentObjection(obj);
    setResponse('');
    setCurrentResult(null);
    setMode('drill');
    setUsedIds(prev => new Set([...prev, obj.id]));
    setTimeout(() => inputRef.current?.focus(), 100);

    // Auto-speak the objection
    if (voiceEnabled) {
      voice.playTTS(obj.objection).catch(() => {});
    }
  }, [pickObjection, voiceEnabled, voice]);

  const gradeResponse = useCallback(async () => {
    if (!response.trim() || !currentObjection || !user) return;
    setIsGrading(true);

    try {
      const { data, error } = await trackedInvoke<any>('grade-objection-drill', {
        body: {
          objection: currentObjection.objection,
          category: currentObjection.category,
          context: currentObjection.context,
          difficulty: currentObjection.difficulty,
          response: response.trim(),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const result = data as DrillResult;
      setCurrentResult(result);
      setSessionResults(prev => [...prev, { objection: currentObjection, result }]);
      setMode('results');

      // Speak feedback
      if (voiceEnabled) {
        voice.playTTS(`${result.grade}. ${result.feedback}`).catch(() => {});
      }
    } catch (err: any) {
      toast.error('Grading failed', { description: err.message });
    } finally {
      setIsGrading(false);
    }
  }, [response, currentObjection, user, voiceEnabled, voice]);

  const handleMicClick = useCallback(async () => {
    if (voice.isRecording) {
      try {
        const transcript = await voice.stopRecording();
        if (transcript) {
          setResponse(transcript);
        }
      } catch (err: any) {
        if (err.message !== 'Recording too short') {
          toast.error('Transcription failed', { description: err.message });
        }
      }
    } else {
      try {
        await voice.startRecording();
      } catch {}
    }
  }, [voice]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      gradeResponse();
    }
  };

  // Session stats
  const avgScore = sessionResults.length > 0
    ? Math.round(sessionResults.reduce((s, r) => s + r.result.score, 0) / sessionResults.length)
    : 0;
  const hitRate = sessionResults.length > 0
    ? Math.round(sessionResults.filter(r => r.result.score >= 70).length / sessionResults.length * 100)
    : 0;

  const categoryStats = OBJECTION_CATEGORIES.map(cat => {
    const catResults = sessionResults.filter(r => r.objection.category === cat.value);
    return {
      ...cat,
      count: catResults.length,
      avgScore: catResults.length > 0
        ? Math.round(catResults.reduce((s, r) => s + r.result.score, 0) / catResults.length)
        : null,
    };
  }).filter(c => c.count > 0);

  // ── SETUP VIEW ───────────────────────────────────────────
  if (mode === 'setup') {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-2">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold">Objection Drill Reps</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            2-minute reps. Buyer throws an objection → you handle it → instant AI grade.
            Stack 10 reps in 20 minutes and track your hit rate.
          </p>
        </div>

        {/* Session progress bar */}
        {sessionResults.length > 0 && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Session Progress</span>
                <Button size="sm" variant="ghost" onClick={() => setMode('session-summary')} className="text-xs gap-1">
                  <Trophy className="h-3 w-3" /> View Summary
                </Button>
              </div>
              <div className="flex gap-3 text-center">
                <div className="flex-1 bg-background rounded p-2">
                  <p className="text-2xl font-mono font-bold">{sessionResults.length}</p>
                  <p className="text-[10px] text-muted-foreground">Reps</p>
                </div>
                <div className="flex-1 bg-background rounded p-2">
                  <p className="text-2xl font-mono font-bold">{hitRate}%</p>
                  <p className="text-[10px] text-muted-foreground">Hit Rate</p>
                </div>
                <div className="flex-1 bg-background rounded p-2">
                  <p className="text-2xl font-mono font-bold">{avgScore}</p>
                  <p className="text-[10px] text-muted-foreground">Avg Score</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Category</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">🎲 Random Mix</SelectItem>
                {OBJECTION_CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Max Difficulty</label>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map(d => (
                <button
                  key={d}
                  onClick={() => setDifficulty(d as 1 | 2 | 3)}
                  className={cn(
                    'p-2 rounded-lg border text-center transition-all',
                    difficulty === d
                      ? 'border-primary bg-primary/10 ring-1 ring-primary'
                      : 'border-border hover:border-primary/30'
                  )}
                >
                  <p className="text-sm font-bold">{['Easy', 'Medium', 'Hard'][d - 1]}</p>
                  <p className="text-[10px] text-muted-foreground">{['Cooperative', 'Pushback', 'Hostile'][d - 1]}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-muted-foreground" />
            <Switch checked={voiceEnabled} onCheckedChange={setVoiceEnabled} />
            <span className="text-xs text-muted-foreground">Voice mode</span>
          </div>
        </div>

        <Button className="w-full h-12 text-base font-bold" onClick={startDrill}>
          <Play className="h-5 w-5 mr-2" />
          {sessionResults.length > 0 ? 'Next Rep' : 'Start Drill'}
        </Button>
      </div>
    );
  }

  // ── DRILL VIEW ───────────────────────────────────────────
  if (mode === 'drill' && currentObjection) {
    const catInfo = OBJECTION_CATEGORIES.find(c => c.value === currentObjection.category);
    return (
      <div className="space-y-4">
        {/* Rep counter */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">Rep #{sessionResults.length + 1}</Badge>
            <Badge variant="secondary" className="text-xs">{catInfo?.label}</Badge>
            <Badge variant="outline" className={cn('text-xs',
              currentObjection.difficulty === 1 ? 'text-grade-excellent' :
              currentObjection.difficulty === 2 ? 'text-grade-average' : 'text-grade-failing'
            )}>
              {'★'.repeat(currentObjection.difficulty)}
            </Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setMode('setup')} className="text-xs">
            ← Back
          </Button>
        </div>

        {/* The objection */}
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Buyer Says:</p>
                <p className="text-lg font-semibold leading-relaxed">"{currentObjection.objection}"</p>
                <p className="text-xs text-muted-foreground italic">Context: {currentObjection.context}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Response input */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Your Response:</p>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={response}
              onChange={e => setResponse(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={voiceEnabled ? "Press mic or type..." : "Type your objection handle..."}
              className="flex-1"
              disabled={isGrading}
            />
            {voiceEnabled && (
              <Button
                variant={voice.isRecording ? 'destructive' : 'outline'}
                size="icon"
                onClick={handleMicClick}
                disabled={isGrading}
              >
                {voice.isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
            )}
            <Button onClick={gradeResponse} disabled={!response.trim() || isGrading}>
              {isGrading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          {voice.isRecording && (
            <p className="text-xs text-destructive animate-pulse">🔴 Recording... speak your response</p>
          )}
        </div>

        {/* Skip */}
        <Button variant="ghost" size="sm" onClick={startDrill} className="w-full text-xs text-muted-foreground">
          Skip this objection →
        </Button>
      </div>
    );
  }

  // ── RESULTS VIEW ─────────────────────────────────────────
  if (mode === 'results' && currentResult && currentObjection) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Badge variant="outline" className="text-xs">Rep #{sessionResults.length} Result</Badge>
          <span className={cn('text-4xl font-black font-mono', GRADE_COLORS[currentResult.grade])}>
            {currentResult.grade}
          </span>
        </div>

        {/* Score bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Handle Score</span>
            <span className="font-mono font-bold">{currentResult.score}/100</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <motion.div
              className={cn('h-full rounded-full',
                currentResult.score >= 80 ? 'bg-grade-excellent' :
                currentResult.score >= 60 ? 'bg-grade-good' :
                currentResult.score >= 40 ? 'bg-grade-average' : 'bg-grade-failing'
              )}
              initial={{ width: 0 }}
              animate={{ width: `${currentResult.score}%` }}
              transition={{ duration: 0.6 }}
            />
          </div>
        </div>

        {/* Feedback */}
        <Card className="border-border/50">
          <CardContent className="p-4 space-y-3">
            <p className="text-sm">{currentResult.feedback}</p>
            {currentResult.framework && (
              <Badge variant="secondary" className="text-[10px]">Framework: {currentResult.framework}</Badge>
            )}
          </CardContent>
        </Card>

        {/* Strengths / Improvements */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="border-border/50">
            <CardContent className="p-3 space-y-1.5">
              <p className="text-xs font-semibold text-grade-excellent flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> What Worked
              </p>
              {currentResult.strengths.map((s, i) => (
                <p key={i} className="text-xs text-muted-foreground">• {s}</p>
              ))}
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="p-3 space-y-1.5">
              <p className="text-xs font-semibold text-grade-failing flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Improve
              </p>
              {currentResult.improvements.map((s, i) => (
                <p key={i} className="text-xs text-muted-foreground">• {s}</p>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Better response */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 space-y-2">
            <p className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1">
              <Zap className="h-3 w-3" /> Elite Response
            </p>
            <p className="text-sm italic">"{currentResult.betterResponse}"</p>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex gap-2">
          <Button className="flex-1" onClick={startDrill}>
            <ArrowRight className="h-4 w-4 mr-1" /> Next Rep
          </Button>
          <Button variant="outline" onClick={() => setMode('setup')}>
            <RotateCcw className="h-4 w-4 mr-1" /> Change Settings
          </Button>
          {sessionResults.length >= 3 && (
            <Button variant="secondary" onClick={() => setMode('session-summary')}>
              <Trophy className="h-4 w-4 mr-1" /> Summary
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── SESSION SUMMARY ──────────────────────────────────────
  if (mode === 'session-summary') {
    return (
      <div className="space-y-4">
        <div className="text-center space-y-2">
          <Trophy className="h-10 w-10 mx-auto text-primary" />
          <h2 className="text-xl font-bold">Session Complete</h2>
          <p className="text-sm text-muted-foreground">{sessionResults.length} reps completed</p>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="border-border/50">
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-mono font-bold">{sessionResults.length}</p>
              <p className="text-xs text-muted-foreground">Total Reps</p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="p-4 text-center">
              <p className={cn('text-3xl font-mono font-bold',
                hitRate >= 70 ? 'text-grade-excellent' : hitRate >= 50 ? 'text-grade-average' : 'text-grade-failing'
              )}>{hitRate}%</p>
              <p className="text-xs text-muted-foreground">Hit Rate (≥70)</p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-mono font-bold">{avgScore}</p>
              <p className="text-xs text-muted-foreground">Avg Score</p>
            </CardContent>
          </Card>
        </div>

        {/* Category breakdown */}
        {categoryStats.length > 0 && (
          <Card className="border-border/50">
            <CardContent className="p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">By Category</p>
              {categoryStats.map(cat => (
                <div key={cat.value} className="flex items-center justify-between py-1">
                  <span className="text-sm">{cat.label}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{cat.count} reps</span>
                    <span className={cn('font-mono font-bold text-sm',
                      (cat.avgScore || 0) >= 70 ? 'text-grade-excellent' :
                      (cat.avgScore || 0) >= 50 ? 'text-grade-average' : 'text-grade-failing'
                    )}>{cat.avgScore}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Individual results */}
        <Card className="border-border/50">
          <CardContent className="p-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Rep Log</p>
            {sessionResults.map((r, i) => (
              <div key={i} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
                <span className="text-xs text-muted-foreground w-6">#{i + 1}</span>
                <span className="flex-1 text-xs truncate">{r.objection.objection.substring(0, 60)}...</span>
                <Badge variant="outline" className="text-[10px]">
                  {OBJECTION_CATEGORIES.find(c => c.value === r.objection.category)?.label}
                </Badge>
                <span className={cn('font-mono font-bold text-sm', GRADE_COLORS[r.result.grade])}>
                  {r.result.grade}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => { setMode('setup'); }}>
            <Flame className="h-4 w-4 mr-1" /> Keep Going
          </Button>
          <Button variant="outline" onClick={() => { setSessionResults([]); setUsedIds(new Set()); setMode('setup'); }}>
            <RotateCcw className="h-4 w-4 mr-1" /> New Session
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
