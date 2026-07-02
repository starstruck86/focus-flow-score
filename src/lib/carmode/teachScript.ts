/**
 * Car Mode — client-side teach-script composer.
 *
 * Pimsleur-style: user must understand the tactic before drilling it. No new
 * AI calls — we compose from fields already loaded with the drill.
 *
 * Priority for the what/why sentence(s):
 *   1. teach_beat_md (markdown stripped, first 2 sentences)
 *   2. exemplar KI why_it_matters (first 2 sentences)
 * When-clause:
 *   - KI when_to_use, first sentence
 * Model line ALWAYS spoken last when present.
 * Hard cap ~110 words.
 * Degenerate (only model line): "Tactic: {title}. The elite line sounds like this: {line}."
 */

export interface TeachScriptInputs {
  conceptTitle: string;
  teachBeatMd?: string | null;
  whyItMatters?: string | null;
  whenToUse?: string | null;
  modelLinePlain?: string | null;
}

const MAX_WORDS = 110;

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentences(text: string, n: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const parts = clean.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!parts || parts.length === 0) return clean;
  return parts.slice(0, n).join('').trim();
}

function ensurePeriod(s: string): string {
  const t = s.trim();
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function capWords(s: string, max: number): string {
  const words = s.split(/\s+/);
  if (words.length <= max) return s;
  return words.slice(0, max).join(' ').replace(/[,;:]$/, '') + '.';
}

export function composeTeachScript(inp: TeachScriptInputs): string {
  const title = (inp.conceptTitle || 'this tactic').trim();
  const model = (inp.modelLinePlain || '').trim();

  const whyRaw = inp.teachBeatMd
    ? firstSentences(stripMarkdown(inp.teachBeatMd), 2)
    : firstSentences((inp.whyItMatters || '').trim(), 2);
  const whenRaw = firstSentences((inp.whenToUse || '').trim(), 1);

  // Degenerate: only model line present
  if (!whyRaw && !whenRaw && model) {
    return `The tactic: ${title}. Now listen to elite: ${ensurePeriod(model)}`;
  }

  // Four-beat fallback shape (mirrors the authored-script spec):
  // 1) tactic, 2) when, 3) why, 4) elite. Signposted labels avoid the fused
  // "Use it when apply this framework..." grammar bug of the prior version.
  const parts: string[] = [`The tactic: ${title}.`];
  if (whenRaw) parts.push(`When to use: ${ensurePeriod(whenRaw)}`);
  if (whyRaw) parts.push(`Why it matters: ${ensurePeriod(whyRaw)}`);
  if (model) parts.push(`Now listen to elite: ${ensurePeriod(model)}`);

  return capWords(parts.join(' '), MAX_WORDS);
}
