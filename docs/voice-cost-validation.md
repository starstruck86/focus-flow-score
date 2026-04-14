# Voice Cost Optimization — Post-Merge Validation

## 1. Post-Merge QA Checklist

Run each item manually in a real Dojo/Learn session. Open the debug panel
(Ctrl+Shift+D / Cmd+Shift+D) and select the **Voice** tab before starting.

### Responsiveness
- [ ] Dave's first spoken prompt plays within ~1s of trigger (same as before)
- [ ] Second play of the same prompt is noticeably faster (memory cache hit)
- [ ] No perceptible pause between "Go" cue and mic activation
- [ ] Interrupting Dave mid-speech stops audio immediately

### Cache behavior
- [ ] Memory Cache Hits counter increments on repeated identical prompts
- [ ] Persistent Cache Hits increments after app reload + same prompt
- [ ] Cache Hit Rate climbs above 0% during a multi-turn session
- [ ] After 2–3 sessions, common coaching phrases show high reuse

### STT reliability
- [ ] Spoken response is transcribed on first attempt (no visible retry)
- [ ] STT Transport Success count equals utterances spoken in normal flow
- [ ] STT Blocked (preflight / duplicate / circuit) stays at 0 in normal use
- [ ] Deliberately double-tapping submit shows "Blocked (duplicate)" increment

### Playback correctness
- [ ] Audio plays fully to completion without cut-off
- [ ] No console errors about revoked object URLs during normal playback
- [ ] After session ends, no lingering audio elements in memory (check via DevTools)

### Cost observability
- [ ] Voice Mode shows "balanced" by default
- [ ] Active TTS Model shows "Turbo (fast/cheap)" by default
- [ ] ~Est. Credits counter increases plausibly during session
- [ ] Top repeated utterances surface high-frequency phrases

### Mode switching
- [ ] Switching to "minimal" mode mid-session reduces spoken output
- [ ] Switching to "full" mode mid-session increases spoken detail
- [ ] Mode change during active turn is deferred, not immediate

---

## 2. Live Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| First-prompt latency | ≤ baseline (no increase) | Debug panel timestamp comparison |
| Cached-prompt latency | < 100ms to playback start | Subjective + performance marks |
| Cache hit rate (after 3+ sessions) | ≥ 30% | Debug panel "Cache Hit Rate" |
| Malformed STT requests | → 0 | Debug panel "Blocked (preflight)" |
| STT retry rate | < 5% of transport attempts | Retries / Total Transport Attempts |
| Repeated prompts speed | Faster than uncached | Subjective A/B during session |
| Provider usage trend | Downward vs prior week | ElevenLabs dashboard analytics |
| Audio playback regressions | 0 | Manual QA, no cut-offs or errors |
| Object URL leaks | 0 | DevTools memory snapshot |

---

## 3. Rollout Plan

### Phase 1: Internal Testing (1–2 days)
**Scope:** Developer-only, debug panel active

**Monitor:**
- Cache hit/miss ratios in debug panel
- STT blocked/retry counts
- Console for any new errors or warnings
- Subjective latency feel vs pre-merge

**Rollback trigger:**
- Any playback regression (cut-off, silence, wrong audio)
- Measurable latency increase (>200ms added to first prompt)
- Circuit breaker opens during normal use
- STT reliability drops vs baseline

**Promotion criteria:**
- 3+ full sessions with 0 playback issues
- Cache hits observed on repeated phrases
- STT retries ≤ 5% of attempts
- No latency regression reported

### Phase 2: Limited Real Usage (3–5 days)
**Scope:** All users, monitoring active

**Monitor:**
- ElevenLabs dashboard: daily credit consumption trend
- Error logs for TTS/STT failures
- User-reported audio issues
- Cache hit rate trend across sessions

**Rollback trigger:**
- Credit consumption increases (opposite of goal)
- >2 user reports of audio quality degradation
- STT failure rate exceeds 10%
- Circuit breaker triggering in normal conditions

**Promotion criteria:**
- Credit consumption visibly trending down (≥20%)
- Zero audio quality complaints
- Cache hit rate ≥ 20% across returning users
- STT reliability stable or improved

### Phase 3: Default On (ongoing)
**Scope:** Full production, standard monitoring

**Monitor:**
- Weekly credit consumption vs baseline
- Monthly cache efficiency report
- STT reliability metrics

**Rollback trigger:**
- Sustained credit increase over 1 week
- New class of audio bugs

---

## 4. Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| Credit estimates are heuristic, not billing-authoritative | Displayed costs may differ from actual ElevenLabs charges | All values labeled "~Est." or "approx" |
| Aborting in-flight TTS fetch reduces client latency but may not save provider credits | Provider may still charge for partial generation | Treat as latency optimization, not cost guarantee |
| Dedupe fingerprint is sampled (first 128 bytes), not cryptographic | Extremely rare false positives possible for same-prefix audio | Acceptable for coaching audio; not used for security |
| IndexedDB persistent cache is browser-specific | Cache not shared across browsers/devices | Memory cache provides session-level benefit regardless |
| jsdom limitations prevent full blob-content testing | Some fingerprint edge cases validated outside jsdom | Core logic covered; manual QA supplements |
| Mobile Safari AudioContext recovery under OS interruptions | Unverified risk under memory pressure | Requires manual device validation |

---

## 5. Metrics Semantics Reference

### Authoritative (directly measured)
- Memory cache hits / misses (exact counter)
- STT transport attempts / successes / failures (exact counter)
- TTS characters sent (exact from request)
- STT audio seconds (from recorder timing, not blob size)

### Estimated (heuristic, labeled with ~)
- ~Est. Credits (approximate formula: chars × 1 + seconds × 10)
- Session cost estimates (based on mode multiplier and expected turns)
- Usage level thresholds (warning/critical based on estimated credits)
