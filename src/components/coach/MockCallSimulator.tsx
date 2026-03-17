import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Play, Square, Send, Loader2, RotateCcw, Trophy, Target, Crosshair,
  ShieldCheck, ShieldAlert, Eye, Brain, Zap, Clock, CheckCircle2,
  AlertTriangle, Lightbulb, MessageSquareQuote, ChevronDown, ChevronUp,
  Swords, Mic, BarChart3, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import {
  useMockCallSessions, useCreateMockSession, useSaveMockMessages,
  useGradeMockCall, streamMockCall, type MockCallSession,
} from '@/hooks/useMockCalls';
import { format, parseISO } from 'date-fns';
import ReactMarkdown from 'react-markdown';

// ── CONSTANTS ──────────────────────────────────────────────
const CALL_TYPES = ['Discovery', 'Demo', 'Pricing', 'Objection Handling', 'Executive Alignment', 'Deal Rescue'];
const INDUSTRIES = ['DTC / Ecommerce', 'SaaS', 'Financial Services', 'Healthcare', 'Retail', 'Manufacturing'];
const PERSONAS = ['CMO', 'Director CRM', 'CFO', 'VP Sales', 'Head of Digital', 'Skeptical CMO', 'Friendly Champion', 'Analytical CFO', 'Distracted VP', 'Technical Evaluator'];
const SKILL_MODES = [
  { value: 'full-call', label: 'Full Call (no focus)' },
  { value: 'discovery-only', label: '🔍 Discovery Only' },
  { value: 'objection-only', label: '🛡️ Objection Handling Only' },
  { value: 'pricing-only', label: '💰 Pricing Only' },
  { value: 'executive-only', label: '👔 Executive Presence Only' },
];

const GRADE_COLORS: Record<string, string> = {
  'A+': 'text-grade-excellent', A: 'text-grade-excellent', 'A-': 'text-grade-excellent',
  'B+': 'text-grade-good', B: 'text-grade-good', 'B-': 'text-grade-good',
  'C+': 'text-grade-average', C: 'text-grade-average', 'C-': 'text-grade-average',
  'D+': 'text-grade-poor', D: 'text-grade-poor', F: 'text-grade-failing',
};

const DIFFICULTY_LABELS: Record<number, { label: string; color: string; description: string }> = {
  1: { label: 'Cooperative', color: 'text-grade-excellent', description: 'Buyer is open and helpful' },
  2: { label: 'Neutral', color: 'text-grade-good', description: 'Requires structured discovery' },
  3: { label: 'Resistant', color: 'text-grade-average', description: 'Skeptical, pushes back' },
  4: { label: 'Executive', color: 'text-grade-failing', description: 'Zero patience for fluff' },
};

// ── SCENARIO SETUP ─────────────────────────────────────────
function ScenarioSetup({ onStart }: { onStart: (cfg: any) => void }) {
  const [callType, setCallType] = useState('Discovery');
  const [industry, setIndustry] = useState('DTC / Ecommerce');
  const [persona, setPersona] = useState('CMO');
  const [difficulty, setDifficulty] = useState(2);
  const [skillMode, setSkillMode] = useState('full-call');

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-2">
          <Swords className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-bold">Sales Roleplay Simulator</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Practice real sales conversations against an AI buyer that challenges you like a real prospect.
          Earn your insights — nothing is given freely.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Call Type</label>
          <Select value={callType} onValueChange={setCallType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CALL_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Industry</label>
          <Select value={industry} onValueChange={setIndustry}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {INDUSTRIES.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Buyer Persona</label>
          <Select value={persona} onValueChange={setPersona}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERSONAS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Skill Focus</label>
          <Select value={skillMode} onValueChange={setSkillMode}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SKILL_MODES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Difficulty selector */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Difficulty Level</label>
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map(d => (
            <button
              key={d}
              onClick={() => setDifficulty(d)}
              className={cn(
                'p-3 rounded-lg border text-center transition-all',
                difficulty === d
                  ? 'border-primary bg-primary/10 ring-1 ring-primary'
                  : 'border-border hover:border-primary/30'
              )}
            >
              <p className={cn('text-lg font-bold', DIFFICULTY_LABELS[d].color)}>{d}</p>
              <p className="text-xs font-semibold">{DIFFICULTY_LABELS[d].label}</p>
              <p className="text-[10px] text-muted-foreground">{DIFFICULTY_LABELS[d].description}</p>
            </button>
          ))}
        </div>
      </div>

      <Button
        className="w-full h-12 text-base font-bold"
        onClick={() => onStart({ call_type: callType, industry, persona, difficulty, skill_mode: skillMode || undefined })}
      >
        <Play className="h-5 w-5 mr-2" /> Start Simulation
      </Button>
    </div>
  );
}

// ── LIVE TRACKING SIDEBAR ──────────────────────────────────
function LiveTracking({ messages }: { messages: { role: string; content: string }[] }) {
  const repMessages = messages.filter(m => m.role === 'user');
  const totalQuestions = repMessages.reduce((c, m) => c + (m.content.match(/\?/g) || []).length, 0);
  const repWordCount = repMessages.reduce((c, m) => c + m.content.split(/\s+/).length, 0);
  const buyerWordCount = messages.filter(m => m.role === 'assistant').reduce((c, m) => c + m.content.split(/\s+/).length, 0);
  const talkRatio = repWordCount + buyerWordCount > 0
    ? Math.round((repWordCount / (repWordCount + buyerWordCount)) * 100) : 0;

  // Check for premature solution
  const prematureSolution = repMessages.length <= 2 && repMessages.some(m =>
    /our (product|solution|platform)|we (can|offer|provide)|let me show/i.test(m.content)
  );

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Live Tracking</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-muted/30 rounded p-2 text-center">
          <p className="text-lg font-mono font-bold">{totalQuestions}</p>
          <p className="text-[10px] text-muted-foreground">Questions Asked</p>
        </div>
        <div className="bg-muted/30 rounded p-2 text-center">
          <p className={cn('text-lg font-mono font-bold', talkRatio > 60 ? 'text-grade-failing' : 'text-grade-excellent')}>
            {talkRatio}%
          </p>
          <p className="text-[10px] text-muted-foreground">Talk Ratio</p>
        </div>
        <div className="bg-muted/30 rounded p-2 text-center">
          <p className="text-lg font-mono font-bold">{messages.length}</p>
          <p className="text-[10px] text-muted-foreground">Exchanges</p>
        </div>
        <div className="bg-muted/30 rounded p-2 text-center">
          <p className="text-lg font-mono font-bold">{repMessages.length}</p>
          <p className="text-[10px] text-muted-foreground">Your Turns</p>
        </div>
      </div>
      {prematureSolution && (
        <div className="rounded bg-grade-failing/10 border border-grade-failing/20 p-2">
          <p className="text-[10px] text-grade-failing font-semibold">⚠ Premature solution detected</p>
          <p className="text-[10px] text-muted-foreground">You may be jumping to product before understanding pain</p>
        </div>
      )}
    </div>
  );
}

// ── CHAT INTERFACE ─────────────────────────────────────────
function ChatInterface({
  session,
  onEnd,
  onRetry,
}: {
  session: MockCallSession;
  onEnd: () => void;
  onRetry: (fromIndex: number) => void;
}) {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>(
    session.messages || []
  );
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const saveMessages = useSaveMockMessages();

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50);
  }, []);

  // Save messages periodically
  useEffect(() => {
    if (messages.length > 0 && !isStreaming) {
      saveMessages.mutate({ sessionId: session.id, messages });
    }
  }, [messages.length, isStreaming]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMsg: { role: 'user' | 'assistant'; content: string } = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);
    scrollToBottom();

    let assistantContent = '';
    abortRef.current = new AbortController();

    await streamMockCall({
      messages: newMessages,
      config: {
        callType: session.call_type,
        industry: session.industry || 'DTC / Ecommerce',
        persona: session.persona,
        difficulty: session.difficulty,
        skillMode: session.skill_mode || undefined,
      },
      sessionId: session.id,
      onDelta: (chunk) => {
        assistantContent += chunk;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m);
          }
          return [...prev, { role: 'assistant', content: assistantContent }];
        });
        scrollToBottom();
      },
      onDone: () => setIsStreaming(false),
      onError: (err) => {
        setIsStreaming(false);
        setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${err}` }]);
      },
      signal: abortRef.current.signal,
    });
  }, [input, messages, isStreaming, session]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex gap-4 h-[calc(100vh-220px)] min-h-[500px]">
      {/* Chat panel */}
      <div className="flex-1 flex flex-col border border-border rounded-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Swords className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">{session.call_type}</span>
            <Badge variant="outline" className="text-[10px]">{session.persona}</Badge>
            <Badge variant="outline" className={cn('text-[10px]', DIFFICULTY_LABELS[session.difficulty]?.color)}>
              Lvl {session.difficulty}
            </Badge>
            {session.skill_mode && (
              <Badge variant="secondary" className="text-[10px]">{session.skill_mode}</Badge>
            )}
          </div>
          <Button size="sm" variant="destructive" onClick={onEnd}>
            <Square className="h-3 w-3 mr-1" /> End & Grade
          </Button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Mic className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium">Start the call</p>
              <p className="text-xs">Type your opening — how would you start this {session.call_type.toLowerCase()} call?</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[80%] rounded-lg px-4 py-2.5 text-sm',
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted border border-border'
              )}>
                <p className="text-[10px] font-bold mb-1 opacity-70">
                  {msg.role === 'user' ? 'YOU (Rep)' : `BUYER (${session.persona})`}
                </p>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              </div>
            </div>
          ))}
          {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
            <div className="flex justify-start">
              <div className="bg-muted border border-border rounded-lg px-4 py-2.5">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border p-3 flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your response..."
            disabled={isStreaming}
            className="flex-1"
          />
          <Button onClick={sendMessage} disabled={isStreaming || !input.trim()} size="icon">
            {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Sidebar tracking */}
      <div className="w-56 flex-shrink-0 space-y-4">
        <LiveTracking messages={messages} />

        {messages.length >= 6 && (
          <Button variant="outline" size="sm" className="w-full text-xs" onClick={onEnd}>
            <Trophy className="h-3 w-3 mr-1" /> End & Get Scored
          </Button>
        )}
      </div>
    </div>
  );
}

// ── MOCK CALL SCORECARD ────────────────────────────────────
function MockCallScorecard({ grade, session, onRetry }: { grade: any; session: MockCallSession; onRetry?: () => void }) {
  const [showEvidence, setShowEvidence] = useState(false);
  const [showElite, setShowElite] = useState(false);

  const CATEGORY_LABELS: Record<string, { label: string; icon: any }> = {
    structure: { label: 'Structure', icon: Clock },
    cotm: { label: 'Command of Message', icon: Crosshair },
    meddicc: { label: 'MEDDICC', icon: ShieldCheck },
    discovery: { label: 'Discovery Depth', icon: Eye },
    presence: { label: 'Executive Presence', icon: Brain },
    commercial: { label: 'Commercial Acumen', icon: Zap },
    next_step: { label: 'Next Step Control', icon: Target },
  };

  const categories = Object.entries(CATEGORY_LABELS).map(([key, { label }]) => ({
    key, label, score: grade[`${key}_score`] || 0,
  }));

  const cotm = grade.cotm_signals || {};
  const meddicc = grade.meddicc_signals || {};
  const disc = grade.discovery_stats || {};
  const pres = grade.presence_stats || {};

  return (
    <div className="space-y-4">
      {/* Header with grade */}
      <div className="flex items-start justify-between">
        <div className="space-y-1 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline">{session.call_type}</Badge>
            <Badge variant="outline">{session.persona}</Badge>
            <Badge variant="outline" className={DIFFICULTY_LABELS[session.difficulty]?.color}>
              Lvl {session.difficulty}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{grade.summary}</p>
        </div>
        <span className={cn('text-5xl font-black font-mono ml-4', GRADE_COLORS[grade.overall_grade])}>
          {grade.overall_grade}
        </span>
      </div>

      {/* Win assessment */}
      {grade.win_assessment && (
        <Card className={cn('border-2', grade.overall_score >= 4 ? 'border-grade-excellent/30 bg-grade-excellent/5' : 'border-grade-average/30 bg-grade-average/5')}>
          <CardContent className="p-3">
            <p className="text-xs font-bold uppercase tracking-wider mb-1">
              {grade.overall_score >= 4 ? '✅ Would Advance' : '⚠️ Buyer Verdict'}
            </p>
            <p className="text-sm">{grade.win_assessment}</p>
          </CardContent>
        </Card>
      )}

      {/* Category scores */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Category Scores</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-2">
          {categories.map(c => {
            const pct = (c.score / 5) * 100;
            const color = pct >= 80 ? 'bg-grade-excellent' : pct >= 60 ? 'bg-grade-good' : pct >= 40 ? 'bg-grade-average' : 'bg-grade-failing';
            return (
              <div key={c.key} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{c.label}</span>
                  <span className="font-mono font-bold">{c.score}/5</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <motion.div className={cn('h-full rounded-full', color)} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Primary Coaching Action */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              #1 Coaching Action — {grade.feedback_focus?.toUpperCase()}
            </span>
          </div>
          {grade.coaching_issue && <p className="text-sm font-semibold">{grade.coaching_issue}</p>}
          {grade.coaching_why && <p className="text-xs text-muted-foreground">{grade.coaching_why}</p>}
          {grade.transcript_moment && (
            <div className="rounded bg-muted/50 p-2 border-l-2 border-primary/50">
              <p className="text-xs italic text-muted-foreground">
                <MessageSquareQuote className="h-3 w-3 inline mr-1" />
                "{grade.transcript_moment}"
              </p>
            </div>
          )}
          {grade.replacement_behavior && (
            <div className="rounded bg-grade-excellent/10 border border-grade-excellent/20 p-2">
              <p className="text-xs font-medium text-grade-excellent mb-1">→ Instead, do this:</p>
              <p className="text-sm">{grade.replacement_behavior}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Framework coverage */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border/50">
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <Crosshair className="h-3 w-3" /> CotM
              <Badge variant="outline" className="ml-auto text-[10px]">
                {['before_identified', 'negative_consequences', 'after_defined', 'pbo_articulated', 'required_capabilities', 'metrics_captured'].filter(k => cotm[k]).length}/6
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-1">
            {[
              { key: 'before_identified', label: 'Before State' },
              { key: 'negative_consequences', label: 'Neg. Consequences' },
              { key: 'after_defined', label: 'After State' },
              { key: 'pbo_articulated', label: 'PBOs' },
              { key: 'required_capabilities', label: 'Capabilities' },
              { key: 'metrics_captured', label: 'Metrics' },
            ].map(item => (
              <div key={item.key} className="flex items-center gap-1.5 text-xs">
                {cotm[item.key] ? <CheckCircle2 className="h-3 w-3 text-grade-excellent" /> : <ShieldAlert className="h-3 w-3 text-grade-failing" />}
                <span className={cotm[item.key] ? 'text-foreground' : 'text-muted-foreground'}>{item.label}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3" /> MEDDICC
              <Badge variant="outline" className="ml-auto text-[10px]">
                {['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition'].filter(k => meddicc[k]).length}/7
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-1">
            {['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition'].map(key => (
              <div key={key} className="flex items-center gap-1.5 text-xs">
                {meddicc[key] ? <CheckCircle2 className="h-3 w-3 text-grade-excellent" /> : <ShieldAlert className="h-3 w-3 text-grade-failing" />}
                <span className={meddicc[key] ? 'text-foreground' : 'text-muted-foreground'}>
                  {key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Discovery + Presence */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border/50">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Discovery Stats</p>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div><p className="text-lg font-mono font-bold">{disc.total_questions || 0}</p><p className="text-[10px] text-muted-foreground">Questions</p></div>
              <div><p className="text-lg font-mono font-bold">{disc.open_ended_pct || 0}%</p><p className="text-[10px] text-muted-foreground">Open-ended</p></div>
              <div><p className="text-lg font-mono font-bold">{disc.impact_questions || 0}</p><p className="text-[10px] text-muted-foreground">Impact Q's</p></div>
              <div><p className="text-lg font-mono font-bold">{disc.follow_up_depth || 0}/5</p><p className="text-[10px] text-muted-foreground">Depth</p></div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Presence</p>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div><p className={cn('text-lg font-mono font-bold', (pres.talk_ratio_estimate || 0) > 60 ? 'text-grade-failing' : 'text-grade-excellent')}>{pres.talk_ratio_estimate || 0}%</p><p className="text-[10px] text-muted-foreground">Talk Ratio</p></div>
              <div><p className="text-lg font-mono font-bold">{pres.flow_control || 0}/5</p><p className="text-[10px] text-muted-foreground">Flow</p></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Strengths + Missed */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border/50">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-grade-excellent flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Strengths</p>
            {(grade.strengths || []).map((s: any, i: number) => (
              <p key={i} className="text-xs text-muted-foreground">• {typeof s === 'string' ? s : s.point}</p>
            ))}
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-grade-failing flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Missed</p>
            {(grade.missed_opportunities || []).map((m: any, i: number) => (
              <div key={i} className="text-xs text-muted-foreground">
                <p>• {m.opportunity}</p>
                {m.example && <p className="ml-3 italic text-[10px]">→ {m.example}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Elite Alternatives */}
      {(grade.elite_alternatives || []).length > 0 && (
        <>
          <Button variant="ghost" size="sm" onClick={() => setShowElite(!showElite)} className="w-full text-xs">
            <Trophy className="h-3 w-3 mr-1" />
            {showElite ? 'Hide' : 'Show'} What Elite Would Have Done ({grade.elite_alternatives.length})
          </Button>
          <AnimatePresence>
            {showElite && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden space-y-2">
                {grade.elite_alternatives.map((alt: any, i: number) => (
                  <Card key={i} className="border-grade-good/20 bg-grade-good/5">
                    <CardContent className="p-3 space-y-1 text-xs">
                      <p className="text-grade-failing">❌ You did: {alt.what_rep_did}</p>
                      <p className="text-grade-excellent">✅ Elite would: {alt.what_elite_would_do}</p>
                      <p className="italic text-muted-foreground">💬 "{alt.example_phrase}"</p>
                    </CardContent>
                  </Card>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Suggested questions */}
      {(grade.suggested_questions || []).length > 0 && (
        <Card className="border-border/50">
          <CardContent className="p-3 space-y-2">
            <p className="text-xs font-semibold text-grade-good flex items-center gap-1">
              <Lightbulb className="h-3 w-3" /> Questions You Should Have Asked
            </p>
            {grade.suggested_questions.map((q: any, i: number) => (
              <div key={i} className="text-xs border-l-2 border-grade-good/30 pl-2 space-y-0.5">
                <p className="font-medium">"{q.question}"</p>
                <p className="text-[10px] text-muted-foreground">
                  <Badge variant="outline" className="text-[9px] h-3.5 mr-1">{q.framework}</Badge>
                  {q.why}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Evidence */}
      <Button variant="ghost" size="sm" onClick={() => setShowEvidence(!showEvidence)} className="w-full text-xs">
        {showEvidence ? 'Hide' : 'Show'} Evidence ({(grade.evidence || []).length} quotes)
      </Button>
      <AnimatePresence>
        {showEvidence && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden space-y-2">
            {(grade.evidence || []).map((e: any, i: number) => (
              <div key={i} className="rounded bg-muted/30 p-2 space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[9px]">{e.category}</Badge>
                  <span className="font-mono text-[10px]">{e.score_given}/5</span>
                </div>
                <p className="italic text-muted-foreground">"{e.quote}"</p>
                <p>{e.assessment}</p>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        {onRetry && (
          <Button variant="outline" onClick={onRetry} className="flex-1">
            <RotateCcw className="h-4 w-4 mr-2" /> Try Again (Same Scenario)
          </Button>
        )}
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ─────────────────────────────────────────
export function MockCallSimulator() {
  const { user } = useAuth();
  const { data: sessions } = useMockCallSessions();
  const createSession = useCreateMockSession();
  const gradeCall = useGradeMockCall();
  const saveMessages = useSaveMockMessages();

  const [activeSession, setActiveSession] = useState<MockCallSession | null>(null);
  const [view, setView] = useState<'setup' | 'chat' | 'scorecard' | 'history'>('setup');
  const [gradedSession, setGradedSession] = useState<MockCallSession | null>(null);

  const handleStart = async (cfg: any) => {
    try {
      const session = await createSession.mutateAsync(cfg);
      setActiveSession(session);
      setView('chat');
    } catch (e: any) {
      console.error(e);
    }
  };

  const handleEndCall = async () => {
    if (!activeSession) return;
    setView('scorecard');
    try {
      const grade = await gradeCall.mutateAsync(activeSession.id);
      setGradedSession({ ...activeSession, grade_data: grade, overall_grade: grade.overall_grade });
    } catch {
      // Error handled by mutation
    }
  };

  const handleRetry = () => {
    if (!gradedSession) return;
    handleStart({
      call_type: gradedSession.call_type,
      industry: gradedSession.industry,
      persona: gradedSession.persona,
      difficulty: gradedSession.difficulty,
      skill_mode: gradedSession.skill_mode,
    });
  };

  const handleViewHistory = (session: MockCallSession) => {
    setGradedSession(session);
    setView('scorecard');
  };

  // Graded sessions for history
  const gradedSessions = (sessions || []).filter(s => s.status === 'graded' && s.grade_data);

  if (view === 'chat' && activeSession) {
    return (
      <ChatInterface
        session={activeSession}
        onEnd={handleEndCall}
        onRetry={() => {}}
      />
    );
  }

  if (view === 'scorecard') {
    if (gradeCall.isPending) {
      return (
        <div className="text-center py-20">
          <Loader2 className="h-10 w-10 animate-spin mx-auto mb-4 text-primary" />
          <p className="font-medium">Analyzing your performance...</p>
          <p className="text-sm text-muted-foreground">Grading against CotM, MEDDICC, and Discovery frameworks</p>
        </div>
      );
    }

    if (gradedSession?.grade_data) {
      return (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => { setView('setup'); setGradedSession(null); setActiveSession(null); }}>
            ← Back to Simulator
          </Button>
          <MockCallScorecard grade={gradedSession.grade_data} session={gradedSession} onRetry={handleRetry} />
        </div>
      );
    }
  }

  // Default: setup + history
  return (
    <div className="space-y-6">
      <ScenarioSetup onStart={handleStart} />

      {gradedSessions.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-border/50">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <BarChart3 className="h-3 w-3" /> Past Simulations
          </p>
          {gradedSessions.slice(0, 10).map(s => (
            <Card
              key={s.id}
              className="border-border/50 hover:border-primary/30 transition-colors cursor-pointer"
              onClick={() => handleViewHistory(s)}
            >
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{s.call_type}</span>
                    <Badge variant="outline" className="text-[10px]">{s.persona}</Badge>
                    <Badge variant="outline" className={cn('text-[10px]', DIFFICULTY_LABELS[s.difficulty]?.color)}>
                      Lvl {s.difficulty}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {format(parseISO(s.created_at), 'MMM d, yyyy h:mm a')}
                    {s.skill_mode && ` · ${s.skill_mode}`}
                  </p>
                </div>
                <span className={cn('text-2xl font-black font-mono', GRADE_COLORS[s.overall_grade || 'C'])}>
                  {s.overall_grade || '?'}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
