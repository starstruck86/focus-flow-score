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
    return `Tactic: ${title}. The elite line sounds like this: ${ensurePeriod(model)}`;
  }

  const parts: string[] = [`Tactic: ${title}.`];
  if (whyRaw) parts.push(ensurePeriod(whyRaw));
  if (whenRaw) {
    const w = whenRaw.replace(/^when\s+/i, '').replace(/[.!?]+$/, '');
    parts.push(`Use it when ${w}.`);
  }
  if (model) parts.push(`Here's what elite sounds like: ${ensurePeriod(model)}`);

  return capWords(parts.join(' '), MAX_WORDS);
}
