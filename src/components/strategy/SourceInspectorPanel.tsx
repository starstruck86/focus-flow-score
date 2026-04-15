/**
 * SourceInspectorPanel — expandable provenance panel showing what context was used.
 * Used in both assistant chat messages and workflow result cards.
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  ChevronDown, ChevronUp, Eye, Brain, Upload, FileText,
  MessageSquare, Pin, Cpu,
} from 'lucide-react';

interface RetrievalMeta {
  memoriesScored?: number;
  uploadsIncluded?: number;
  outputsIncluded?: number;
  messagesIncluded?: number;
  pinnedMemories?: number;
  uploadNames?: string[];
  outputTitles?: string[];
  contextType?: string;
  topSources?: string[];
}

interface Props {
  sourcesUsed: number;
  retrievalMeta?: RetrievalMeta;
  modelUsed?: string;
  workflowType?: string;
}

export function SourceInspectorPanel({ sourcesUsed, retrievalMeta, modelUsed, workflowType }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!retrievalMeta && !modelUsed) {
    if (sourcesUsed <= 0) return null;
    return (
      <Badge variant="secondary" className="text-[8px] px-1.5 py-0 gap-1 font-normal">
        <Eye className="h-2 w-2" />
        {sourcesUsed} sources
      </Badge>
    );
  }

  const memCount = retrievalMeta?.memoriesScored ?? 0;
  const pinnedCount = retrievalMeta?.pinnedMemories ?? 0;
  const upCount = retrievalMeta?.uploadsIncluded ?? 0;
  const outCount = retrievalMeta?.outputsIncluded ?? 0;
  const msgCount = retrievalMeta?.messagesIncluded ?? 0;
  const total = memCount + upCount + outCount + msgCount;
  const uploadNames = retrievalMeta?.uploadNames ?? [];
  const outputTitles = retrievalMeta?.outputTitles ?? [];

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[9px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        <Eye className="h-2.5 w-2.5" />
        <span>{total || sourcesUsed} sources used</span>
        {expanded ? <ChevronUp className="h-2 w-2" /> : <ChevronDown className="h-2 w-2" />}
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1.5 bg-muted/20 rounded-lg p-2 border border-border/30">
          {retrievalMeta?.contextType && retrievalMeta.contextType !== 'minimal' && (
            <div className="flex items-center gap-1.5 mb-1">
              <Badge variant="outline" className="text-[8px] px-1.5 py-0 capitalize">
                {retrievalMeta.contextType.replace('-', ' ')}
              </Badge>
            </div>
          )}
          <p className="text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-wider">Sources used</p>
          <div className="space-y-1">
            {memCount > 0 && (
              <div className="flex items-center gap-1.5 text-[9px] text-foreground/60">
                <Brain className="h-2.5 w-2.5 shrink-0" />
                <span>{memCount} memory items{pinnedCount > 0 ? ` (${pinnedCount} pinned)` : ''}</span>
              </div>
            )}
            {upCount > 0 && (
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-[9px] text-foreground/60">
                  <Upload className="h-2.5 w-2.5 shrink-0" />
                  <span>{upCount} upload{upCount !== 1 ? 's' : ''}</span>
                </div>
                {uploadNames.length > 0 && (
                  <div className="pl-4 space-y-0">
                    {uploadNames.map((name, i) => (
                      <p key={i} className="text-[8px] text-muted-foreground/50 truncate">• {name}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {outCount > 0 && (
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-[9px] text-foreground/60">
                  <FileText className="h-2.5 w-2.5 shrink-0" />
                  <span>{outCount} prior output{outCount !== 1 ? 's' : ''}</span>
                </div>
                {outputTitles.length > 0 && (
                  <div className="pl-4 space-y-0">
                    {outputTitles.map((title, i) => (
                      <p key={i} className="text-[8px] text-muted-foreground/50 truncate">• {title}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {msgCount > 0 && (
              <div className="flex items-center gap-1.5 text-[9px] text-foreground/60">
                <MessageSquare className="h-2.5 w-2.5 shrink-0" />
                <span>{msgCount} messages of history</span>
              </div>
            )}
          </div>
          {retrievalMeta?.topSources && retrievalMeta.topSources.length > 0 && (
            <div className="border-t border-border/30 pt-1 mt-1">
              <p className="text-[8px] font-semibold text-muted-foreground/50 uppercase tracking-wider mb-0.5">Top influences</p>
              {retrievalMeta.topSources.map((src, i) => (
                <p key={i} className="text-[8px] text-muted-foreground/50 truncate">• {src}</p>
              ))}
            </div>
          )}
          {(modelUsed || workflowType) && (
            <div className="border-t border-border/30 pt-1 mt-1 flex items-center gap-2">
              {modelUsed && (
                <div className="flex items-center gap-1 text-[8px] text-muted-foreground/40">
                  <Cpu className="h-2 w-2" />
                  <span className="font-mono">{modelUsed.split('/').pop()}</span>
                </div>
              )}
              {workflowType && (
                <span className="text-[8px] text-muted-foreground/40 capitalize">
                  {workflowType.replace(/_/g, ' ')}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
