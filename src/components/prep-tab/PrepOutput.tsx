import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Copy, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  output: string;
  onOutputChange: (v: string) => void;
  subjectLine: string;
  onSubjectChange: (v: string) => void;
  sources: string[];
  isGenerating: boolean;
  onRegenerate: () => void;
}

export function PrepOutput({
  output, onOutputChange, subjectLine, onSubjectChange,
  sources, isGenerating, onRegenerate,
}: Props) {
  if (!output && !isGenerating) return null;

  const handleCopy = () => {
    const text = subjectLine ? `Subject: ${subjectLine}\n\n${output}` : output;
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Output</h3>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleCopy} disabled={!output}>
            <Copy className="h-3 w-3 mr-1" /> Copy
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onRegenerate} disabled={isGenerating}>
            <RotateCcw className="h-3 w-3 mr-1" /> Regenerate
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled>
            <Save className="h-3 w-3 mr-1" /> Save
          </Button>
        </div>
      </div>

      {subjectLine && (
        <div>
          <Label className="text-[10px] text-muted-foreground">Subject</Label>
          <Input
            value={subjectLine}
            onChange={e => onSubjectChange(e.target.value)}
            className="h-8 text-sm font-medium"
          />
        </div>
      )}

      <Textarea
        value={output}
        onChange={e => onOutputChange(e.target.value)}
        rows={16}
        placeholder={isGenerating ? 'Generating…' : ''}
        className="text-sm font-mono leading-relaxed"
      />

      {sources.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-[9px] text-muted-foreground">Sources:</span>
          {sources.map((s, i) => (
            <Badge key={i} variant="outline" className="text-[9px]">{s}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}
