import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Columns, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TranscriptGrade, EvidenceItem } from '@/hooks/useTranscriptGrades';

interface Props {
  transcriptContent: string;
  grade: TranscriptGrade;
  renderScorecard: () => React.ReactNode;
}

export function SideBySideViewer({ transcriptContent, grade, renderScorecard }: Props) {
  const [sideBySide, setSideBySide] = useState(true);
  const [highlightedEvidence, setHighlightedEvidence] = useState<string | null>(null);

  const evidence = (grade.evidence as EvidenceItem[]) || [];

  // Build highlighted transcript with fuzzy matching
  const highlightedContent = useMemo(() => {
    if (!transcriptContent) return [];

    const lines = transcriptContent.split('\n');

    // Normalize for matching: lowercase, collapse whitespace, strip punctuation
    const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

    // Pre-compute normalized evidence tokens (significant 4+ word sequences)
    const evidenceMatchers = evidence.map(e => {
      if (!e.quote) return null;
      const norm = normalize(e.quote);
      // Use multiple strategies: full match, start match, key-phrase match
      const words = norm.split(' ').filter(w => w.length > 2);
      const keyPhrases = words.length > 4 ? [
        words.slice(0, 5).join(' '),
        words.slice(-5).join(' '),
      ] : [norm];
      return { evidence: e, norm, keyPhrases };
    }).filter(Boolean) as { evidence: EvidenceItem; norm: string; keyPhrases: string[] }[];

    return lines.map((line, i) => {
      const lineNorm = normalize(line);
      if (lineNorm.length < 5) return { line, index: i, evidence: undefined };

      const matchingEvidence = evidenceMatchers.find(m => {
        // Strategy 1: line contains a big chunk of the quote
        if (m.norm.length > 10 && lineNorm.includes(m.norm.substring(0, Math.min(60, m.norm.length)))) return true;
        // Strategy 2: quote contains the line (for shorter lines within a longer quote)
        if (lineNorm.length > 15 && m.norm.includes(lineNorm)) return true;
        // Strategy 3: key phrase match (first/last 5 words)
        if (m.keyPhrases.some(kp => lineNorm.includes(kp))) return true;
        return false;
      });

      return { line, index: i, evidence: matchingEvidence?.evidence };
    });
  }, [transcriptContent, evidence]);

  if (!sideBySide) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setSideBySide(true)} className="gap-1.5 text-xs">
          <Columns className="h-3.5 w-3.5" /> Side-by-side view
        </Button>
        {renderScorecard()}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setSideBySide(false)} className="gap-1.5 text-xs">
          <Minimize2 className="h-3.5 w-3.5" /> Scorecard only
        </Button>
        <Badge variant="outline" className="text-[10px]">
          Click evidence quotes to highlight in transcript
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Transcript Panel */}
        <Card className="border-border/50">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Transcript</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <ScrollArea className="h-[600px] px-4 pb-4">
              <div className="space-y-0.5 font-mono text-xs leading-relaxed">
                {highlightedContent.map(({ line, index, evidence: ev }) => (
                  <p
                    key={index}
                    className={cn(
                      'py-0.5 px-1 rounded transition-colors',
                      ev && 'bg-primary/10 border-l-2 border-primary/40',
                      highlightedEvidence && ev?.quote === highlightedEvidence && 'bg-primary/20 ring-1 ring-primary/30',
                    )}
                  >
                    {line || '\u00A0'}
                  </p>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Scorecard Panel */}
        <Card className="border-border/50">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Analysis</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <ScrollArea className="h-[600px] px-4 pb-4">
              {renderScorecard()}

              {/* Clickable evidence list */}
              {evidence.length > 0 && (
                <div className="mt-4 space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Evidence Quotes (click to highlight)</p>
                  {evidence.map((e, i) => (
                    <button
                      key={i}
                      onClick={() => setHighlightedEvidence(highlightedEvidence === e.quote ? null : e.quote)}
                      className={cn(
                        'w-full text-left text-xs p-1.5 rounded transition-colors',
                        highlightedEvidence === e.quote
                          ? 'bg-primary/15 ring-1 ring-primary/30'
                          : 'hover:bg-muted/50',
                      )}
                    >
                      <span className="text-muted-foreground">
                        <Badge variant="outline" className="text-[9px] h-3.5 mr-1">{e.category}</Badge>
                        "{e.quote?.substring(0, 80)}{(e.quote?.length || 0) > 80 ? '…' : ''}"
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
