import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, FileText, Presentation, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface ExportMenuProps {
  title: string;
  markdown: string;
  accountName?: string;
}

// ── Brand colors ──
const BRAND = {
  primary: '1E3A5F',
  accent: '2E75B6',
  light: 'D5E8F0',
  dark: '0D1B2A',
  gray: '666666',
  lightGray: 'F5F5F5',
  white: 'FFFFFF',
};

export function ExportMenu({ title, markdown, accountName }: ExportMenuProps) {
  const [exporting, setExporting] = useState<string | null>(null);
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // ═══════════════════════════════════════
  // PDF Export — Professional print layout
  // ═══════════════════════════════════════
  const handlePdf = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) { toast.error('Pop-up blocked'); return; }

    const bodyHtml = markdownToStyledHtml(markdown);
    printWindow.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
      <style>
        @page { size: letter; margin: 1in; }
        body { font-family: 'Georgia', 'Times New Roman', serif; max-width: 100%; margin: 0; padding: 0; line-height: 1.7; color: #1a1a1a; font-size: 11pt; }
        
        /* Cover page */
        .cover { page-break-after: always; display: flex; flex-direction: column; justify-content: center; min-height: 80vh; }
        .cover-line { width: 80px; height: 4px; background: #${BRAND.accent}; margin-bottom: 24px; }
        .cover h1 { font-size: 36pt; margin: 0 0 16px 0; color: #${BRAND.dark}; border: none; padding: 0; line-height: 1.2; }
        .cover .meta { font-size: 12pt; color: #${BRAND.gray}; margin-top: 8px; }
        
        /* Headings */
        h1 { font-size: 22pt; margin: 32px 0 12px; color: #${BRAND.primary}; border-bottom: 2px solid #${BRAND.light}; padding-bottom: 6px; }
        h2 { font-size: 16pt; margin: 28px 0 10px; color: #${BRAND.primary}; }
        h3 { font-size: 13pt; margin: 24px 0 8px; color: #333; }
        
        /* Tables */
        table { border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 10pt; }
        th { background: #${BRAND.primary}; color: white; padding: 10px 14px; text-align: left; font-weight: 600; }
        td { border: 1px solid #ddd; padding: 9px 14px; }
        tr:nth-child(even) td { background: #${BRAND.lightGray}; }
        
        blockquote { border-left: 4px solid #${BRAND.accent}; margin: 16px 0; padding: 12px 20px; color: #555; background: #f9f9f9; font-style: italic; }
        code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 10pt; font-family: 'Consolas', monospace; }
        pre { background: #f0f0f0; padding: 16px; border-radius: 6px; overflow-x: auto; font-size: 10pt; }
        hr { border: none; border-top: 2px solid #${BRAND.light}; margin: 32px 0; }
        ul, ol { padding-left: 24px; }
        li { margin: 6px 0; }
        strong { color: #${BRAND.primary}; }
        
        /* Footer */
        @media print {
          .cover { min-height: 90vh; }
        }
      </style></head>
      <body>
        <div class="cover">
          <div class="cover-line"></div>
          <h1>${title}</h1>
          ${accountName ? `<div class="meta">${accountName}</div>` : ''}
          <div class="meta">${dateStr}</div>
        </div>
        ${bodyHtml}
      </body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  // ═══════════════════════════════════════
  // DOCX Export — Professional Word doc
  // ═══════════════════════════════════════
  const handleDocx = async () => {
    setExporting('docx');
    try {
      const {
        Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
        Table, TableRow, TableCell, BorderStyle, WidthType, ShadingType,
        Header, Footer, PageNumber, PageBreak, TableOfContents,
        TabStopType, TabStopPosition, LevelFormat,
      } = await import('docx');
      const { saveAs } = await import('file-saver');

      const children: any[] = [];
      const parsed = parseMarkdownBlocks(markdown);

      // ── Cover Page ──
      children.push(new Paragraph({ spacing: { before: 4000 }, children: [] }));
      children.push(new Paragraph({
        spacing: { after: 200 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND.accent, space: 1 } },
        children: [],
      }));
      children.push(new Paragraph({
        spacing: { before: 400, after: 200 },
        children: [new TextRun({ text: title, bold: true, size: 56, font: 'Georgia', color: BRAND.dark })],
      }));
      if (accountName) {
        children.push(new Paragraph({
          spacing: { after: 100 },
          children: [new TextRun({ text: accountName, size: 28, font: 'Georgia', color: BRAND.gray })],
        }));
      }
      children.push(new Paragraph({
        children: [new TextRun({ text: dateStr, size: 24, font: 'Georgia', color: BRAND.gray })],
      }));
      children.push(new Paragraph({ children: [new PageBreak()] }));

      // ── Table of Contents ──
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: 'Table of Contents', bold: true, font: 'Georgia', size: 32, color: BRAND.primary })],
      }));
      children.push(new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-3' }));
      children.push(new Paragraph({ children: [new PageBreak()] }));

      // ── Body ──
      for (const block of parsed) {
        if (block.type === 'h1') {
          children.push(new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 360, after: 200 },
            children: [new TextRun({ text: block.text, bold: true, font: 'Georgia', size: 32, color: BRAND.primary })],
          }));
        } else if (block.type === 'h2') {
          children.push(new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 280, after: 160 },
            children: [new TextRun({ text: block.text, bold: true, font: 'Georgia', size: 28, color: BRAND.primary })],
          }));
        } else if (block.type === 'h3') {
          children.push(new Paragraph({
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 240, after: 120 },
            children: [new TextRun({ text: block.text, bold: true, font: 'Georgia', size: 24, color: '333333' })],
          }));
        } else if (block.type === 'bullet') {
          children.push(new Paragraph({
            bullet: { level: block.level || 0 },
            spacing: { after: 60 },
            children: parseInlineFormatting(block.text, TextRun),
          }));
        } else if (block.type === 'numbered') {
          children.push(new Paragraph({
            spacing: { after: 60 },
            children: parseInlineFormatting(block.text, TextRun),
          }));
        } else if (block.type === 'blockquote') {
          children.push(new Paragraph({
            indent: { left: 720 },
            border: { left: { style: BorderStyle.SINGLE, size: 6, color: BRAND.accent, space: 8 } },
            spacing: { before: 120, after: 120 },
            children: [new TextRun({ text: block.text, italics: true, color: BRAND.gray, font: 'Georgia', size: 22 })],
          }));
        } else if (block.type === 'hr') {
          children.push(new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BRAND.light, space: 1 } },
            spacing: { before: 200, after: 200 },
            children: [],
          }));
        } else if (block.type === 'table') {
          const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
          const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
          const colCount = block.rows![0]?.length || 2;
          const colWidth = Math.floor(9360 / colCount);
          const columnWidths = Array(colCount).fill(colWidth);

          const tableRows = block.rows!.map((row: string[], rowIdx: number) =>
            new TableRow({
              children: row.map(cell =>
                new TableCell({
                  borders: cellBorders,
                  width: { size: colWidth, type: WidthType.DXA },
                  shading: rowIdx === 0
                    ? { fill: BRAND.primary, type: ShadingType.CLEAR }
                    : rowIdx % 2 === 0
                      ? { fill: BRAND.lightGray, type: ShadingType.CLEAR }
                      : undefined,
                  margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  children: [new Paragraph({
                    children: [new TextRun({
                      text: cell.trim(),
                      bold: rowIdx === 0,
                      color: rowIdx === 0 ? BRAND.white : '1a1a1a',
                      font: 'Arial',
                      size: 20,
                    })],
                  })],
                })
              ),
            })
          );

          children.push(new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths,
            rows: tableRows,
          }));
          children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        } else if (block.type === 'empty') {
          children.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
        } else {
          children.push(new Paragraph({
            spacing: { after: 100 },
            children: parseInlineFormatting(block.text, TextRun),
          }));
        }
      }

      const doc = new Document({
        styles: {
          default: {
            document: { run: { font: 'Georgia', size: 22 } },
          },
          paragraphStyles: [
            { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, font: 'Georgia', color: BRAND.primary }, paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
            { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, font: 'Georgia', color: BRAND.primary }, paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 } },
            { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, font: 'Georgia', color: '333333' }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 2 } },
          ],
        },
        sections: [{
          properties: {
            page: {
              size: { width: 12240, height: 15840 },
              margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
            },
          },
          headers: {
            default: new Header({
              children: [new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: title, font: 'Arial', size: 16, color: BRAND.gray, italics: true })],
              })],
            }),
          },
          footers: {
            default: new Footer({
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'Page ', font: 'Arial', size: 16, color: BRAND.gray }),
                  new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 16, color: BRAND.gray }),
                ],
              })],
            }),
          },
          children,
        }],
      });

      const buffer = await Packer.toBlob(doc);
      saveAs(buffer, `${title.replace(/[^a-zA-Z0-9]/g, '_')}.docx`);
      toast.success('DOCX exported');
    } catch (e) {
      console.error(e);
      toast.error('Export failed');
    } finally {
      setExporting(null);
    }
  };

  // ═══════════════════════════════════════
  // PPTX Export — Professional slides
  // ═══════════════════════════════════════
  const handlePptx = async () => {
    setExporting('pptx');
    try {
      const PptxGenJS = (await import('pptxgenjs')).default;
      const pptx = new PptxGenJS();
      pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
      pptx.layout = 'WIDE';

      // ── Cover Slide ──
      const cover = pptx.addSlide();
      cover.background = { fill: BRAND.dark };
      cover.addShape(pptx.ShapeType.rect, { x: 0.6, y: 3.0, w: 1.5, h: 0.06, fill: { color: BRAND.accent } });
      cover.addText(title, { x: 0.6, y: 3.3, w: 10, h: 1.5, fontSize: 36, bold: true, color: BRAND.white, fontFace: 'Georgia' });
      const coverMeta = [accountName, dateStr].filter(Boolean).join('  ·  ');
      cover.addText(coverMeta, { x: 0.6, y: 5.0, w: 10, h: 0.5, fontSize: 14, color: '999999', fontFace: 'Arial' });

      // Split markdown into sections by H1/H2
      const sections = splitIntoSections(markdown);

      // ── Agenda Slide ──
      if (sections.length > 1) {
        const agenda = pptx.addSlide();
        agenda.background = { fill: BRAND.lightGray };
        agenda.addText('Agenda', { x: 0.6, y: 0.4, w: 12, h: 0.8, fontSize: 28, bold: true, color: BRAND.dark, fontFace: 'Georgia' });
        agenda.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.1, w: 1.2, h: 0.04, fill: { color: BRAND.accent } });

        const agendaItems = sections.map((s, i) => ({
          text: `${i + 1}.  ${s.heading}`,
          options: { fontSize: 16, color: BRAND.primary, fontFace: 'Arial', bullet: false, paraSpaceAfter: 10 } as any,
        }));
        agenda.addText(agendaItems, { x: 0.6, y: 1.6, w: 11, h: 5, valign: 'top' });
      }

      // ── Content Slides ──
      for (const section of sections) {
        const slide = pptx.addSlide();
        slide.background = { fill: BRAND.white };

        // Title bar
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 1.2, fill: { color: BRAND.primary } });
        slide.addText(section.heading, { x: 0.6, y: 0.15, w: 12, h: 0.9, fontSize: 22, bold: true, color: BRAND.white, fontFace: 'Georgia', valign: 'middle' });

        // Body content
        if (section.table) {
          // Render table
          const tableRows: any[][] = section.table.map((row: string[], rIdx: number) =>
            row.map(cell => ({
              text: cell.trim(),
              options: {
                fontSize: 11,
                color: rIdx === 0 ? BRAND.white : '333333',
                bold: rIdx === 0,
                fontFace: 'Arial',
              },
            }))
          );
          slide.addTable(tableRows, {
            x: 0.6, y: 1.5, w: 12.1,
            border: { type: 'solid', pt: 0.5, color: 'CCCCCC' },
            colW: Array(section.table[0]?.length || 2).fill(12.1 / (section.table[0]?.length || 2)),
            rowH: Array(section.table.length).fill(0.4),
            fill: { color: BRAND.lightGray },
            autoPage: true,
          } as any);
          // Header row fill
          if (tableRows.length > 0) {
            tableRows[0].forEach((cell: any) => {
              cell.options.fill = { color: BRAND.primary };
            });
          }
        } else {
          const bodyItems = section.bullets.map((line: string) => ({
            text: line.replace(/^[-*]\s/, '').replace(/^\d+\.\s/, ''),
            options: {
              fontSize: 14,
              color: '333333',
              fontFace: 'Arial',
              bullet: line.match(/^[-*]\s/) ? { type: 'bullet' as const } : false,
              paraSpaceAfter: 8,
            },
          }));
          if (bodyItems.length) {
            slide.addText(bodyItems, { x: 0.6, y: 1.5, w: 12, h: 5.2, valign: 'top' });
          }
        }

        // Slide number
        slide.addText([{ text: '', options: { fontSize: 10, color: BRAND.gray, fontFace: 'Arial' } }], { x: 12.3, y: 7.0, w: 0.8, h: 0.4, align: 'right' });
      }

      // ── Closing Slide ──
      const closing = pptx.addSlide();
      closing.background = { fill: BRAND.dark };
      closing.addShape(pptx.ShapeType.rect, { x: 5.5, y: 3.0, w: 2.3, h: 0.06, fill: { color: BRAND.accent } });
      closing.addText('Thank You', { x: 1, y: 3.3, w: 11.33, h: 1.2, fontSize: 36, bold: true, color: BRAND.white, fontFace: 'Georgia', align: 'center' });
      closing.addText('Next Steps & Discussion', { x: 1, y: 4.6, w: 11.33, h: 0.5, fontSize: 16, color: '999999', fontFace: 'Arial', align: 'center' });

      await pptx.writeFile({ fileName: `${title.replace(/[^a-zA-Z0-9]/g, '_')}.pptx` });
      toast.success('PPTX exported');
    } catch (e) {
      console.error(e);
      toast.error('Export failed');
    } finally {
      setExporting(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={!!exporting}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handlePdf}>
          <FileText className="h-3.5 w-3.5 mr-2" /> PDF (Print)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleDocx}>
          <FileText className="h-3.5 w-3.5 mr-2" /> Word (.docx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handlePptx}>
          <Presentation className="h-3.5 w-3.5 mr-2" /> PowerPoint (.pptx)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ═══════════════════════════════════════════════
// Markdown Parsing Helpers
// ═══════════════════════════════════════════════

interface ParsedBlock {
  type: 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'blockquote' | 'hr' | 'table' | 'paragraph' | 'empty';
  text: string;
  level?: number;
  rows?: string[][];
}

function parseMarkdownBlocks(md: string): ParsedBlock[] {
  const lines = md.split('\n');
  const blocks: ParsedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Table detection
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1]?.match(/^\|[\s-:|]+\|/)) {
      const tableRows: string[][] = [];
      // Header row
      tableRows.push(line.split('|').filter(c => c.trim()).map(c => c.trim()));
      i++; // skip separator
      i++;
      while (i < lines.length && lines[i]?.includes('|')) {
        tableRows.push(lines[i].split('|').filter(c => c.trim()).map(c => c.trim()));
        i++;
      }
      blocks.push({ type: 'table', text: '', rows: tableRows });
      continue;
    }

    if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', text: line.slice(4) });
    } else if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', text: line.slice(3) });
    } else if (line.startsWith('# ')) {
      blocks.push({ type: 'h1', text: line.slice(2) });
    } else if (line.match(/^\s*[-*]\s/)) {
      const indent = line.match(/^(\s*)/)?.[1]?.length || 0;
      blocks.push({ type: 'bullet', text: line.replace(/^\s*[-*]\s/, ''), level: Math.floor(indent / 2) });
    } else if (/^\d+\.\s/.test(line)) {
      blocks.push({ type: 'numbered', text: line });
    } else if (line.startsWith('> ')) {
      blocks.push({ type: 'blockquote', text: line.slice(2) });
    } else if (line.trim() === '---') {
      blocks.push({ type: 'hr', text: '' });
    } else if (line.trim() === '') {
      blocks.push({ type: 'empty', text: '' });
    } else {
      blocks.push({ type: 'paragraph', text: line });
    }
    i++;
  }
  return blocks;
}

function splitIntoSections(md: string): { heading: string; bullets: string[]; table?: string[][] }[] {
  const sections: { heading: string; bullets: string[]; table?: string[][] }[] = [];
  const rawSections = md.split(/(?=^#{1,2}\s)/m).filter(s => s.trim());

  for (const raw of rawSections) {
    const lines = raw.trim().split('\n');
    const heading = lines[0]?.replace(/^#+\s*/, '') || 'Slide';
    const bodyLines = lines.slice(1).filter(l => l.trim() && !l.match(/^\|[\s-:|]+\|$/));

    // Check for table
    let table: string[][] | undefined;
    const tableStart = lines.findIndex(l => l.includes('|'));
    if (tableStart >= 0) {
      table = [];
      for (let i = tableStart; i < lines.length; i++) {
        if (lines[i].match(/^\|[\s-:|]+\|$/)) continue; // skip separator
        if (lines[i].includes('|')) {
          table.push(lines[i].split('|').filter(c => c.trim()).map(c => c.trim()));
        }
      }
    }

    const bullets = bodyLines.filter(l => !l.includes('|')).filter(Boolean);
    sections.push({ heading, bullets, table: table?.length ? table : undefined });
  }

  return sections.length ? sections : [{ heading: 'Content', bullets: md.split('\n').filter(l => l.trim()) }];
}

function markdownToStyledHtml(md: string): string {
  let html = md;

  // Tables
  html = html.replace(/^(\|.+\|)\n(\|[\s-:|]+\|)\n((?:\|.+\|\n?)*)/gm, (_m, header, _sep, body) => {
    const hCells = (header as string).split('|').filter((c: string) => c.trim()).map((c: string) => `<th>${c.trim()}</th>`).join('');
    const rows = (body as string).trim().split('\n').map((row: string) => {
      const cells = row.split('|').filter((c: string) => c.trim()).map((c: string) => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${hCells}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  html = html
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^---$/gm, '<hr />')
    .replace(/\n/g, '<br />');

  return html;
}

function parseInlineFormatting(text: string, TextRun: any): any[] {
  const runs: any[] = [];
  const regex = /\*\*(.+?)\*\*|_(.+?)_|`(.+?)`|([^*_`]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) runs.push(new TextRun({ text: match[1], bold: true, font: 'Georgia', size: 22 }));
    else if (match[2]) runs.push(new TextRun({ text: match[2], italics: true, font: 'Georgia', size: 22 }));
    else if (match[3]) runs.push(new TextRun({ text: match[3], font: 'Consolas', size: 20 }));
    else if (match[4]) runs.push(new TextRun({ text: match[4], font: 'Georgia', size: 22 }));
  }
  return runs.length ? runs : [new TextRun({ text, font: 'Georgia', size: 22 })];
}
