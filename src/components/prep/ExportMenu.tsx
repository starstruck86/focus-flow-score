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
}

export function ExportMenu({ title, markdown }: ExportMenuProps) {
  const [exporting, setExporting] = useState<string | null>(null);

  const handlePdf = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) { toast.error('Pop-up blocked'); return; }
    const html = markdownToStyledHtml(markdown);
    printWindow.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #1a1a1a; }
        h1 { font-size: 28px; margin-bottom: 8px; border-bottom: 2px solid #e5e5e5; padding-bottom: 8px; }
        h2 { font-size: 22px; margin-top: 28px; color: #333; }
        h3 { font-size: 18px; margin-top: 24px; color: #444; }
        table { border-collapse: collapse; width: 100%; margin: 16px 0; }
        th, td { border: 1px solid #ddd; padding: 10px 14px; text-align: left; }
        th { background: #f5f5f5; font-weight: 600; }
        blockquote { border-left: 4px solid #0066ff; margin: 16px 0; padding: 12px 20px; color: #555; background: #f9f9f9; }
        code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
        pre { background: #f0f0f0; padding: 16px; border-radius: 8px; overflow-x: auto; }
        hr { border: none; border-top: 2px solid #e5e5e5; margin: 32px 0; }
        ul, ol { padding-left: 24px; }
        li { margin: 4px 0; }
        @media print { body { margin: 20px; } }
      </style></head>
      <body><h1>${title}</h1>${html}</body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  const handleDocx = async () => {
    setExporting('docx');
    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import('docx');
      const { saveAs } = await import('file-saver');

      const children: any[] = [];
      const lines = markdown.split('\n');

      for (const line of lines) {
        if (line.startsWith('### ')) {
          children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: line.slice(4), bold: true })] }));
        } else if (line.startsWith('## ')) {
          children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: line.slice(3), bold: true })] }));
        } else if (line.startsWith('# ')) {
          children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: line.slice(2), bold: true, size: 32 })] }));
        } else if (line.startsWith('- ') || line.startsWith('* ')) {
          children.push(new Paragraph({ bullet: { level: 0 }, children: parseInlineFormatting(line.slice(2), TextRun) }));
        } else if (/^\d+\.\s/.test(line)) {
          children.push(new Paragraph({ children: parseInlineFormatting(line, TextRun) }));
        } else if (line.startsWith('> ')) {
          children.push(new Paragraph({ indent: { left: 720 }, children: [new TextRun({ text: line.slice(2), italics: true, color: '666666' })] }));
        } else if (line === '---') {
          children.push(new Paragraph({ border: { bottom: { style: 'single' as any, size: 6, color: 'CCCCCC' } }, children: [] }));
        } else if (line.trim()) {
          children.push(new Paragraph({ children: parseInlineFormatting(line, TextRun) }));
        } else {
          children.push(new Paragraph({ children: [] }));
        }
      }

      const doc = new Document({
        sections: [{ properties: { page: { size: { width: 12240, height: 15840 } } }, children }],
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

  const handlePptx = async () => {
    setExporting('pptx');
    try {
      const PptxGenJS = (await import('pptxgenjs')).default;
      const pptx = new PptxGenJS();
      pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
      pptx.layout = 'WIDE';

      // Split by H1/H2 into slides
      const sections = markdown.split(/(?=^#{1,2}\s)/m).filter(Boolean);

      if (sections.length === 0) {
        const slide = pptx.addSlide();
        slide.addText(title, { x: 0.5, y: 0.5, w: 12, h: 1.2, fontSize: 28, bold: true, color: '1a1a1a' });
        slide.addText(markdown.slice(0, 2000), { x: 0.5, y: 2, w: 12, h: 4.5, fontSize: 14, color: '333333', breakType: 'none' });
      } else {
        for (const section of sections) {
          const slide = pptx.addSlide();
          const lines = section.trim().split('\n');
          const heading = lines[0]?.replace(/^#+\s*/, '') || 'Slide';
          const body = lines.slice(1).join('\n').trim();

          slide.addText(heading, { x: 0.5, y: 0.3, w: 12, h: 1, fontSize: 24, bold: true, color: '1a1a1a' });
          if (body) {
            const bodyItems = body.split('\n').filter(Boolean).map(l => ({
              text: l.replace(/^[-*]\s/, '• ').replace(/^\d+\.\s/, ''),
              options: { fontSize: 14, color: '444444', breakType: 'none' as const },
            }));
            slide.addText(bodyItems, { x: 0.5, y: 1.5, w: 12, h: 5, valign: 'top' });
          }
        }
      }

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

// Helpers
function markdownToStyledHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/---/g, '<hr />')
    .replace(/\n/g, '<br />');
}

function parseInlineFormatting(text: string, TextRun: any): any[] {
  const runs: any[] = [];
  const regex = /\*\*(.+?)\*\*|_(.+?)_|`(.+?)`|([^*_`]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) runs.push(new TextRun({ text: match[1], bold: true }));
    else if (match[2]) runs.push(new TextRun({ text: match[2], italics: true }));
    else if (match[3]) runs.push(new TextRun({ text: match[3], font: 'Courier New', size: 20 }));
    else if (match[4]) runs.push(new TextRun({ text: match[4] }));
  }
  return runs.length ? runs : [new TextRun({ text })];
}
