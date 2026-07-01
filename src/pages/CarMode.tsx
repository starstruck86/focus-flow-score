/**
 * Car Mode — fully hands-free, audio-first practice.
 *
 * Flow after a single "Start" tap:
 *   TTS speaks scenario + task → AUTO-records on the persistent mic stream →
 *   VAD auto-stops ~2.5s after speech ends (60s hard cap) → server transcribes
 *   (audio-only) then grades → TTS speaks feedback → AUTO-advances.
 *
 * Persistent mic stream: getUserMedia is called ONCE on Start. The same stream
 * powers MediaRecorder segments and the Web Audio VAD analyser for the whole
 * session, so no further user gesture is needed on iOS Safari.
 *
 * Two capture paths still exist:
 *   - Chrome desktop/Android: Web Speech live STT, scored via `car-mode-score`.
 *   - iOS / Safari / no STT: MediaRecorder → `car-mode-audio-score`
 *     (transcribe-then-grade pipeline; never confabulates).
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

const useRecorderPath = mediaRecorderSupported && (isIOS || isSafari || !SpeechRecognitionCtor);
const sttSupported = !!SpeechRecognitionCtor && !useRecorderPath;

// VAD tuning
const VAD_SILENCE_MS = 2500;        // stop ~2.5s after speech ends
const VAD_MAX_MS = 60_000;          // hard cap on a single answer
const VAD_NO_SPEECH_MS = 5000;      // if nothing heard within 5s, "didn't catch"
const VAD_RMS_THRESHOLD = 0.025;    // ~ -32 dBFS; above this counts as speech

function speak(text: string, onDone?: () => void) {
  if (!ttsSupported || !text) { onDone?.(); return () => {}; }
  try { window.speechSynthesis.cancel(); } catch { /* noop */ }
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
  let done = false;
  let timer: number | null = null;
  const finish = () => {
    if (done) return; done = true;
    if (timer != null) { window.clearTimeout(timer); timer = null; }
    onDone?.();
  };
  u.onend = finish; u.onerror = finish;
  try { window.speechSynthesis.speak(u); } catch { finish(); }
  // iOS Safari's onend is unreliable — force-advance on a duration estimate.
  // ~160 wpm ⇒ ms per word ≈ 375; add 800ms buffer; floor 2500ms.
  const words = Math.max(1, text.trim().split(/\s+/).length);
  const estMs = Math.max(2500, Math.round((words / 160) * 60000) + 800);
  timer = window.setTimeout(finish, estMs);
  return () => {
    try { window.speechSynthesis.cancel(); } catch { /* noop */ }
    finish();
  };
}

/**
 * MUST be called synchronously from inside a user-gesture handler (e.g. click).
 * Authorises speechSynthesis and AudioContext for the rest of the iOS Safari session.
 */
function primeAudioInGesture(audioCtxRef: React.MutableRefObject<AudioContext | null>) {
  if (ttsSupported) {
    try {
      window.speechSynthesis.cancel();
      const warm = new SpeechSynthesisUtterance(' ');
      warm.volume = 0;
      window.speechSynthesis.speak(warm);
    } catch { /* noop */ }
  }
  if (!audioCtxRef.current) {
    const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) {
      try {
        const ctx = new Ctor();
        audioCtxRef.current = ctx;
        void ctx.resume().catch(() => {});
      } catch { /* noop */ }
    }
  } else {
    try { void audioCtxRef.current.resume().catch(() => {}); } catch { /* noop */ }
  }
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

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/mpeg'];
  for (const c of candidates) {
    try { if ((MediaRecorder as unknown as { isTypeSupported?: (s: string) => boolean }).isTypeSupported?.(c)) return c; } catch { /* noop */ }
  }
  return undefined;
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

  // Persistent stream + audio graph for VAD
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const vadMaxTimerRef = useRef<number | null>(null);

  // Current MediaRecorder segment
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recMimeRef = useRef<string>('audio/webm');

  const drill = drills[idx];
  const drillRef = useRef<Drill | undefined>(drill);
  useEffect(() => { drillRef.current = drill; }, [drill]);

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
          ki_id: x.ki_id, concept_id: x.concept_id,
          spoke: c?.spoke ?? 'general', concept_title: c?.title ?? 'Drill',
          ki_title: k?.title ?? '',
          scenario: x.drill_scenario ?? '', spoken_task: x.drill_spoken_task ?? '',
          response_shape: (x.drill_response_shape === 'quick_reply' ? 'quick_reply' : 'talk_track'),
          model_answer: x.drill_model_answer ?? '', rubric: rub,
          spider_dimension: k?.spider_dimension ?? null, chapter: k?.chapter ?? null,
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

  // Teardown on unmount
  useEffect(() => {
    return () => { tearDownMicGraph(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearVadTimers() {
    if (vadRafRef.current != null) { cancelAnimationFrame(vadRafRef.current); vadRafRef.current = null; }
    if (vadMaxTimerRef.current != null) { window.clearTimeout(vadMaxTimerRef.current); vadMaxTimerRef.current = null; }
    if (silenceTimerRef.current != null) { window.clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  }

  function tearDownMicGraph() {
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    try { recogRef.current?.stop(); } catch { /* noop */ }
    try { mediaRecRef.current?.stop(); } catch { /* noop */ }
    clearVadTimers();
    try { sourceRef.current?.disconnect(); } catch { /* noop */ }
    try { analyserRef.current?.disconnect(); } catch { /* noop */ }
    try { audioCtxRef.current?.close(); } catch { /* noop */ }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    sourceRef.current = null;
    analyserRef.current = null;
    audioCtxRef.current = null;
    mediaStreamRef.current = null;
    mediaRecRef.current = null;
  }

  // Acquire mic + attach analyser to the (already-created) AudioContext.
  // AudioContext is created synchronously in the Start gesture via primeAudioInGesture,
  // so we only need to await getUserMedia here. Safe to call from a non-gesture context
  // because permission was granted by the earlier Start tap.
  const acquireMicGraph = useCallback(async (): Promise<boolean> => {
    if (mediaStreamRef.current && analyserRef.current) return true;
    try {
      if (!mediaStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        mediaStreamRef.current = stream;
      }
      const stream = mediaStreamRef.current;
      let ctx = audioCtxRef.current;
      if (!ctx) {
        const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
          ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) {
          ctx = new Ctor();
          audioCtxRef.current = ctx;
        }
      }
      if (ctx && stream && !analyserRef.current) {
        try { await ctx.resume(); } catch { /* noop */ }
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        sourceRef.current = src;
        analyserRef.current = analyser;
      }
      return true;
    } catch (err) {
      setErrMsg(`Microphone blocked: ${(err as Error).message || 'permission denied'}`);
      cancelSpeakRef.current = speak('I need microphone access. Please enable it and tap Start again.');
      setPhase('error');
      return false;
    }
  }, []);

  // ── Session ───────────────────────────────────────────────────────
  const ensureSession = useCallback(async (d: Drill) => {
    if (!user?.id || sessionIdRef.current) return;
    const { data } = await (supabase as any)
      .from('dojo_sessions')
      .insert({
        user_id: user.id, mode: 'autopilot', session_type: 'drill',
        skill_focus: spokeToSkillFocus(d.spoke), difficulty: 'standard', status: 'active',
        scenario_title: `Car Mode · ${d.concept_title}`,
        scenario_context: d.scenario, scenario_objection: d.spoken_task,
        ki_source_id: d.ki_id, ki_chapter: d.chapter,
        ki_spider_dimension: d.spider_dimension, ki_ideal_response: d.model_answer,
        audio_metrics: { car_mode: true, capture: useRecorderPath ? 'recorder' : 'webspeech', hands_free: true },
      })
      .select('id').single();
    sessionIdRef.current = (data as { id?: string } | null)?.id ?? null;
  }, [user?.id]);

  // ── Shared post-grade handler ────────────────────────────────────
  const advance = useCallback(() => {
    setIdx((i) => {
      if (i + 1 >= drills.length) {
        setPhase('idle');
        speak('That was the last drill. Great work.');
        return i;
      }
      return i + 1;
    });
  }, [drills.length]);

  const applyGrade = useCallback(async (d: Drill, finalTranscript: string, g: GradeResult) => {
    setTranscript(finalTranscript);
    setGrade(g);
    if (user?.id) {
      try {
        await writeKIMastery({
          userId: user.id, kiId: d.ki_id,
          chapter: d.chapter ?? d.spoke, spiderDimension: d.spider_dimension,
          score: g.score, executionScore: g.score,
        });
      } catch (e) { console.error('ki_mastery write failed', e); }
      if (sessionIdRef.current) {
        try {
          await (supabase as any).from('dojo_session_turns').insert({
            session_id: sessionIdRef.current, user_id: user.id,
            turn_index: turnIndexRef.current++,
            prompt_text: `${d.scenario}\n\n${d.spoken_task}`,
            user_response: finalTranscript, score: g.score,
            feedback: g.summary, top_mistake: g.top_fix,
            improved_version: g.elite_line || d.model_answer,
            score_json: g as unknown as Record<string, unknown>,
          });
          await (supabase as any).from('dojo_sessions').update({
            latest_score: g.score, best_score: g.score,
            updated_at: new Date().toISOString(),
          }).eq('id', sessionIdRef.current);
        } catch (e) { console.error('dojo_sessions write failed', e); }
      }
    }
    setPhase('feedback');
    const verbal = `${g.score} out of 100. ${g.top_fix} Elite sounded like: ${g.elite_line}`;
    cancelSpeakRef.current = speak(verbal, () => { advance(); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, advance]);

  // ── PATH A: Chrome Web Speech STT ────────────────────────────────
  const stopListening = useCallback(() => {
    try { recogRef.current?.stop(); } catch { /* noop */ }
    if (silenceTimerRef.current) { window.clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  }, []);

  const startListening = useCallback((onFinal: (text: string) => void) => {
    if (!SpeechRecognitionCtor) return false;
    let finalText = '';
    setTranscript(''); setInterim('');
    const recog: SR = new SpeechRecognitionCtor();
    recog.continuous = true; recog.interimResults = true; recog.lang = 'en-US';
    const resetSilence = () => {
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = window.setTimeout(() => { try { recog.stop(); } catch { /* noop */ } }, VAD_SILENCE_MS);
    };
    recog.onresult = (e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean; length: number }>; resultIndex: number }) => {
      let intr = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + ' '; else intr += r[0].transcript;
      }
      setTranscript(finalText.trim()); setInterim(intr);
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
      cancelSpeakRef.current = speak("I didn't catch anything — give it another go.", () => { runDrill(d); });
      return;
    }
    setPhase('grading');
    try {
      const { data, error } = await supabase.functions.invoke('car-mode-score', {
        body: {
          transcript: finalTranscript, scenario: d.scenario, spokenTask: d.spoken_task,
          modelAnswer: d.model_answer, rubric: d.rubric, responseShape: d.response_shape,
        },
      });
      if (error) throw error;
      await applyGrade(d, finalTranscript, data as GradeResult);
    } catch (e) {
      setPhase('error');
      setErrMsg(`Couldn't grade: ${(e as Error).message}`);
      cancelSpeakRef.current = speak('Could not grade that one. Moving on.', () => advance());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyGrade, advance]);

  // ── PATH B: MediaRecorder segment on persistent stream + VAD ─────
  const startRecorderSegment = useCallback(async (d: Drill) => {
    // Mic acquisition may still be pending from the Start tap — await it here.
    if (!mediaStreamRef.current || !analyserRef.current) {
      const ok = await acquireMicGraph();
      if (!ok) return;
    }
    const stream = mediaStreamRef.current;
    const analyser = analyserRef.current;
    if (!stream) {
      setErrMsg('Mic not initialized — tap Start.');
      setPhase('error');
      return;
    }
    setTranscript(''); setInterim(''); setErrMsg(null);
    recChunksRef.current = [];

    const mime = pickRecorderMime();
    recMimeRef.current = mime ?? 'audio/webm';
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (err) {
      setErrMsg(`Recorder failed: ${(err as Error).message}`);
      setPhase('error');
      return;
    }
    if (rec.mimeType) recMimeRef.current = rec.mimeType;

    let stopped = false;
    let speechDetected = false;
    let lastSpeechAt = performance.now();
    const startedAt = performance.now();

    const finalize = async () => {
      if (stopped) return; stopped = true;
      clearVadTimers();
      const blob = new Blob(recChunksRef.current, { type: recMimeRef.current });
      recChunksRef.current = [];

      if (!speechDetected || blob.size < 1500) {
        // No real speech — re-arm without grading.
        cancelSpeakRef.current = speak("I didn't catch anything — give it another go.", () => {
          if (drillRef.current && drillRef.current.ki_id === d.ki_id) startRecorderSegment(d);
        });
        return;
      }

      setPhase('grading');
      try {
        const audioBase64 = await blobToBase64(blob);
        const { data, error } = await supabase.functions.invoke('car-mode-audio-score', {
          body: {
            audioBase64, mimeType: recMimeRef.current,
            scenario: d.scenario, spokenTask: d.spoken_task,
            modelAnswer: d.model_answer, rubric: d.rubric, responseShape: d.response_shape,
          },
        });
        if (error) throw error;
        const resp = data as GradeResult & { transcript?: string };
        const tx = (resp.transcript ?? '').trim();
        if (!tx || resp.score === 0) {
          // Server said no answer — re-arm.
          cancelSpeakRef.current = speak("I didn't catch a clear answer — give it another go.", () => {
            if (drillRef.current && drillRef.current.ki_id === d.ki_id) startRecorderSegment(d);
          });
          return;
        }
        await applyGrade(d, tx, resp);
      } catch (e) {
        setPhase('error');
        setErrMsg(`Couldn't grade: ${(e as Error).message}`);
        cancelSpeakRef.current = speak('Could not grade that one. Moving on.', () => advance());
      }
    };

    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) recChunksRef.current.push(ev.data); };
    rec.onstop = () => { void finalize(); };
    mediaRecRef.current = rec;

    try { rec.start(); } catch (err) {
      setErrMsg(`Recorder start failed: ${(err as Error).message}`);
      setPhase('error');
      return;
    }

    // Hard cap
    vadMaxTimerRef.current = window.setTimeout(() => {
      try { rec.state !== 'inactive' && rec.stop(); } catch { /* noop */ }
    }, VAD_MAX_MS);

    // VAD loop
    if (analyser) {
      const buf = new Float32Array(analyser.fftSize);
      const loop = () => {
        if (stopped) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        if (rms > VAD_RMS_THRESHOLD) {
          speechDetected = true;
          lastSpeechAt = now;
        } else if (speechDetected && (now - lastSpeechAt) > VAD_SILENCE_MS) {
          try { rec.state !== 'inactive' && rec.stop(); } catch { /* noop */ }
          return;
        } else if (!speechDetected && (now - startedAt) > VAD_NO_SPEECH_MS) {
          try { rec.state !== 'inactive' && rec.stop(); } catch { /* noop */ }
          return;
        }
        vadRafRef.current = requestAnimationFrame(loop);
      };
      vadRafRef.current = requestAnimationFrame(loop);
    } else {
      // No analyser — fall back to fixed-window record
      silenceTimerRef.current = window.setTimeout(() => {
        speechDetected = true; // can't tell, assume content
        try { rec.state !== 'inactive' && rec.stop(); } catch { /* noop */ }
      }, 8000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyGrade, advance]);

  // ── Phase runner ─────────────────────────────────────────────────
  const runDrill = useCallback(async (d: Drill) => {
    setGrade(null); setErrMsg(null); setTranscript(''); setInterim('');
    await ensureSession(d);
    // Try to keep AudioContext alive across drills
    try { await audioCtxRef.current?.resume(); } catch { /* noop */ }
    setPhase('intro');
    cancelSpeakRef.current = speak(`Skill: ${d.concept_title}.`, () => {
      setPhase('scenario');
      cancelSpeakRef.current = speak(d.scenario, () => {
        setPhase('task');
        cancelSpeakRef.current = speak(`${d.spoken_task} Go.`, () => {
          setPhase('listening');
          if (useRecorderPath) {
            startRecorderSegment(d);
          } else {
            if (!startListening((finalText) => gradeTextPath(d, finalText))) {
              setPhase('listening');
            }
          }
        });
      });
    });
  }, [ensureSession, startListening, gradeTextPath, startRecorderSegment]);

  const runDrillRef = useRef(runDrill);
  useEffect(() => { runDrillRef.current = runDrill; }, [runDrill]);

  // ── Controls ─────────────────────────────────────────────────────
  const handleNext = useCallback(() => {
    stopListening();
    try { mediaRecRef.current?.state !== 'inactive' && mediaRecRef.current?.stop(); } catch { /* noop */ }
    clearVadTimers();
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    advance();
  }, [stopListening, advance]);

  const handleAgain = useCallback(() => {
    stopListening();
    try { mediaRecRef.current?.state !== 'inactive' && mediaRecRef.current?.stop(); } catch { /* noop */ }
    clearVadTimers();
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    if (drill) runDrill(drill);
  }, [drill, runDrill, stopListening]);

  const handleReveal = useCallback(() => {
    if (!drill) return;
    setPhase('reveal');
    cancelSpeakRef.current = speak(`Elite answer: ${drill.model_answer}`, () => {});
  }, [drill]);

  const handleStart = useCallback(async () => {
    if (drills.length === 0) return;
    if (useRecorderPath) {
      const ok = await acquireMicGraph();
      if (!ok) return;
    }
    runDrill(drills[idx]);
  }, [drills, idx, runDrill, acquireMicGraph]);

  // Optional manual "done" fallback
  const handleDone = useCallback(() => {
    if (useRecorderPath) {
      try { mediaRecRef.current?.state !== 'inactive' && mediaRecRef.current?.stop(); } catch { /* noop */ }
    } else {
      stopListening();
    }
  }, [stopListening]);

  const startedRef = useRef(false);
  useEffect(() => {
    if (!startedRef.current) return;
    if (drill) runDrillRef.current(drill);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  const onPressStart = () => { startedRef.current = true; void handleStart(); };

  // ── Render ───────────────────────────────────────────────────────
  const bigText = useMemo(() => {
    if (!drill) return '';
    if (phase === 'intro') return `Skill: ${drill.concept_title}`;
    if (phase === 'scenario') return drill.scenario;
    if (phase === 'task') return drill.spoken_task;
    if (phase === 'listening') return transcript || interim || (useRecorderPath ? '🎙 Listening — just speak, I\'ll stop on my own' : '🎙 Speak your answer…');
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
        {!loading && loadError && (<p className="text-xl text-red-400 m-auto">Could not load drills: {loadError}</p>)}
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
              {phase === 'listening' && (useRecorderPath ? 'Listening' : (sttSupported ? 'Listening' : 'Speak — manual mode'))}
              {phase === 'grading' && 'Grading'}
              {phase === 'feedback' && grade && (grade.passed ? '✓ Pass' : '✗ Try again')}
              {phase === 'reveal' && 'Elite answer'}
              {phase === 'error' && 'Error'}
            </div>

            <div className="flex-1 flex items-center justify-center">
              <Card className="bg-white/5 border-white/10 p-6 sm:p-10 w-full">
                <p className="text-2xl sm:text-4xl leading-tight text-center font-medium text-white">{bigText}</p>
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
                    {transcript && (<p className="text-sm text-white/50 italic mt-2">You said: "{transcript}"</p>)}
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

            {errMsg && (<p className="text-center text-red-400 text-sm mt-3">{errMsg}</p>)}

            <div className="mt-6 grid gap-3">
              {phase === 'idle' && (
                <Button onClick={onPressStart} className="h-20 text-2xl rounded-2xl bg-emerald-600 hover:bg-emerald-500">
                  <Volume2 className="h-7 w-7 mr-2" /> Start Car Mode
                </Button>
              )}

              {phase === 'listening' && (
                <Button onClick={handleDone} className="h-20 text-xl rounded-2xl bg-white/10 hover:bg-white/20" variant="outline">
                  <MicOff className="h-6 w-6 mr-2" /> Done (optional — auto-stops on silence)
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

              {phase === 'grading' && (<div className="h-20 flex items-center justify-center text-white/60">Scoring…</div>)}
            </div>

            {useRecorderPath && (
              <p className="text-center text-white/40 text-xs mt-3">
                Hands-free · auto-records after the prompt · auto-stops on silence
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
