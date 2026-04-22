/**
 * CanaryResultParser — textarea + Parse button + warnings banner.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { parseCanaryResults } from '@/lib/strategy/canary/parser';
import type { ParsedCanary } from '@/lib/strategy/canary/types';

interface Props {
  initialRaw?: string;
  onParsed: (parsed: ParsedCanary, raw: string) => void;
}

export function CanaryResultParser({ initialRaw = '', onParsed }: Props) {
  const [rawText, setRawText] = useState(initialRaw);
  const [warnings, setWarnings] = useState<string[]>([]);

  const handleParse = () => {
    const parsed = parseCanaryResults(rawText);
    setWarnings(parsed.parse_warnings);
    onParsed(parsed, rawText);
  };

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder={`STEPS:\n1: pass\n2: pass\n...\n\nDUPLICATES SQL:\nempty\n\nFAILURES SQL:\nempty\n\nLANE MIX SQL:\ndirect=5, assisted=10, deep_work=3\n\nOBSERVATIONS:\n...\n\nFLAG STATE: ROUTER_AUTO_PROMOTE=1`}
        className="min-h-[220px] font-mono text-xs"
      />
      <div className="flex items-center gap-3">
        <Button onClick={handleParse} disabled={rawText.trim().length === 0} size="sm">
          Parse
        </Button>
        <span className="text-xs text-muted-foreground">
          Deterministic client-side parse. Order-independent.
        </span>
      </div>
      {warnings.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
          <div className="mb-1 font-medium text-warning-foreground">
            Parse warnings ({warnings.length})
          </div>
          <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
