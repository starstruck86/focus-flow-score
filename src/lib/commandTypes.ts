/**
 * Command system types — structured tokens, template metadata, output blocks, attachments.
 */

export interface CommandToken {
  type: 'account' | 'opportunity' | 'template';
  id: string;
  name: string;
}

export interface CommandAttachment {
  id: string;
  type: 'file' | 'image' | 'url';
  name: string;
  file?: File;
  url?: string;
  preview?: string;
  mimeType?: string;
  size?: number;
  /** Extracted text content for context injection */
  extractedText?: string;
}

export interface ParsedCommand {
  rawText: string;
  account: CommandToken | null;
  opportunity: CommandToken | null;
  template: CommandToken | null;
  freeText: string;
  attachments?: CommandAttachment[];
}

export interface TemplateMetadata {
  id: string;
  name: string;
  description: string;
  output_type: string;
  recommended_context_types: ('account' | 'opportunity' | 'competitor' | 'persona')[];
  preferred_ki_depth: 'shallow' | 'standard' | 'deep';
  is_pinned: boolean;
  is_favorite: boolean;
  times_used: number;
  last_used_at: string | null;
  systemPrompt: string;
  /** Sections the AI should produce */
  output_sections: string[];
  source: 'built_in' | 'saved' | 'promoted';
  /** Original source content for promoted templates */
  sourceContent?: string;
}

export interface OutputBlock {
  heading: string;
  content: string;
}

export interface ExecutionResult {
  output: string;
  blocks: OutputBlock[];
  subjectLine: string;
  sources: string[];
  kiCount: number;
  templateId: string | null;
  /** Strategic playbook name if one was used */
  playbookUsed?: string;
}

/**
 * Parse markdown output into structured blocks by ## headings.
 */
export function parseOutputBlocks(markdown: string): OutputBlock[] {
  const lines = markdown.split('\n');
  const blocks: OutputBlock[] = [];
  let currentHeading = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (currentHeading || currentLines.length > 0) {
        blocks.push({
          heading: currentHeading,
          content: currentLines.join('\n').trim(),
        });
      }
      currentHeading = headingMatch[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Push last block
  if (currentHeading || currentLines.length > 0) {
    blocks.push({
      heading: currentHeading,
      content: currentLines.join('\n').trim(),
    });
  }

  return blocks.filter(b => b.content.length > 0 || b.heading.length > 0);
}
