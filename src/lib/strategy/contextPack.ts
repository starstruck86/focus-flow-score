/**
 * Strategy Context Pack types.
 * Built server-side by the edge function's retrieval layer.
 * Consumed by UI for source attribution pills.
 */

export interface StrategyContextPack {
  linkedAccount?: {
    id: string;
    name: string;
    industry?: string | null;
    tier?: string | null;
    website?: string | null;
    notes?: string | null;
    outreach_status?: string | null;
  } | null;
  linkedOpportunity?: {
    id: string;
    name: string;
    stage?: string | null;
    close_date?: string | null;
    notes?: string | null;
  } | null;
  linkedTerritory?: {
    id: string;
  } | null;
  relevantMemories: Array<{
    id: string;
    memory_type: string;
    content: string;
    source: 'account' | 'opportunity' | 'territory';
    score: number;
  }>;
  relevantUploads: Array<{
    id: string;
    file_name: string;
    parsed_text: string;
    summary?: string;
    score: number;
  }>;
  relevantOutputs: Array<{
    id: string;
    output_type: string;
    title: string;
    rendered_text?: string;
    score: number;
  }>;
  recentThreadMessages: Array<{
    id: string;
    role: string;
    text: string;
  }>;
  sourceCount: number;
}
