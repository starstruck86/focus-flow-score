/**
 * "Pattern Recognition" Card — Phase 2
 *
 * Surfaces 1–2 behavioral patterns from skill memory.
 * Helps the user understand: "What kind of seller am I right now?"
 */

import { Card, CardContent } from '@/components/ui/card';
import { Eye } from 'lucide-react';
import type { SkillMemory } from '@/lib/dojo/skillMemory';

interface Props {
  skillMemory: SkillMemory;
}

interface Pattern {
  label: string;
}

function derivePatterns(sm: SkillMemory): Pattern[] {
  const patterns: Pattern[] = [];

  for (const p of sm.profiles) {
    if (p.totalReps < 3) continue;

    // Inconsistent execution
    if (p.confidence === 'low' && p.recentAvg < 50) {
      patterns.push({ label: `Inconsistent execution in ${p.label.toLowerCase()}` });
    }

    // Breaks under pressure — check if trend is declining with enough reps
    if (p.trend === 'declining' && p.totalReps >= 5) {
      patterns.push({ label: `${p.label} breaks down under sustained reps` });
    }

    // Loses control late — infer from specific mistake patterns
    if (p.topMistakes.some(m => ['lost_control', 'no_next_step', 'vague_commitment'].includes(m.mistake))) {
      patterns.push({ label: 'Starts strong, then loses control late in the conversation' });
    }
  }

  // Single-threaded check
  const hasMultiThreadMistakes = sm.profiles.some(p =>
    p.topMistakes.some(m => m.mistake === 'single_threaded' || m.mistake === 'ignored_stakeholder')
  );
  if (hasMultiThreadMistakes) {
    patterns.push({ label: 'Focuses on one stakeholder and misses others' });
  }

  // Deduplicate by label
  const seen = new Set<string>();
  return patterns.filter(p => {
    if (seen.has(p.label)) return false;
    seen.add(p.label);
    return true;
  }).slice(0, 2);
}

export function PatternRecognitionCard({ skillMemory }: Props) {
  const patterns = derivePatterns(skillMemory);

  if (patterns.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Eye className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Your Pattern
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-xs text-muted-foreground">Right now, you tend to:</p>
          <ul className="space-y-1.5">
            {patterns.map((p, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-xs text-muted-foreground mt-0.5">•</span>
                <p className="text-xs text-foreground leading-relaxed">{p.label}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
