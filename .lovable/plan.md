# Read-only forensic write-path audit — verbatim

No edits. Quotations only. `file:line` references throughout.

---

## (1) Every write hit against the 5 tables

```
$ rg -n "from\(['\"](ki_mastery|user_competency|user_band_gate|dojo_sessions|dojo_session_turns)['\"]\)" src supabase/functions
```

(All `from(...)` hits — reads AND writes — for the 5 target tables; write-classification follows.)

```
supabase/functions/dave-conversation-token/index.ts:514:      .from('ki_mastery')                                  [read]
src/pages/WeeklyReview.tsx:48:        (supabase as any).from('dojo_sessions')                              [read]
src/pages/WeeklyReview.tsx:54:        (supabase as any).from('dojo_sessions')                              [read]
src/pages/WeeklyReview.tsx:61:        (supabase as any).from('ki_mastery')                                 [read]
src/pages/WeeklyReview.tsx:71:        (supabase as any).from('ki_mastery')                                 [read]
src/hooks/train/useSubLevelLadder.ts:27:          .from('user_competency')                                [read]
src/hooks/train/useSubLevelLadder.ts:33:          .from('user_band_gate')                                 [read]
src/pages/Sharpen.tsx:129:      .from('ki_mastery')                                                       [read]
src/pages/Sharpen.tsx:241:      supabase.from('dojo_sessions').insert({                                     [WRITE — insert]
src/pages/Progress.tsx:88:        .from('dojo_sessions')                                                  [read]
src/pages/Progress.tsx:119:       (supabase as any).from('dojo_sessions')...                              [read]
src/pages/Progress.tsx:120:       (supabase as any).from('dojo_session_turns').select('score')             [read]
src/lib/train/engine.ts:292:  await (supabase as any).from('dojo_sessions').insert({                     [WRITE — insert]
src/lib/train/competency.ts:34:    .from('user_competency')                                              [read (select existing)]
src/lib/train/competency.ts:72:    .from('user_competency')   .upsert(...)                              [WRITE — upsert]
src/lib/train/competency.ts:110:   .from('user_band_gate')                                               [read]
src/lib/train/competency.ts:139:   .from('user_band_gate')    .upsert(...)                              [WRITE — upsert]
src/lib/train/competency.ts:148:     .from('user_band_gate')  .upsert(...)                              [WRITE — upsert (next-band promote)]
src/pages/Grind.tsx:387:              supabase.from('dojo_sessions').insert({                             [WRITE — insert]
src/hooks/useKiProficiency.ts:81:    .from('ki_mastery')                                                 [read]
src/pages/DojoSession.tsx:180:      .from('ki_mastery')                                               [read]
src/pages/DojoSession.tsx:277:            .from('dojo_sessions')    .insert({...})                       [WRITE — insert]
src/pages/DojoSession.tsx:307:              .from('dojo_session_turns')  .insert({...})                  [WRITE — insert]
src/pages/DojoSession.tsx:357:              .from('dojo_sessions')      .update({...})                  [WRITE — update]
src/pages/DojoSession.tsx:366:              .from('dojo_session_turns')  .insert({...})                  [WRITE — insert (retry turn)]
src/pages/DojoQA.tsx:190:        .from('dojo_sessions')                                                [read]
src/pages/DojoQA.tsx:207:        .from('dojo_session_turns')                                           [read]
src/lib/dojo/selectNextBranchKI.ts:23:    .from('ki_mastery')                                           [read]
src/lib/dojo/patternMemory.ts:18:    .from('dojo_session_turns')                                       [read]
src/lib/dojo/patternMemory.ts:25:    .from('dojo_sessions')                                            [read]
src/lib/dojo/v4/capabilityModel.ts:43:    .from('dojo_sessions')                                       [read]
src/lib/dojo/v4/capabilityModel.ts:52:    .from('dojo_session_turns')                                  [read]
src/lib/dojo/v3/weeklySummaryEngine.ts:88:  supabase.from('dojo_sessions').select(...)                  [read]
src/lib/dojo/v3/weeklySummaryEngine.ts:89:  supabase.from('dojo_session_turns').select(...)             [read]
src/lib/learning/skillBuilderEngine.ts:122:    .from('dojo_sessions')                                   [read]
src/lib/dojo/v3/snapshotManager.ts:86:    .from('dojo_sessions')                                       [read]
src/lib/dojo/v3/snapshotManager.ts:91:    .from('dojo_session_turns')                                  [read]
src/lib/dojo/skillMemory.ts:79:    .from('dojo_sessions')                                              [read]
src/lib/dojo/skillMemory.ts:87:    .from('dojo_session_turns')                                         [read]
src/lib/dojo/selectNextKIFromCategory.ts:21:    .from('ki_mastery')                                     [read]
src/lib/dojo/useDojoStreak.ts:26:          .from('dojo_sessions')                                      [read]
src/lib/dojo/useDojoStreak.ts:33:          .from('dojo_session_turns')                                 [read]
src/lib/dojo/kiMasteryWriter.ts:23:    .from('ki_mastery')                                             [read (select existing)]
src/lib/dojo/kiMasteryWriter.ts:42:  await supabase.from('ki_mastery').upsert(                          [WRITE — upsert]
src/lib/daveTrainingRouter.ts:96:      .from('dojo_sessions')                                          [read]
src/lib/learning/learnEngine.ts:119:    .from('dojo_sessions')                                         [read]
src/lib/learning/learnEngine.ts:131:    .from('dojo_session_turns')                                    [read]
src/lib/learning/learnEngine.ts:183:    .from('dojo_sessions')                                         [read]
src/lib/learning/learnEngine.ts:197:    .from('dojo_session_turns')                                    [read]
src/components/dojo/SimulationMode.tsx:185:          .from('dojo_sessions')  .insert({...})                [WRITE — insert]
src/components/dojo/SimulationMode.tsx:211:    await supabase.from('dojo_session_turns').insert({          [WRITE — insert]
src/components/dojo/SimulationMode.tsx:252:    await supabase.from('dojo_sessions').update({               [WRITE — update]
src/components/dojo/SessionFeedbackCard.tsx:61:    .from('dojo_session_turns')                              [read]
src/components/dojo/SessionFeedbackCard.tsx:73:    .from('dojo_sessions')                                   [read]
src/lib/learning/learnAdaptationEngine.ts:94:    .from('dojo_session_turns')                              [read]
src/lib/learning/learnAdaptationEngine.ts:156:    .from('dojo_session_turns')                             [read]
src/lib/learning/learnAdaptationEngine.ts:234:    .from('dojo_sessions')                                  [read]
src/lib/learning/learnAdaptationEngine.ts:245:    .from('dojo_session_turns')                             [read]
src/lib/learning/learnLevelEvaluator.ts:221:    .from('dojo_sessions')                                   [read]
src/lib/learning/learnSubSkillEvaluator.ts:35:    .from('dojo_sessions')                                  [read]
src/lib/learning/learnSubSkillEvaluator.ts:50:    .from('dojo_session_turns')                             [read]
src/components/dojo/KiProficiencyStrip.tsx:31:    .from('ki_mastery')                                     [read]
src/components/dojo/DojoRoleplay.tsx:188:    supabase.from('dojo_sessions').insert({                       [WRITE — insert]
src/components/dojo/DojoRoleplay.tsx:206:    supabase.from('dojo_session_turns').insert({                  [WRITE — insert]
src/components/dojo/DojoReview.tsx:116:      supabase.from('dojo_sessions').insert({                       [WRITE — insert]
src/components/dojo/DojoReview.tsx:134:      supabase.from('dojo_session_turns').insert({                  [WRITE — insert]
src/components/dojo/DaveCoachingDelivery.tsx:206:    .from('dojo_sessions')   .update({audio_metrics:...})        [WRITE — update]
src/components/dojo/AudioSessionMode.tsx:318:    .from('dojo_sessions')         .insert({...})                [WRITE — insert]
src/components/dojo/AudioSessionMode.tsx:342:    .from('dojo_session_turns')    .insert({...})                [WRITE — insert]
src/components/dojo/AudioSessionMode.tsx:415:    .from('dojo_sessions')         .insert({...})                [WRITE — insert]
src/components/dojo/AudioSessionMode.tsx:440:    .from('dojo_session_turns')    .insert({...})                [WRITE — insert]
src/components/dojo/AudioSessionMode.tsx:523:    .from('dojo_sessions')         .update({...})                [WRITE — update]
src/components/dojo/AudioSessionMode.tsx:532:    .from('dojo_session_turns')    .insert({...})                [WRITE — insert (retry turn)]
```

**No grep hits for the 5 tables in `supabase/functions/` other than the read at `dave-conversation-token/index.ts:514`.** No edge function inserts/updates/upserts any of the 5 tables.

---

## (2) TRAIN v2 ladder rep — write paths verbatim

### Entry: `src/pages/train/TrainAtom.tsx` lines 46–106

```ts
  async function handleSubmit() {
    if (!user || !currentDrill || !data) return;
    setSubmitting(true);
    try {
      const r = await runPracticeRep({
        userId: user.id,
        spoke,
        topic,
        band: data.concept.band,
        subLevel: data.concept.sub_level,
        drillCountInSubLevel: activeDrills.length,
        ki: currentDrill,
        userResponse: response,
        skillFocus: topic,
      });
      setResult({ score: r.score, feedback: r.feedback, progress: r.progress, reps: r.reps });
      setSessionLatest(r.score);
      setSessionBest((b) => Math.max(b, r.score));
      setPhase('scored');
    } catch (e) {
      setResult({ score: 0, feedback: `Scoring failed: ${(e as Error).message}`, progress: 0, reps: 0 });
      setPhase('scored');
    } finally {
      setSubmitting(false);
    }
  }
  ...
  async function handleAdvance() {
    const next = drillIdx + 1;
    if (next >= activeDrills.length) {
      // Atom complete — write session.
      if (user) {
        try {
          await writeTrainSession({
            userId: user.id,
            mode: 'train_atom',
            skillFocus: topic,
            subLevel: data?.concept.sub_level,
            band: data?.concept.band,
            conceptId: data?.concept.concept_id,
            bestScore: sessionBest,
            latestScore: sessionLatest,
            startedAt,
            completedAt: new Date().toISOString(),
          });
        } catch { /* ignore */ }
      }
      navigate(`/train/${spoke}/${topic}`);
      return;
    }
    setDrillIdx(next);
    setResponse('');
    setResult(null);
    setPhase('try');
  }
```

`startedAt` is set once when the page mounts (`src/pages/train/TrainAtom.tsx:31`):

```ts
  const [startedAt] = useState(() => new Date().toISOString());
```

### `runPracticeRep` — `src/lib/train/engine.ts` lines 135–182

```ts
export async function runPracticeRep(input: PracticeRepInput): Promise<PracticeRepResult> {
  const isPromptOnly = !!input.ki.promptOnly || !input.ki.ki_id;
  const objection =
    input.objection ??
    input.ki.scenario ??
    input.ki.when_to_use ??
    'Respond to this buyer situation.';
  const scored = await scoreRep({
    skillFocus: input.skillFocus,
    userResponse: input.userResponse,
    objection,
    context: input.ki.when_to_use ?? undefined,
    ki: isPromptOnly ? null : input.ki,
  });

  // Per-KI SRS — only when there is a real KI behind this rep.
  if (!isPromptOnly) {
    writeKIMastery({
      userId: input.userId,
      kiId: input.ki.ki_id,
      chapter: input.ki.chapter,
      spiderDimension: input.ki.spider_dimension ?? null,
      score: scored.score,
      recognitionScore: scored.raw?.recognitionScore ?? null,
      executionScore: scored.raw?.executionScore ?? null,
      awarenessScore: scored.raw?.awarenessScore ?? null,
    }).catch(() => {});
  }

  const comp = await incrementSubLevelRep({
    userId: input.userId,
    spoke: input.spoke,
    topic: input.topic,
    band: input.band,
    subLevel: input.subLevel,
    score: scored.score,
    drillCountInSubLevel: input.drillCountInSubLevel,
  });

  return {
    score: scored.score,
    feedback: scored.feedback,
    raw: scored.raw,
    progress: Number(comp.progress ?? 0),
    reps: Number(comp.reps ?? 0),
    gatePassedAt: comp.gate_passed_at ?? null,
  };
}
```

### `scoreRep` — `src/lib/train/engine.ts` lines 61–108 (no DB writes; HTTP call only)

```ts
export async function scoreRep(opts: ScoreOpts): Promise<ScoreResult> {
  const { data: { session } } = await supabase.auth.getSession();

  if (opts.ki && opts.ki.example_usage && opts.objection.trim() === opts.ki.example_usage.trim()) {
    throw new Error('train/engine: objection must not equal ki.example_usage (score poisoning).');
  }

  const body: Record<string, unknown> = {
    scenario: {
      skillFocus: opts.skillFocus,
      context: opts.context ?? opts.ki?.when_to_use ?? 'Enterprise sales scenario.',
      objection: opts.objection,
    },
    userResponse: opts.userResponse,
  };

  if (opts.ki) {
    body.ki = {
      title: opts.ki.title ?? '',
      tactic_summary: opts.ki.tactic_summary ?? '',
      when_to_use: opts.ki.when_to_use ?? '',
      when_not_to_use: opts.ki.when_not_to_use ?? '',
      why_it_matters: opts.ki.why_it_matters ?? '',
    };
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/dojo-score`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`dojo-score ${res.status}: ${data?.error ?? 'failed'}`);
  return {
    score: typeof data.score === 'number' ? data.score : 50,
    feedback: typeof data.feedback === 'string' ? data.feedback : '',
    raw: data,
  };
}
```

### `incrementSubLevelRep` — `src/lib/train/competency.ts` lines 30–78

```ts
export async function incrementSubLevelRep(input: RepInput): Promise<UserCompetencyRow> {
  const { userId, spoke, topic, band, subLevel, score, drillCountInSubLevel } = input;

  const { data: existing } = await (supabase as any)
    .from('user_competency')
    .select('*')
    .eq('user_id', userId)
    .eq('spoke', spoke)
    .eq('topic', topic)
    .eq('sub_level', subLevel)
    .maybeSingle();

  const prevReps = Number(existing?.reps ?? 0);
  const prevProgress = Number(existing?.progress ?? 0);
  const required = TRAIN_TUNABLES.subLevelRequiredPasses;

  const passed = score >= TRAIN_TUNABLES.subLevelPassThreshold ? 1 : 0;
  const passingRepsApprox = Math.round(prevProgress * required) + passed;
  const nextProgress = Math.min(1, passingRepsApprox / required);

  const nextReps = prevReps + 1;
  const alreadyPassed = !!existing?.gate_passed_at;
  const newlyPassed = !alreadyPassed && nextProgress >= 1;

  const payload = {
    user_id: userId,
    spoke,
    topic,
    band,
    sub_level: subLevel,
    progress: nextProgress,
    reps: nextReps,
    gate_passed_at: alreadyPassed
      ? existing!.gate_passed_at
      : newlyPassed
        ? new Date().toISOString()
        : null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await (supabase as any)
    .from('user_competency')
    .upsert(payload, { onConflict: 'user_id,spoke,topic,sub_level' })
    .select('*')
    .single();
  if (error) throw error;
  return data as UserCompetencyRow;
}
```

### `writeKIMastery` — `src/lib/dojo/kiMasteryWriter.ts` lines 22–63 (upsert)

```ts
  const { data: existing } = await supabase
    .from('ki_mastery')
    .select('id, times_drilled, avg_score, best_score, last_drilled_at')
    .eq('user_id', userId)
    .eq('ki_id', kiId)
    .maybeSingle();
  ...
  await supabase.from('ki_mastery').upsert(
    {
      user_id: userId,
      ki_id: kiId,
      chapter,
      spider_dimension: spiderDimension,
      times_drilled: times,
      avg_score: newAvg,
      best_score: bestScore,
      last_drilled_at: now,
      first_drilled_at: existing ? undefined : now,
      decay_risk: decayRisk,
      next_review_at: nextReviewAt,
      updated_at: now,
      ...(recognitionScore != null && { recognition_score: recognitionScore }),
      ...(executionScore != null && { execution_score: executionScore }),
      ...(awarenessScore != null && { awareness_score: awarenessScore }),
    },
    { onConflict: 'user_id,ki_id' },
  );
```

### `writeTrainSession` — `src/lib/train/engine.ts` lines 291–311

```ts
export async function writeTrainSession(row: TrainSessionRow): Promise<void> {
  await (supabase as any).from('dojo_sessions').insert({
    user_id: row.userId,
    mode: row.mode,                              // plain text — no enum/check
    session_type: row.mode === 'band_gate' ? 'gate' : 'drill',
    skill_focus: row.skillFocus,
    difficulty: 'standard',
    status: 'completed',
    best_score: row.bestScore,
    latest_score: row.latestScore,
    retry_count: 0,
    started_at: row.startedAt,
    completed_at: row.completedAt,
    benchmark_tag: false,
    scenario_title: row.conceptId
      ? `${row.mode === 'band_gate' ? 'Band Gate' : 'Train atom'} · ${row.conceptId}${row.subLevel ? ` (${row.subLevel})` : ''}`
      : row.mode === 'band_gate'
        ? `Band Gate B${row.band ?? ''}`
        : 'Train atom',
  });
}
```

### Tables touched per TRAIN v2 path

```
runPracticeRep (per rep):
  - ki_mastery          → upsert (writeKIMastery), ONLY when !isPromptOnly
  - user_competency     → upsert (incrementSubLevelRep), always

runBandGate (per gate finalize, src/lib/train/engine.ts):
  - user_band_gate      → upsert + (optional) next-band-promote upsert (recordBandGateAttempt)
  - (NO ki_mastery write — gate path passes ki: null)

writeTrainSession (atom-complete or gate-finalize):
  - dojo_sessions       → insert  (status='completed' at insert time)
  - dojo_session_turns  → NEVER written by TRAIN v2 (no caller anywhere)
```

**"Does the ladder ever create a dojo_sessions row?"** — Yes, but ONLY at atom completion (`TrainAtom.tsx:85` calls `writeTrainSession`) or gate completion (`TrainBandGate.tsx:148`). If the user abandons before reaching the final drill in an atom, `writeTrainSession` is not called and no `dojo_sessions` row is created — even though `user_competency` / `ki_mastery` upserts have already happened per rep. TRAIN v2 also never inserts a `dojo_session_turns` row — `grep` confirms zero callers.

---

## (3) Legacy `/sharpen` + `/dojo/session` drill loop — write paths

### `/sharpen` per-rep submit — `src/pages/Sharpen.tsx` lines 274–334

```ts
  const submitResponse = useCallback(async () => {
    if (!currentKI || !response.trim() || phase !== 'input') return;
    setPhase('scoring');

    const { data: { session } } = await supabase.auth.getSession();
    let score = 50;
    ...
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/dojo-score`, { ... });
      const data = await res.json();
      score = data.score ?? 50;
      ...
    } catch (err: any) { ... }

    if (user && currentKI) {
      writeKIMastery({
        userId: user.id,
        kiId: currentKI.id,
        chapter: currentKI.chapter,
        spiderDimension: currentKI.spider_dimension ?? null,
        score,
        recognitionScore,
        executionScore,
        awarenessScore,
      }).catch(() => {});
    }
```

### `/sharpen` end-of-set `dojo_sessions` insert — `src/pages/Sharpen.tsx` lines 232–257

```ts
  useEffect(() => {
    if (phase !== 'end' || reps.length === 0) return;

    // Write a dojo_sessions row so the streak counter updates
    if (user) {
      const avgScore = Math.round(reps.reduce((a, r) => a + r.score, 0) / reps.length);
      const bestScore = Math.max(...reps.map(r => r.score));
      const now = new Date().toISOString();
      const approxStart = new Date(Date.now() - reps.length * 50000).toISOString();
      supabase.from('dojo_sessions').insert({
        user_id: user.id,
        mode: 'sharpen',
        session_type: 'drill',
        skill_focus: dimension,
        difficulty: 'standard',
        status: 'completed',
        best_score: bestScore,
        latest_score: avgScore,
        retry_count: 0,
        started_at: approxStart,
        completed_at: now,
        benchmark_tag: false,
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ['dojo-stats', user.id] });
      });
    }
```

### `/dojo/session` per-rep — `src/pages/DojoSession.tsx` lines 274–347 (first attempt) and 350–395 (retry)

First-attempt insert:

```ts
      if (user) {
        if (!isRetry) {
          const { data: session, error: sessionErr } = await supabase
            .from('dojo_sessions')
            .insert({
              user_id: user.id,
              mode: (state?.mode as 'autopilot' | 'custom') || 'autopilot',
              session_type: 'drill',
              skill_focus: scenario.skillFocus,
              scenario_title: scenario.title,
              scenario_context: scenario.context,
              scenario_objection: scenario.objection,
              best_score: scoreData.score,
              latest_score: scoreData.score,
              status: 'completed',
              completed_at: new Date().toISOString(),
              assignment_id: assignmentId,
              benchmark_tag: benchmarkTag,
              scenario_family_id: scenarioFamilyId,
              pressure_level: pressureLevel,
              pressure_dimensions: pressureDimensions,
              ki_source_id: (kiContext ?? kiContextOverride)?.id ?? null,
              ki_chapter: (kiContext ?? kiContextOverride)?.chapter ?? null,
              ki_spider_dimension: (kiContext ?? kiContextOverride)?.spider_dimension ?? null,
              ki_ideal_response: kiDrill?.ki_ideal_response ?? null,
              ki_rubric: kiDrill?.ki_rubric ?? null,
            })
            .select('id')
            .single();

          if (!sessionErr && session) {
            setSessionId(session.id);
            const { data: turn } = await supabase
              .from('dojo_session_turns')
              .insert({
                session_id: session.id,
                user_id: user.id,
                turn_index: 0,
                prompt_text: scenario.objection,
                user_response: text,
                score: scoreData.score,
                feedback: scoreData.feedback,
                top_mistake: scoreData.topMistake,
                improved_version: scoreData.improvedVersion,
                score_json: scoreToJson(scoreData),
              })
              .select('id')
              .single();
            ...
            // KI mastery write-back (first attempt)
            const activeKI = kiContext ?? kiContextOverride;
            if (activeKI) {
              writeKIMastery({
                userId: user.id,
                kiId: activeKI.id,
                chapter: activeKI.chapter,
                spiderDimension: activeKI.spider_dimension,
                score: scoreData.score,
                ...
              }).catch(err => console.error('[DojoSession] writeKIMastery failed:', err));
            }
          }
```

Retry path:

```ts
          if (sessionId) {
            const bestScore = Math.max(result?.score ?? 0, scoreData.score);
            await supabase
              .from('dojo_sessions')
              .update({
                best_score: bestScore,
                latest_score: scoreData.score,
                retry_count: newRetryCount,
              })
              .eq('id', sessionId);

            await supabase
              .from('dojo_session_turns')
              .insert({
                session_id: sessionId,
                user_id: user.id,
                turn_index: newRetryCount,
                prompt_text: scenario.objection,
                user_response: text,
                ...
                score_json: scoreToJson(scoreData),
                retry_of_turn_id: firstTurnId,
              });

            // KI mastery write-back (retry — use best score)
            const activeKI = kiContext ?? kiContextOverride;
            if (activeKI) {
              writeKIMastery({ userId: user.id, kiId: activeKI.id, ... score: bestScore, ... })
                .catch(err => console.error('[DojoSession] writeKIMastery failed:', err));
            }
          }
```

### Tables touched

```
/sharpen (Sharpen.tsx):
  - ki_mastery          → upsert per rep
  - dojo_sessions       → insert once at end-of-set
  - dojo_session_turns  → NEVER
  - user_competency     → NEVER
  - user_band_gate      → NEVER

/dojo/session (DojoSession.tsx):
  - ki_mastery          → upsert per attempt and per retry
  - dojo_sessions       → insert on first attempt; update on retry
  - dojo_session_turns  → insert turn 0 on first attempt; insert retry turn on retry
  - user_competency     → NEVER
  - user_band_gate      → NEVER
```

---

## (4) Other drill surfaces writing `ki_mastery`

Callers of `writeKIMastery`:

```
src/pages/Sharpen.tsx:324            (legacy /sharpen — see §3)
src/pages/Grind.tsx:110              (legacy /grind)
src/pages/DojoSession.tsx:336,384,700,727   (/dojo/session: first + retry + RecognitionDrill + AdversarialDrill)
src/components/dojo/MicroDrillSession.tsx:88 (Dojo "Quick Drill" overlay)
src/lib/train/engine.ts:152          (TRAIN v2 — see §2)
```

### Grind — `src/pages/Grind.tsx` lines 110–114 and 387–398

```ts
    writeKIMastery({
      userId: user.id, kiId: ki.id, chapter: ki.chapter,
      spiderDimension: ki.spider_dimension ?? null, score,
      recognitionScore, executionScore, awarenessScore,
    }).catch(() => {});
...
              supabase.from('dojo_sessions').insert({
                user_id: user.id,
                mode: 'grind',
                session_type: 'drill',
                ...
                started_at: approxStart,
                completed_at: now,
                ...
              });
```

Grind writes `ki_mastery` + `dojo_sessions`. Does **NOT** write `user_competency` or `user_band_gate`.

### MicroDrillSession — `src/components/dojo/MicroDrillSession.tsx` lines 85–94

```ts
    await writeKIMastery({
      userId,
      kiId: ki.id,
      chapter: ki.chapter,
      spiderDimension: ki.spider_dimension ?? null,
      score,
    }).catch(() => {});
```

The entire `MicroDrillSession.tsx` file contains zero `.from('dojo_sessions')` / `.from('dojo_session_turns')` / `.from('user_competency')` / `.from('user_band_gate')` calls. It writes ONLY `ki_mastery`.

### `SkillTrainingModule` micro-drill (Learn tab)

Uses edge function only — `src/components/learn/SkillTrainingModule.tsx:66`:

```ts
      const { data, error } = await supabase.functions.invoke('score-micro-drill', { ... });
```

Calls `score-micro-drill` (see §5) and renders the result. No table writes from this surface.

### Audio / Simulation / Roleplay / Review

`AudioSessionMode.tsx`, `SimulationMode.tsx`, `DojoRoleplay.tsx`, `DojoReview.tsx` write `dojo_sessions` and `dojo_session_turns` (see §1) but do **NOT** call `writeKIMastery` (no import; grep returns no hit). They also do not touch `user_competency` / `user_band_gate`.

---

## (5) Edge functions: do any write to the 5 tables?

```
$ rg -n "from\(['\"](ki_mastery|user_competency|user_band_gate|dojo_sessions|dojo_session_turns)['\"]\)" supabase/functions
supabase/functions/dave-conversation-token/index.ts:514:      .from('ki_mastery')
```

That single hit is `.select(...)` — a read for Dave's context. No edge function inserts, updates, upserts, or deletes any of the 5 tables.

### `supabase/functions/dojo-score/index.ts`

```
$ rg -n "\.from\(|\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.rpc\(|createClient|supabase" supabase/functions/dojo-score/index.ts
5:  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
318:- Good: "Next rep: your first three words must be a dollar amount." / ...
321:  deal_control: `You are a sales leader who has reviewed 5,000 pipeline deals. ...
807:      delete parsed.multiThread;
```

```
// dojo-score: ZERO database writes. ZERO `.from()` calls. No createClient.
// Pure scorer: reads HTTP body {scenario, userResponse, ki?} → returns JSON {score, feedback, ...}.
// The "delete" hit on 807 is a JS object-key delete; "delete" on 318 is prompt text.
```

### `supabase/functions/score-micro-drill/index.ts` (Learn micro-drill scorer)

```
$ rg -n "\.from\(|\.insert\(|\.upsert\(|\.update\(|createClient" supabase/functions/score-micro-drill/index.ts
(no matches)
```

Also a pure scorer. No DB writes.

---

## (6) `dojo_sessions.started_at` vs `completed_at`

```
$ rg -n "started_at|completed_at" src/lib/train/engine.ts src/pages/Sharpen.tsx src/pages/DojoSession.tsx src/components/dojo/AudioSessionMode.tsx src/components/dojo/SimulationMode.tsx src/components/dojo/DojoRoleplay.tsx src/components/dojo/DojoReview.tsx src/pages/Grind.tsx
src/pages/Grind.tsx:397:                started_at: approxStart,
src/pages/Grind.tsx:398:                completed_at: now,
src/components/dojo/DojoRoleplay.tsx:199:          completed_at: new Date().toISOString(),
src/components/dojo/SimulationMode.tsx:254:            completed_at: new Date().toISOString(),
src/components/dojo/DojoReview.tsx:127:          completed_at: new Date().toISOString(),
src/components/dojo/AudioSessionMode.tsx:331:              completed_at: new Date().toISOString(),
src/components/dojo/AudioSessionMode.tsx:368:            completed_at: new Date().toISOString(),
src/components/dojo/AudioSessionMode.tsx:428:              completed_at: new Date().toISOString(),
src/components/dojo/AudioSessionMode.tsx:487:              completed_at: new Date().toISOString(),
src/pages/DojoSession.tsx:289:              completed_at: new Date().toISOString(),
src/pages/Sharpen.tsx:251:        started_at: approxStart,
src/pages/Sharpen.tsx:252:        completed_at: now,
src/lib/train/engine.ts:302:    started_at: row.startedAt,
src/lib/train/engine.ts:303:    completed_at: row.completedAt,
```

### TRAIN v2 (`writeTrainSession`)

`src/pages/train/TrainAtom.tsx:31` and `:94`:

```ts
  const [startedAt] = useState(() => new Date().toISOString());
...
            startedAt,
            completedAt: new Date().toISOString(),
```

`src/pages/train/TrainBandGate.tsx:67` and `:155`:

```ts
  const [startedAt] = useState(() => new Date().toISOString());
...
          startedAt,
          completedAt: new Date().toISOString(),
```

→ `started_at` = true page-mount timestamp; `completed_at` = true atom/gate completion timestamp. Genuine duration.

### `/sharpen` — `src/pages/Sharpen.tsx` lines 239–252

```ts
      const now = new Date().toISOString();
      const approxStart = new Date(Date.now() - reps.length * 50000).toISOString();
      supabase.from('dojo_sessions').insert({
        ...
        started_at: approxStart,
        completed_at: now,
```

→ `started_at` is **synthetic** (`now − reps.length × 50_000 ms`), `completed_at` is the insert moment. Not a true start time.

### `/grind` — `src/pages/Grind.tsx` lines 385–398

```ts
              const now = new Date().toISOString();
              const approxStart = new Date(Date.now() - drillResults.length * 55000).toISOString();
              supabase.from('dojo_sessions').insert({
                ...
                started_at: approxStart,
                completed_at: now,
```

→ Same synthetic pattern (55 s × rep count).

### `/dojo/session` — `src/pages/DojoSession.tsx` lines 276–302

```ts
          const { data: session, error: sessionErr } = await supabase
            .from('dojo_sessions')
            .insert({
              user_id: user.id,
              mode: (state?.mode as 'autopilot' | 'custom') || 'autopilot',
              session_type: 'drill',
              ...
              status: 'completed',
              completed_at: new Date().toISOString(),
              ...
            })
```

→ Only `completed_at` is supplied. No `started_at` in this insert. `status: 'completed'` is set in the same call (single-turn drill), so both timestamps effectively collapse to `now()`.

### Audio / Simulation / Roleplay / Review

Each of these only writes `completed_at: new Date().toISOString()` in the insert/update call (lines listed above). None of them pass a `started_at`. The `dojo_sessions.started_at` column is therefore left to whatever the DB default is (or NULL) for those flows.
