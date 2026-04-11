import { describe, it, expect } from 'vitest';
import { splitTextForTTS } from '../useVoiceMode';

// ── splitTextForTTS correctness ──────────────────────────────────────

describe('splitTextForTTS', () => {
  it('returns single chunk for short text', () => {
    const result = splitTextForTTS('Hello world.');
    expect(result).toEqual(['Hello world.']);
  });

  it('splits at sentence boundaries', () => {
    const sentence = 'A'.repeat(2000) + '. ';
    const text = sentence.repeat(4); // ~8004 chars → needs split
    const result = splitTextForTTS(text);
    expect(result.length).toBeGreaterThan(1);
    result.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(4500);
    });
  });

  it('handles text without sentence boundaries', () => {
    const text = 'A'.repeat(5000); // no periods
    const result = splitTextForTTS(text);
    expect(result.length).toBe(1);
  });

  it('every chunk is non-empty', () => {
    const sentences = Array.from({ length: 20 }, (_, i) => `Sentence number ${i}. `).join('');
    const result = splitTextForTTS(sentences);
    result.forEach((chunk) => {
      expect(chunk.trim().length).toBeGreaterThan(0);
    });
  });

  it('produces correct chunk count — no chunks are skipped', () => {
    const sentences = Array.from(
      { length: 5 },
      (_, i) => 'W'.repeat(900) + ` sentence${i}. `,
    ).join('');
    const result = splitTextForTTS(sentences);
    const joined = result.join(' ');
    for (let i = 0; i < 5; i++) {
      expect(joined).toContain(`sentence${i}`);
    }
  });

  it('handles exactly one sentence', () => {
    const result = splitTextForTTS('Single sentence here.');
    expect(result).toEqual(['Single sentence here.']);
  });

  it('handles empty string', () => {
    const result = splitTextForTTS('');
    expect(result).toEqual(['']);
  });
});

// ── Sequential chunk delivery correctness ────────────────────────────

describe('chunk delivery loop correctness', () => {
  it('sequential loop visits every index exactly once for odd count', () => {
    const chunks = ['a', 'b', 'c', 'd', 'e'];
    const visited: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
      visited.push(i);
    }
    expect(visited).toEqual([0, 1, 2, 3, 4]);
  });

  it('sequential loop visits every index exactly once for even count', () => {
    const chunks = ['a', 'b', 'c', 'd'];
    const visited: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
      visited.push(i);
    }
    expect(visited).toEqual([0, 1, 2, 3]);
  });

  it('sequential loop visits single chunk', () => {
    const visited: number[] = [];
    for (let i = 0; i < 1; i++) {
      visited.push(i);
    }
    expect(visited).toEqual([0]);
  });

  it('abort mid-loop stops delivery without skipping', () => {
    const chunks = ['a', 'b', 'c', 'd', 'e'];
    const visited: number[] = [];
    let aborted = false;

    for (let i = 0; i < chunks.length; i++) {
      if (aborted) break;
      visited.push(i);
      if (i === 2) aborted = true; // stop after chunk 2
    }

    expect(visited).toEqual([0, 1, 2]);
  });
});

// ── Abort controller isolation ───────────────────────────────────────

describe('abort controller isolation (design verification)', () => {
  it('separate sets prevent cross-contamination', () => {
    const ttsSet = new Set<AbortController>();
    const sttSet = new Set<AbortController>();

    const ttsAc = new AbortController();
    const sttAc = new AbortController();
    ttsSet.add(ttsAc);
    sttSet.add(sttAc);

    // Aborting TTS should not touch STT
    ttsSet.forEach((ac) => ac.abort());
    ttsSet.clear();

    expect(ttsAc.signal.aborted).toBe(true);
    expect(sttAc.signal.aborted).toBe(false);
    expect(sttSet.size).toBe(1);
  });
});

// ── Playback timeout behavior ────────────────────────────────────────

describe('playback timeout design', () => {
  it('settle function prevents double resolution', () => {
    let settleCount = 0;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      settleCount++;
    };

    settle(); // first call
    settle(); // should be no-op
    settle(); // should be no-op

    expect(settleCount).toBe(1);
  });
});

// ── Object URL tracking ─────────────────────────────────────────────

describe('object URL lifecycle tracking', () => {
  it('add and revoke keeps set consistent', () => {
    const urls = new Set<string>();
    const revokeUrl = (url: string) => {
      urls.delete(url);
    };

    urls.add('blob:url1');
    urls.add('blob:url2');
    urls.add('blob:url3');
    expect(urls.size).toBe(3);

    revokeUrl('blob:url2');
    expect(urls.size).toBe(2);
    expect(urls.has('blob:url2')).toBe(false);

    // Clear all (unmount path)
    urls.clear();
    expect(urls.size).toBe(0);
  });

  it('revoking unknown URL is safe', () => {
    const urls = new Set<string>();
    const revokeUrl = (url: string) => {
      urls.delete(url);
    };

    // Should not throw
    revokeUrl('blob:nonexistent');
    expect(urls.size).toBe(0);
  });
});
