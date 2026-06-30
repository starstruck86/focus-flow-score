/**
 * Car Mode — hands-free, audio-first practice.
 *
 * Two capture paths:
 *  - Chrome (desktop/Android): Web Speech API live STT, scored via `car-mode-score`.
 *  - iOS / Safari / unreliable STT: MediaRecorder captures the rep's voice;
 *    the recording is sent to `car-mode-audio-score`, which transcribes AND
 *    grades in one Gemini call via the Lovable AI Gateway (no extra API key).
 *
 * TTS, voice commands, and persistence to ki_mastery + dojo_sessions/turns are
 * shared across both paths.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { writeKIMastery } from '@/lib/dojo/kiMasteryWriter';
import { ArrowLeft, Mic, MicOff, SkipForward, RotateCcw, Eye, Volume2 } from 'lucide-react';

type Shape = 'quick_reply' | 'talk_track';

interface Drill {
  ki_id: string;
  concept_id: string;
  spoke: string;
  concept_title: string;
  ki_title: string;
  scenario: string;
  spoken_task: string;
  response_shape: Shape;
  model_answer: string;
  rubric: Array<{ c: string; must?: boolean }>;
  spider_dimension: string | null;
  chapter: string | null;
}

interface GradeResult {
  score: number;
  passed: boolean;
  criteria: Array<{ c: string; met: boolean }>;
  top_fix: string;
  elite_line: string;
  summary: string;
}

type Phase = 'idle' | 'intro' | 'scenario' | 'task' | 'listening' | 'grading' | 'feedback' | 'reveal' | 'error';

// ── Capability detection ────────────────────────────────────────────
type SR = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const SpeechRecognitionCtor: { new (): SR } | undefined =
  typeof window !== 'undefined'
    ? ((window as unknown as { SpeechRecognition?: { new (): SR }; webkitSpeechRecognition?: { new (): SR } }).SpeechRecognition ??
       (window as unknown as { webkitSpeechRecognition?: { new (): SR } }).webkitSpeechRecognition)
    : undefined;
const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

const isIOS = typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
   (navigator.platform === 'MacIntel' && (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints! > 1));
const isSafari = typeof navigator !== 'undefined' &&
  /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
const mediaRecorderSupported = typeof window !== 'undefined' && typeof (window as unknown as { MediaRecorder?: unknown }).MediaRecorder !== 'undefined';

// iOS Safari's SpeechRecognition is unreliable for continuous dictation — always
// use the server-transcribe (MediaRecorder) path on iOS/Safari when MediaRecorder works.
const useRecorderPath = mediaRecorderSupported && (isIOS || isSafari || !SpeechRecognitionCtor);
const sttSupported = !!SpeechRecognitionCtor && !useRecorderPath;

function speak(text: string, onDone?: () => void) {
  if (!ttsSupported || !text) { onDone?.(); return () => {}; }
  try { window.speechSynthesis.cancel(); } catch { /* noop */ }
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
  let done = false;
  const finish = () => { if (done) return; done = true; onDone?.(); };
  u.onend = finish; u.onerror = finish;
  try { window.speechSynthesis.speak(u); } catch { finish(); }
  return () => { try { window.speechSynthesis.cancel(); } catch { /* noop */ } finish(); };
}

function spokeToSkillFocus(spoke: string): string {
  const s = spoke.toLowerCase();
  if (s.includes('objection')) return 'objection_handling';
  if (s.includes('discovery')) return 'discovery';
  if (s.includes('qualific')) return 'qualification';
  if (s.includes('deal') || s.includes('control')) return 'deal_control';
  if (s.includes('c_suite') || s.includes('exec') || s.includes('stakeholder')) return 'executive_response';
  return 'objection_handling';
}

// Pick a MediaRecorder mimeType the browser supports.
function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/mpeg'];
  for (const c of candidates) {
    try { if ((MediaRecorder as unknown as { isTypeSupported?: (s: string) => boolean }).isTypeSupported?.(c)) return c; } catch { /* noop */ }
  }
  return undefined; // let the browser choose
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  }
  return btoa(bin);
}

export default function CarMode() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [drills, setDrills] = useState<Drill[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const turnIndexRef = useRef(0);
  const recogRef = useRef<SR | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const cancelSpeakRef = useRef<() => void>(() => {});
  // MediaRecorder refs
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recMimeRef = useRef<string>('audio/webm');

  const drill = drills[idx];

  // ── Load ready drills ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setLoadError(null);
      const { data: rows, error } = await (supabase as any)
        .from('ki_curriculum')
        .select('ki_id, concept_id, drill_scenario, drill_spoken_task, drill_response_shape, drill_model_answer, drill_rubric')
        .eq('drill_ready', true);
      if (cancelled) return;
      if (error) { setLoadError(error.message); setLoading(false); return; }
      const r = (rows ?? []) as Array<{
        ki_id: string; concept_id: string;
        drill_scenario: string; drill_spoken_task: string;
        drill_response_shape: string; drill_model_answer: string;
        drill_rubric: unknown;
      }>;
      if (r.length === 0) { setDrills([]); setLoading(false); return; }
      const conceptIds = Array.from(new Set(r.map((x) => x.concept_id)));
      const kiIds = Array.from(new Set(r.map((x) => x.ki_id)));
      const [{ data: cc }, { data: ki }] = await Promise.all([
        (supabase as any).from('curriculum_concepts').select('concept_id, spoke, title').in('concept_id', conceptIds),
        supabase.from('knowledge_items').select('id, title, spider_dimension, chapter').in('id', kiIds),
      ]);
      const cMap = new Map<string, { spoke: string; title: string }>();
      for (const c of (cc ?? []) as Array<{ concept_id: string; spoke: string; title: string }>) {
        cMap.set(c.concept_id, { spoke: c.spoke, title: c.title });
      }
      const kMap = new Map<string, { title: string; spider_dimension: string | null; chapter: string | null }>();
      for (const k of (ki ?? []) as Array<{ id: string; title: string; spider_dimension: string | null; chapter: string | null }>) {
        kMap.set(k.id, { title: k.title, spider_dimension: k.spider_dimension, chapter: k.chapter });
      }
      const list: Drill[] = r.map((x) => {
        const c = cMap.get(x.concept_id);
        const k = kMap.get(x.ki_id);
        const rub = Array.isArray(x.drill_rubric) ? (x.drill_rubric as Array<{ c: string; must?: boolean }>) : [];
        return {
          ki_id: x.ki_id,
          concept_id: x.concept_id,
          spoke: c?.spoke ?? 'general',
          concept_title: c?.title ?? 'Drill',
          ki_title: k?.title ?? '',
          scenario: x.drill_scenario ?? '',
          spoken_task: x.drill_spoken_task ?? '',
          response_shape: (x.drill_response_shape === 'quick_reply' ? 'quick_reply' : 'talk_track'),
          model_answer: x.drill_model_answer ?? '',
          rubric: rub,
          spider_dimension: k?.spider_dimension ?? null,
          chapter: k?.chapter ?? null,
        };
      });
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      setDrills(list); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
      try { recogRef.current?.stop(); } catch { /* noop */ }
      try { mediaRecRef.current?.stop(); } catch { /* noop */ }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
    };
  }, []);

  // ── Session ───────────────────────────────────────────────────────
  const ensureSession = useCallback(async (d: Drill) => {
    if (!user?.id || sessionIdRef.current) return;
    const { data } = await (supabase as any)
      .from('dojo_sessions')
      .insert({
        user_id: user.id,
        mode: 'autopilot',
        session_type: 'drill',
        skill_focus: spokeToSkillFocus(d.spoke),
        difficulty: 'standard',
        status: 'active',
        scenario_title: `Car Mode · ${d.concept_title}`,
        scenario_context: d.scenario,
        scenario_objection: d.spoken_task,
        ki_source_id: d.ki_id,
        ki_chapter: d.chapter,
        ki_spider_dimension: d.spider_dimension,
        ki_ideal_response: d.model_answer,
        audio_metrics: { car_mode: true, capture: useRecorderPath ? 'recorder' : 'webspeech' },
      })
      .select('id')
      .single();
    sessionIdRef.current = (data as { id?: string } | null)?.id ?? null;
  }, [user?.id]);

  // ── Shared post-grade handler (persistence + spoken feedback) ────
  const applyGrade = useCallback(async (d: Drill, finalTranscript: string, g: GradeResult) => {
    setTranscript(finalTranscript);
    setGrade(g);
    if (user?.id) {
      try {
        await writeKIMastery({
          userId: user.id,
          kiId: d.ki_id,
          chapter: d.chapter ?? d.spoke,
          spiderDimension: d.spider_dimension,
          score: g.score,
          executionScore: g.score,
        });
      } catch (e) { console.error('ki_mastery write failed', e); }
      if (sessionIdRef.current) {
        try {
          await (supabase as any).from('dojo_session_turns').insert({
            session_id: sessionIdRef.current,
            user_id: user.id,
            turn_index: turnIndexRef.current++,
            prompt_text: `${d.scenario}\n\n${d.spoken_task}`,
            user_response: finalTranscript,
            score: g.score,
            feedback: g.summary,
            top_mistake: g.top_fix,
            improved_version: g.elite_line || d.model_answer,
            score_json: g as unknown as Record<string, unknown>,
          });
          await (supabase as any).from('dojo_sessions').update({
            latest_score: g.score,
            best_score: g.score,
            updated_at: new Date().toISOString(),
          }).eq('id', sessionIdRef.current);
        } catch (e) { console.error('dojo_sessions write failed', e); }
      }
    }
    setPhase('feedback');
    const verbal = `${g.score} out of 100. ${g.top_fix} Elite sounded like: ${g.elite_line}`;
    cancelSpeakRef.current = speak(verbal, () => {
      cancelSpeakRef.current = speak('Say next, again, or show me.', () => {
        if (SpeechRecognitionCtor && !useRecorderPath) listenForCommand();
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── PATH A: browser Web Speech STT (Chrome) ──────────────────────
  const stopListening = useCallback(() => {
    try { recogRef.current?.stop(); } catch { /* noop */ }
    if (silenceTimerRef.current) { window.clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  }, []);

  const startListening = useCallback((onFinal: (text: string) => void) => {
    if (!SpeechRecognitionCtor) return false;
    let finalText = '';
    setTranscript(''); setInterim('');
    const recog: SR = new SpeechRecognitionCtor();
    recog.continuous = true;
    recog.interimResults = true;
    recog.lang = 'en-US';
    const resetSilence = () => {
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = window.setTimeout(() => {
        try { recog.stop(); } catch { /* noop */ }
      }, 2500);
    };
    recog.onresult = (e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean; length: number }>; resultIndex: number }) => {
      let intr = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + ' ';
        else intr += r[0].transcript;
      }
      setTranscript(finalText.trim());
      setInterim(intr);
      resetSilence();
    };
    recog.onerror = (e: { error?: string }) => {
      if (e.error === 'no-speech') return;
      setErrMsg(`Mic error: ${e.error ?? 'unknown'}`);
    };
    recog.onend = () => {
      if (silenceTimerRef.current) { window.clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
      onFinal(finalText.trim());
    };
    recogRef.current = recog;
    try { recog.start(); resetSilence(); return true; }
    catch (err) { setErrMsg(`Mic start failed: ${(err as Error).message}`); return false; }
  }, []);

  const gradeTextPath = useCallback(async (d: Drill, finalTranscript: string) => {
    if (!finalTranscript) {
      setPhase('listening'); setErrMsg("Didn't catch that. Tap Done to try again.");
      return;
    }
    setPhase('grading');
    cancelSpeakRef.current = speak('Scoring.', () => {});
    try {
      const { data, error } = await supabase.functions.invoke('car-mode-score', {
        body: {
          transcript: finalTranscript,
          scenario: d.scenario,
          spokenTask: d.spoken_task,
          modelAnswer: d.model_answer,
          rubric: d.rubric,
          responseShape: d.response_shape,
        },
      });
      if (error) throw error;
      await applyGrade(d, finalTranscript, data as GradeResult);
    } catch (e) {
      setPhase('error');
      setErrMsg(`Couldn't grade: ${(e as Error).message}`);
      cancelSpeakRef.current = speak('Could not grade that one. Tap retry.');
    }
  }, [applyGrade]);

  // ── PATH B: MediaRecorder → server transcribe+grade (iOS/Safari) ─
  const startRecording = useCallback(async (): Promise<boolean> => {
    setTranscript(''); setInterim(''); setErrMsg(null);
    recChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = stream;
      const mime = pickRecorderMime();
      recMimeRef.current = mime ?? 'audio/webm';
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      // Capture actual mimeType chosen by the browser (may include codecs param)
      if (rec.mimeType) recMimeRef.current = rec.mimeType;
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) recChunksRef.current.push(ev.data); };
      mediaRecRef.current = rec;
      rec.start();
      return true;
    } catch (err) {
      const msg = (err as Error).message || 'mic blocked';
      setErrMsg(`Microphone blocked: ${msg}`);
      cancelSpeakRef.current = speak('I need microphone access. Please enable it and tap retry.');
      setPhase('error');
      return false;
    }
  }, []);

  const stopRecordingAndGrade = useCallback(async (d: Drill) => {
    const rec = mediaRecRef.current;
    const stream = mediaStreamRef.current;
    if (!rec) return;
    setPhase('grading');
    cancelSpeakRef.current = speak('Scoring.', () => {});
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      try { rec.stop(); } catch { resolve(); }
    });
    stream?.getTracks().forEach((t) => t.stop());
    mediaRecRef.current = null;
    mediaStreamRef.current = null;
    const blob = new Blob(recChunksRef.current, { type: recMimeRef.current });
    recChunksRef.current = [];
    if (blob.size < 1500) {
      setPhase('error');
      setErrMsg("That recording was empty — try again.");
      cancelSpeakRef.current = speak("I didn't hear anything. Tap retry.");
      return;
    }
    try {
      const audioBase64 = await blobToBase64(blob);
      const { data, error } = await supabase.functions.invoke('car-mode-audio-score', {
        body: {
          audioBase64,
          mimeType: recMimeRef.current,
          scenario: d.scenario,
          spokenTask: d.spoken_task,
          modelAnswer: d.model_answer,
          rubric: d.rubric,
          responseShape: d.response_shape,
        },
      });
      if (error) throw error;
      const resp = data as GradeResult & { transcript?: string };
      const tx = (resp.transcript ?? '').trim();
      if (!tx) {
        setPhase('error');
        setErrMsg("Couldn't hear that clearly — try again.");
        cancelSpeakRef.current = speak("I couldn't hear that clearly. Tap retry.");
        return;
      }
      await applyGrade(d, tx, resp);
    } catch (e) {
      setPhase('error');
      setErrMsg(`Couldn't grade: ${(e as Error).message}`);
      cancelSpeakRef.current = speak('Could not grade that one. Tap retry.');
    }
  }, [applyGrade]);

  // ── Phase runner ─────────────────────────────────────────────────
  const runDrill = useCallback(async (d: Drill) => {
    setGrade(null); setErrMsg(null); setTranscript(''); setInterim('');
    await ensureSession(d);
    setPhase('intro');
    cancelSpeakRef.current = speak(`Skill: ${d.concept_title}.`, () => {
      setPhase('scenario');
      cancelSpeakRef.current = speak(d.scenario, () => {
        setPhase('task');
        cancelSpeakRef.current = speak(`${d.spoken_task} Go.`, async () => {
          setPhase('listening');
          if (useRecorderPath) {
            await startRecording();
          } else {
            if (!startListening((finalText) => gradeTextPath(d, finalText))) {
              setPhase('listening');
            }
          }
        });
      });
    });
  }, [ensureSession, startListening, gradeTextPath, startRecording]);

  // ── Voice command listener (Chrome-only after feedback) ──────────
  const listenForCommand = useCallback(() => {
    if (!SpeechRecognitionCtor || useRecorderPath) return;
    let final = '';
    const r: SR = new SpeechRecognitionCtor();
    r.continuous = false; r.interimResults = false; r.lang = 'en-US';
    r.onresult = (e: { results: ArrayLike<{ 0: { transcript: string } }>; }) => {
      final = e.results[0]?.[0]?.transcript?.toLowerCase().trim() ?? '';
    };
    r.onend = () => {
      if (!final) return;
      if (/(next|forward|skip)/.test(final)) handleNext();
      else if (/(again|retry|repeat that)/.test(final)) handleAgain();
      else if (/(show|reveal|elite|gold)/.test(final)) handleReveal();
      else if (/(repeat|say it again|play back)/.test(final)) handleRepeatFeedback();
    };
    recogRef.current = r;
    try { r.start(); } catch { /* noop */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Controls ─────────────────────────────────────────────────────
  const handleNext = useCallback(() => {
    stopListening();
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    if (idx + 1 >= drills.length) {
      setPhase('idle');
      speak('That was the last drill. Great work.');
      return;
    }
    setIdx((i) => i + 1);
  }, [idx, drills.length, stopListening]);

  const handleAgain = useCallback(() => {
    stopListening();
    try { mediaRecRef.current?.stop(); } catch { /* noop */ }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaRecRef.current = null;
    mediaStreamRef.current = null;
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    if (drill) runDrill(drill);
  }, [drill, runDrill, stopListening]);

  const handleReveal = useCallback(() => {
    if (!drill) return;
    setPhase('reveal');
    cancelSpeakRef.current = speak(`Elite answer: ${drill.model_answer}`, () => {
      if (SpeechRecognitionCtor && !useRecorderPath) listenForCommand();
    });
  }, [drill, listenForCommand]);

  const handleRepeatFeedback = useCallback(() => {
    if (!grade) return;
    cancelSpeakRef.current = speak(`${grade.score} out of 100. ${grade.top_fix} Elite sounded like: ${grade.elite_line}`, () => {
      if (SpeechRecognitionCtor && !useRecorderPath) listenForCommand();
    });
  }, [grade]);

  const handleStart = useCallback(() => {
    if (drills.length === 0) return;
    runDrill(drills[idx]);
  }, [drills, idx, runDrill]);

  // "Done" button — finishes listening and triggers grading
  const handleDone = useCallback(() => {
    if (useRecorderPath) {
      if (drill) stopRecordingAndGrade(drill);
    } else {
      stopListening();
    }
  }, [drill, stopListening, stopRecordingAndGrade]);

  const startedRef = useRef(false);
  useEffect(() => {
    if (!startedRef.current) return;
    if (drill) runDrill(drill);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  const onPressStart = () => { startedRef.current = true; handleStart(); };

  // ── Render ───────────────────────────────────────────────────────
  const bigText = useMemo(() => {
    if (!drill) return '';
    if (phase === 'intro') return `Skill: ${drill.concept_title}`;
    if (phase === 'scenario') return drill.scenario;
    if (phase === 'task') return drill.spoken_task;
    if (phase === 'listening') return transcript || interim || (useRecorderPath ? '🎙 Recording — tap Done when finished' : '🎙 Speak your answer…');
    if (phase === 'grading') return 'Scoring your answer…';
    if (phase === 'reveal') return drill.model_answer;
    return drill.concept_title;
  }, [phase, drill, transcript, interim]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-white/70 text-sm">
          <ArrowLeft className="h-5 w-5" /> Exit
        </button>
        <div className="text-sm font-mono text-white/60">
          {drills.length > 0 ? `${Math.min(idx + 1, drills.length)} / ${drills.length}` : ''}
        </div>
        <div className="w-12" />
      </div>

      <div className="flex-1 flex flex-col px-6 py-8">
        {loading && <p className="text-2xl text-white/60 m-auto">Loading drills…</p>}

        {!loading && loadError && (
          <p className="text-xl text-red-400 m-auto">Could not load drills: {loadError}</p>
        )}

        {!loading && !loadError && drills.length === 0 && (
          <p className="text-2xl text-white/70 m-auto text-center">No car-ready drills yet. Check back soon.</p>
        )}

        {!loading && !loadError && drill && (
          <>
            <div className="text-center text-xs uppercase tracking-widest text-white/40 mb-4">
              {phase === 'idle' && 'Ready'}
              {phase === 'intro' && 'Setting up'}
              {phase === 'scenario' && 'Scenario'}
              {phase === 'task' && 'Your task'}
              {phase === 'listening' && (useRecorderPath ? 'Recording' : (sttSupported ? 'Listening' : 'Speak — manual mode'))}
              {phase === 'grading' && 'Grading'}
              {phase === 'feedback' && grade && (grade.passed ? '✓ Pass' : '✗ Try again')}
              {phase === 'reveal' && 'Elite answer'}
              {phase === 'error' && 'Error'}
            </div>

            <div className="flex-1 flex items-center justify-center">
              <Card className="bg-white/5 border-white/10 p-6 sm:p-10 w-full">
                <p className="text-2xl sm:text-4xl leading-tight text-center font-medium text-white">
                  {bigText}
                </p>
                {phase === 'listening' && interim && (
                  <p className="text-base text-white/40 italic text-center mt-4">{interim}</p>
                )}
                {phase === 'feedback' && grade && (
                  <div className="mt-6 space-y-3 text-left">
                    <div className="flex items-baseline gap-3">
                      <span className="text-6xl font-bold font-mono text-white">{grade.score}</span>
                      <span className="text-white/50">/ 100</span>
                    </div>
                    <p className="text-xl"><span className="text-white/50">Fix: </span>{grade.top_fix}</p>
                    <p className="text-lg text-white/70"><span className="text-white/40">Elite: </span>{grade.elite_line}</p>
                    {transcript && (
                      <p className="text-sm text-white/50 italic mt-2">You said: "{transcript}"</p>
                    )}
                    {grade.criteria?.length > 0 && (
                      <ul className="text-sm space-y-1 mt-2">
                        {grade.criteria.map((c, i) => (
                          <li key={i} className={c.met ? 'text-emerald-400' : 'text-red-400'}>
                            {c.met ? '✓' : '✗'} {c.c}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </Card>
            </div>

            {errMsg && (
              <p className="text-center text-red-400 text-sm mt-3">{errMsg}</p>
            )}

            <div className="mt-6 grid gap-3">
              {phase === 'idle' && (
                <Button onClick={onPressStart} className="h-20 text-2xl rounded-2xl bg-emerald-600 hover:bg-emerald-500">
                  <Volume2 className="h-7 w-7 mr-2" /> Start Car Mode
                </Button>
              )}

              {phase === 'listening' && (
                <Button onClick={handleDone} className="h-20 text-2xl rounded-2xl bg-blue-600 hover:bg-blue-500">
                  <MicOff className="h-7 w-7 mr-2" /> Done
                </Button>
              )}

              {(phase === 'feedback' || phase === 'reveal' || phase === 'error') && (
                <div className="grid grid-cols-3 gap-3">
                  <Button onClick={handleAgain} className="h-20 text-lg rounded-2xl bg-white/10 hover:bg-white/20" variant="outline">
                    <RotateCcw className="h-6 w-6 mr-1" /> Again
                  </Button>
                  <Button onClick={handleReveal} className="h-20 text-lg rounded-2xl bg-white/10 hover:bg-white/20" variant="outline">
                    <Eye className="h-6 w-6 mr-1" /> Show me
                  </Button>
                  <Button onClick={handleNext} className="h-20 text-lg rounded-2xl bg-emerald-600 hover:bg-emerald-500">
                    <SkipForward className="h-6 w-6 mr-1" /> Next
                  </Button>
                </div>
              )}

              {phase === 'grading' && (
                <div className="h-20 flex items-center justify-center text-white/60">Scoring…</div>
              )}

              {(phase === 'intro' || phase === 'scenario' || phase === 'task') && (
                <Button onClick={async () => {
                  try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
                  setPhase('listening');
                  if (useRecorderPath) {
                    await startRecording();
                  } else {
                    startListening((t) => gradeTextPath(drill, t));
                  }
                }} className="h-20 text-xl rounded-2xl bg-blue-600 hover:bg-blue-500">
                  <Mic className="h-6 w-6 mr-2" /> I'm ready — listen now
                </Button>
              )}
            </div>

            {useRecorderPath && (
              <p className="text-center text-white/40 text-xs mt-3">
                iOS / Safari mode · recording + server transcription
              </p>
            )}
            {!useRecorderPath && !sttSupported && (
              <p className="text-center text-amber-400 text-xs mt-3">
                Voice recognition isn't supported in this browser. TTS + tap controls still work.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
