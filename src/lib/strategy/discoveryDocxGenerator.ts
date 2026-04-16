import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat,
} from 'docx';

// ── Constants ──
const PAGE_WIDTH = 12240; // US Letter
const PAGE_HEIGHT = 15840;
const MARGIN = 1440; // 1 inch
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN; // 9360
const FONT = 'Arial';
const COLORS = {
  primary: '1F4E79',
  accent: '2E75B6',
  headerBg: 'D5E8F0',
  cardBg: 'F2F7FA',
  borderLight: 'D0D5DD',
  textDark: '1A1A1A',
  textMuted: '5A6A7A',
  white: 'FFFFFF',
};

const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: COLORS.borderLight };
const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
const noBorder = { style: BorderStyle.NONE, size: 0, color: COLORS.white };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const cardBorders = {
  top: { style: BorderStyle.SINGLE, size: 1, color: COLORS.headerBg },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.headerBg },
  left: { style: BorderStyle.SINGLE, size: 1, color: COLORS.headerBg },
  right: { style: BorderStyle.SINGLE, size: 1, color: COLORS.headerBg },
};
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

// ── Helpers ──

function heading(text: string, level: 1 | 2 | 3 = 2): Paragraph {
  const sizes = { 1: 32, 2: 28, 3: 24 }; // 16pt, 14pt, 12pt
  return new Paragraph({
    spacing: { before: level === 1 ? 300 : 200, after: 120 },
    children: [new TextRun({ text, bold: true, size: sizes[level], font: FONT, color: COLORS.primary })],
  });
}

function bodyText(text: string, opts?: { bold?: boolean; italic?: boolean; size?: number }): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({
      text, font: FONT, size: opts?.size ?? 22, // 11pt
      bold: opts?.bold, italics: opts?.italic, color: COLORS.textDark,
    })],
  });
}

function bulletItem(text: string, ref = 'bullets'): Paragraph {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 40 },
    children: [new TextRun({ text, font: FONT, size: 22, color: COLORS.textDark })],
  });
}

function headerCell(text: string, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: cellBorders,
    shading: { fill: COLORS.headerBg, type: ShadingType.CLEAR },
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, font: FONT, size: 18, color: COLORS.primary })] })],
  });
}

function dataCell(text: string, width: number, opts?: { bold?: boolean; shading?: string }): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: cellBorders,
    shading: opts?.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: cellMargins,
    children: [new Paragraph({
      spacing: { after: 20 },
      children: [new TextRun({ text: text || 'Unknown', font: FONT, size: 18, bold: opts?.bold, color: COLORS.textDark })],
    })],
  });
}

function cardTable(label: string, content: string | string[]): Table {
  const contentParagraphs = Array.isArray(content)
    ? content.map(b => new Paragraph({
        spacing: { after: 30 },
        children: [new TextRun({ text: `• ${b}`, font: FONT, size: 18, color: COLORS.textDark })],
      }))
    : [new Paragraph({
        spacing: { after: 30 },
        children: [new TextRun({ text: content || 'Unknown', font: FONT, size: 18, color: COLORS.textDark })],
      })];

  return new Table({
    width: { size: CONTENT_WIDTH / 2 - 100, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH / 2 - 100],
    rows: [
      new TableRow({
        children: [new TableCell({
          width: { size: CONTENT_WIDTH / 2 - 100, type: WidthType.DXA },
          borders: cardBorders,
          shading: { fill: COLORS.cardBg, type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [
            new Paragraph({
              spacing: { after: 40 },
              children: [new TextRun({ text: label, bold: true, font: FONT, size: 20, color: COLORS.primary })],
            }),
            ...contentParagraphs,
          ],
        })],
      }),
    ],
  });
}

// ── Section renderers ──

function renderCockpit(content: any): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [heading('Page-1 Cockpit', 1)];
  const cards = content?.cards || [];
  // Render cards as individual card tables
  for (const card of cards) {
    const val = card.bullets || card.value;
    elements.push(cardTable(card.label, val));
    elements.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
  }
  return elements;
}

function renderCover(content: any): (Paragraph | Table)[] {
  const rows = [
    ['Rep Name', content?.rep_name],
    ['Opportunity Name & SFDC Link', content?.opportunity],
    ['Sales Stage', content?.stage],
    ['Platform Scale Opp.', content?.platform_scale],
  ];
  return [
    heading('Prep Doc', 1),
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [3500, CONTENT_WIDTH - 3500],
      rows: rows.map(([label, value]) =>
        new TableRow({
          children: [
            dataCell(label, 3500, { bold: true, shading: COLORS.cardBg }),
            dataCell(value || 'Unknown', CONTENT_WIDTH - 3500),
          ],
        })
      ),
    }),
  ];
}

function renderParticipants(content: any): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [heading('Participants', 2)];
  const colW = CONTENT_WIDTH / 3;

  if (content?.prospect?.length) {
    elements.push(bodyText('Prospect Side', { bold: true, size: 20 }));
    elements.push(new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [colW, colW, colW],
      rows: [
        new TableRow({ children: [headerCell('Name', colW), headerCell('Title', colW), headerCell('Role', colW)] }),
        ...(content.prospect || []).map((p: any) =>
          new TableRow({ children: [dataCell(p.name, colW), dataCell(p.title, colW), dataCell(p.role, colW)] })
        ),
      ],
    }));
  }
  if (content?.internal?.length) {
    elements.push(new Paragraph({ spacing: { before: 120 }, children: [] }));
    elements.push(bodyText('Internal Team', { bold: true, size: 20 }));
    const colW2 = CONTENT_WIDTH / 2;
    elements.push(new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [colW2, colW2],
      rows: [
        new TableRow({ children: [headerCell('Name', colW2), headerCell('Role', colW2)] }),
        ...(content.internal || []).map((p: any) =>
          new TableRow({ children: [dataCell(p.name, colW2), dataCell(p.role, colW2)] })
        ),
      ],
    }));
  }
  return elements;
}

function renderValueSelling(content: any): (Paragraph | Table)[] {
  const rows = [
    ['How do they make money?', content?.money],
    ['Who do they compete with?', content?.compete],
    ['Pain hypothesis', content?.pain_hypothesis],
    ['C-Suite initiative & Business Objectives', content?.csuite_initiative],
    ['Current State (channels, technology)', content?.current_state],
    ['Industry pressures', content?.industry_pressures],
    ['Problems & Pain → C-Suite translation', content?.problems_and_pain],
    ['Ideal State', content?.ideal_state],
    ['Value Driver', content?.value_driver],
    ['POV (3-5 sentences)', content?.pov],
  ];
  const labelW = 3800;
  const valueW = CONTENT_WIDTH - labelW;
  return [
    heading('Value Selling Observations Framework', 2),
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [labelW, valueW],
      rows: rows.map(([label, value]) =>
        new TableRow({
          children: [
            dataCell(label, labelW, { bold: true, shading: COLORS.cardBg }),
            dataCell(value || 'Unknown', valueW),
          ],
        })
      ),
    }),
  ];
}

function renderDiscoveryQuestions(content: any): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [heading('Discovery-1 Questions', 2)];
  (content?.questions || []).forEach((q: string, i: number) => {
    elements.push(bodyText(`${i + 1}. ${q}`));
  });
  if (content?.value_flow) {
    elements.push(new Paragraph({ spacing: { before: 120 }, children: [] }));
    elements.push(bodyText('Value Creation Discovery Flow', { bold: true, size: 20 }));
    const steps = ['current_state', 'problem', 'impact', 'ideal_solution', 'business_benefit'];
    steps.forEach(s => {
      const label = s.replace(/_/g, ' ').toUpperCase();
      elements.push(bodyText(`${label}: ${content.value_flow[s] || 'Unknown'}`));
    });
  }
  return elements;
}

function renderGenericTable(title: string, headers: string[], rows: any[], keyMap: string[]): (Paragraph | Table)[] {
  if (!rows?.length) return [heading(title, 2), bodyText('No data available.')];
  const colW = Math.floor(CONTENT_WIDTH / headers.length);
  const colWidths = headers.map(() => colW);
  return [
    heading(title, 2),
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: colWidths,
      rows: [
        new TableRow({ children: headers.map((h, i) => headerCell(h, colWidths[i])) }),
        ...rows.map((row: any) =>
          new TableRow({ children: keyMap.map((k, i) => dataCell(String(row[k] || 'Unknown'), colWidths[i])) })
        ),
      ],
    }),
  ];
}

function renderExitCriteria(content: any): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [heading('Exit Criteria & MEDDPICC', 2)];
  if (content?.known?.length) {
    elements.push(bodyText('Known:', { bold: true }));
    content.known.forEach((k: string) => elements.push(bulletItem(k)));
  }
  if (content?.gaps?.length) {
    elements.push(bodyText('Gaps to Fill:', { bold: true }));
    content.gaps.forEach((g: string) => elements.push(bulletItem(g)));
  }
  if (content?.meddpicc_gaps?.length) {
    elements.push(bodyText('MEDDPICC Gaps:', { bold: true }));
    content.meddpicc_gaps.forEach((m: string) => elements.push(bulletItem(m)));
  }
  return elements;
}

function renderAppendix(content: any): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [
    new Paragraph({ children: [new PageBreak()] }),
    heading('APPENDIX: Deep Research', 1),
  ];
  const sections = [
    ['CX Audit Detail', content?.cx_audit_detail],
    ['Subscription Teardown', content?.subscription_teardown],
    ['Business Model Detail', content?.business_model_detail],
    ['Industry Analysis', content?.industry_analysis],
  ];
  sections.forEach(([title, text]) => {
    if (text) {
      elements.push(heading(title as string, 3));
      elements.push(bodyText(text as string));
    }
  });
  if (content?.case_studies_full?.length) {
    elements.push(heading('Case Studies', 3));
    const colW = Math.floor(CONTENT_WIDTH / 4);
    elements.push(new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [colW, colW, colW, colW],
      rows: [
        new TableRow({ children: [headerCell('Source', colW), headerCell('Program', colW), headerCell('Result', colW), headerCell('Implication', colW)] }),
        ...(content.case_studies_full || []).map((cs: any) =>
          new TableRow({ children: [
            dataCell(cs.source, colW), dataCell(cs.program, colW),
            dataCell(cs.result, colW), dataCell(cs.maturity_implication, colW),
          ] })
        ),
      ],
    }));
  }
  return elements;
}

// ── Main generator ──

function renderSection(section: any): (Paragraph | Table)[] {
  switch (section.id) {
    case 'cockpit': return renderCockpit(section.content);
    case 'cover': return renderCover(section.content);
    case 'participants': return renderParticipants(section.content);
    case 'cx_audit': return [heading('CX Audit Check', 2), bodyText(section.content?.notes || 'Not yet completed')];
    case 'executive_snapshot': {
      const c = section.content || {};
      const elements: (Paragraph | Table)[] = [heading('Executive Snapshot', 2)];
      if (c.company_overview) elements.push(bodyText(c.company_overview));
      if (c.why_now) { elements.push(bodyText('Why Now:', { bold: true })); elements.push(bodyText(c.why_now)); }
      if (c.key_metrics?.length) {
        const colW = Math.floor(CONTENT_WIDTH / 3);
        elements.push(new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [colW, colW, colW],
          rows: [
            new TableRow({ children: [headerCell('Metric', colW), headerCell('Value', colW), headerCell('Source', colW)] }),
            ...c.key_metrics.map((m: any) => new TableRow({ children: [dataCell(m.metric, colW), dataCell(m.value, colW), dataCell(m.source, colW)] })),
          ],
        }));
      }
      if (c.exec_priorities?.length) {
        elements.push(bodyText('Executive Priorities:', { bold: true }));
        c.exec_priorities.forEach((p: string) => elements.push(bulletItem(p)));
      }
      return elements;
    }
    case 'value_selling': return renderValueSelling(section.content);
    case 'discovery_questions': return renderDiscoveryQuestions(section.content);
    case 'customer_examples':
      return renderGenericTable('Customer Examples', ['Customer', 'Case Study Link', 'Relevance'],
        Array.isArray(section.content) ? section.content : [], ['customer', 'link', 'relevance']);
    case 'pivot_statements': {
      const c = section.content || {};
      const colW = CONTENT_WIDTH / 2;
      return [
        heading('Pivot Statements', 2),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [colW, colW],
          rows: [
            new TableRow({ children: [headerCell('Pain Statement', colW), headerCell('FOMO Statement', colW)] }),
            new TableRow({ children: [dataCell(c.pain_statement, colW), dataCell(c.fomo_statement, colW)] }),
          ],
        }),
      ];
    }
    case 'objection_handling':
      return renderGenericTable('Objection Handling', ['Anticipated Objection', 'Response'],
        Array.isArray(section.content) ? section.content : [], ['objection', 'response']);
    case 'marketing_team': {
      const members = Array.isArray(section.content) ? section.content : [];
      const elements: (Paragraph | Table)[] = [heading('Marketing Team Members', 2)];
      members.forEach((m: any) => elements.push(bodyText(`${m.name} — ${m.title || 'Unknown'}${m.linkedin ? ` (${m.linkedin})` : ''}`)));
      if (!members.length) elements.push(bodyText('Unknown — add as discovery question'));
      return elements;
    }
    case 'exit_criteria': return renderExitCriteria(section.content);
    case 'revenue_pathway': {
      const c = section.content || {};
      const elements: (Paragraph | Table)[] = [heading('Revenue Pathway & Sensitivity', 2)];
      if (c.model?.length) {
        elements.push(...renderGenericTable('Revenue Model', ['Driver', 'Current', 'Potential', 'Assumptions'],
          c.model, ['driver', 'current', 'potential', 'assumptions']).slice(1));
      }
      if (c.sensitivity?.length) {
        elements.push(heading('Sensitivity Analysis', 3));
        elements.push(...renderGenericTable('', ['Scenario', 'Impact', 'Discovery Question'],
          c.sensitivity, ['scenario', 'impact', 'question']).slice(1));
      }
      if (c.math) {
        elements.push(heading('M.A.T.H.', 3));
        ['metric', 'actual', 'target', 'holding_back'].forEach(k => {
          elements.push(bodyText(`${k.replace(/_/g, ' ').toUpperCase()}: ${c.math[k] || 'Unknown'}`));
        });
      }
      return elements;
    }
    case 'metrics_intelligence':
      return renderGenericTable('Metrics Intelligence', ['Metric', 'Value', 'Date', 'Source', 'Implication', 'Question'],
        Array.isArray(section.content) ? section.content : [], ['metric', 'value', 'date', 'source', 'implication', 'question']);
    case 'loyalty_analysis': {
      const c = section.content || {};
      const elements: (Paragraph | Table)[] = [heading('Loyalty Program Analysis', 2)];
      const fields = [
        ['Program Exists', c.program_exists ? 'Yes' : 'No'],
        ['Program Type', c.program_type],
        ['Tiers', c.tiers],
        ['Subscription Tie-in', c.subscription_tie_in],
      ];
      const colW = CONTENT_WIDTH / 2;
      elements.push(new Table({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        columnWidths: [colW, colW],
        rows: fields.map(([label, value]) =>
          new TableRow({ children: [dataCell(label, colW, { bold: true, shading: COLORS.cardBg }), dataCell(value || 'Unknown', colW)] })
        ),
      }));
      if (c.key_observations?.length) {
        elements.push(bodyText('Key Observations:', { bold: true }));
        c.key_observations.forEach((o: string) => elements.push(bulletItem(o)));
      }
      return elements;
    }
    case 'tech_stack':
      return renderGenericTable('Tech Stack & Consolidation', ['Layer', 'Vendor', 'Evidence', 'Consolidation Opp.'],
        Array.isArray(section.content) ? section.content : [], ['layer', 'vendor', 'evidence', 'consolidation_opportunity']);
    case 'competitive_war_game':
      return renderGenericTable('Competitive War Game', ['Competitor', 'Strengths', 'Weaknesses', 'Differentiation'],
        Array.isArray(section.content) ? section.content : [], ['competitor', 'strengths', 'weaknesses', 'differentiation']);
    case 'hypotheses_risks': {
      const c = section.content || {};
      const elements: (Paragraph | Table)[] = [heading('Hypotheses, Blockers & Risk Heatmap', 2)];
      if (c.hypotheses?.length) { elements.push(bodyText('Top Hypotheses:', { bold: true })); c.hypotheses.forEach((h: string) => elements.push(bulletItem(h))); }
      if (c.blockers?.length) { elements.push(bodyText('Blockers:', { bold: true })); c.blockers.forEach((b: string) => elements.push(bulletItem(b))); }
      if (c.gap_log?.length) { elements.push(bodyText('Gap Log:', { bold: true })); c.gap_log.forEach((g: string) => elements.push(bulletItem(g))); }
      if (c.risk_heatmap?.length) {
        elements.push(...renderGenericTable('Risk Heatmap', ['Risk', 'Likelihood', 'Impact', 'Mitigation'],
          c.risk_heatmap, ['risk', 'likelihood', 'impact', 'mitigation']).slice(1));
      }
      return elements;
    }
    case 'appendix': return renderAppendix(section.content);
    default: {
      const elements: (Paragraph | Table)[] = [heading(section.name || section.id, 2)];
      if (typeof section.content === 'string') elements.push(bodyText(section.content));
      else elements.push(bodyText(JSON.stringify(section.content, null, 2)));
      return elements;
    }
  }
}

export async function generateDiscoveryDocx(sections: any[], companyName: string): Promise<Blob> {
  const children: (Paragraph | Table)[] = [];

  for (const section of sections) {
    children.push(...renderSection(section));
    children.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      }],
    },
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 32, bold: true, font: FONT, color: COLORS.primary },
          paragraph: { spacing: { before: 300, after: 120 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: FONT, color: COLORS.primary },
          paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 24, bold: true, font: FONT },
          paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: `Discovery Prep — ${companyName}`, font: FONT, size: 16, color: COLORS.textMuted, italics: true })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Page ', font: FONT, size: 16, color: COLORS.textMuted }),
              new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: COLORS.textMuted }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  return await Packer.toBlob(doc);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
