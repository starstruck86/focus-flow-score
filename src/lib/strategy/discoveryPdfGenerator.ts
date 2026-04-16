import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { downloadBlob } from './discoveryDocxGenerator';

// Extend jsPDF type for autotable
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
    lastAutoTable: { finalY: number };
  }
}

const COLORS = {
  primary: [31, 78, 121] as [number, number, number],
  accent: [46, 117, 182] as [number, number, number],
  headerBg: [213, 232, 240] as [number, number, number],
  cardBg: [242, 247, 250] as [number, number, number],
  text: [26, 26, 26] as [number, number, number],
  muted: [90, 106, 122] as [number, number, number],
};

function addHeading(doc: jsPDF, text: string, y: number, level: 1 | 2 | 3 = 2): number {
  const sizes = { 1: 16, 2: 13, 3: 11 };
  doc.setFontSize(sizes[level]);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.primary);
  if (y > 250) { doc.addPage(); y = 20; }
  doc.text(text, 15, y);
  return y + sizes[level] * 0.5 + 4;
}

function addBody(doc: jsPDF, text: string, y: number, opts?: { bold?: boolean; maxWidth?: number }): number {
  doc.setFontSize(10);
  doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal');
  doc.setTextColor(...COLORS.text);
  const maxW = opts?.maxWidth || 180;
  const lines = doc.splitTextToSize(text || 'Unknown', maxW);
  if (y + lines.length * 5 > 275) { doc.addPage(); y = 20; }
  doc.text(lines, 15, y);
  return y + lines.length * 5 + 2;
}

function addTable(doc: jsPDF, headers: string[], rows: string[][], y: number): number {
  if (y > 240) { doc.addPage(); y = 20; }
  doc.autoTable({
    startY: y,
    head: [headers],
    body: rows,
    margin: { left: 15, right: 15 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: COLORS.text },
    headStyles: { fillColor: COLORS.headerBg, textColor: COLORS.primary, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [250, 252, 254] },
    theme: 'grid',
  });
  return doc.lastAutoTable.finalY + 6;
}

function addBullets(doc: jsPDF, items: string[], y: number): number {
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.text);
  for (const item of items) {
    if (y > 270) { doc.addPage(); y = 20; }
    const lines = doc.splitTextToSize(`• ${item}`, 175);
    doc.text(lines, 18, y);
    y += lines.length * 5 + 1;
  }
  return y + 2;
}

export async function generateDiscoveryPdf(sections: any[], companyName: string): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  let y = 20;

  for (const section of sections) {
    const c = section.content;
    if (!c) continue;

    switch (section.id) {
      case 'cockpit': {
        y = addHeading(doc, 'Page-1 Cockpit', y, 1);
        const cards = c.cards || [];
        for (const card of cards) {
          y = addBody(doc, `${card.label}:`, y, { bold: true });
          if (card.bullets) { y = addBullets(doc, card.bullets, y); }
          else { y = addBody(doc, card.value || 'Unknown', y); }
          y += 2;
        }
        break;
      }
      case 'cover': {
        y = addHeading(doc, 'Prep Doc', y, 1);
        y = addTable(doc, ['Field', 'Value'], [
          ['Rep Name', c.rep_name || 'Unknown'],
          ['Opportunity', c.opportunity || 'Unknown'],
          ['Sales Stage', c.stage || 'Unknown'],
          ['Platform Scale', c.platform_scale || 'Unknown'],
        ], y);
        break;
      }
      case 'participants': {
        y = addHeading(doc, 'Participants', y, 2);
        if (c.prospect?.length) {
          y = addTable(doc, ['Name', 'Title', 'Role'],
            c.prospect.map((p: any) => [p.name, p.title || '', p.role || '']), y);
        }
        if (c.internal?.length) {
          y = addTable(doc, ['Name', 'Role'],
            c.internal.map((p: any) => [p.name, p.role || '']), y);
        }
        break;
      }
      case 'value_selling': {
        y = addHeading(doc, 'Value Selling Observations', y, 2);
        const vsRows = [
          ['How do they make money?', c.money],
          ['Competitors', c.compete],
          ['Pain Hypothesis', c.pain_hypothesis],
          ['C-Suite Initiative', c.csuite_initiative],
          ['Current State', c.current_state],
          ['Industry Pressures', c.industry_pressures],
          ['Problems & Pain', c.problems_and_pain],
          ['Ideal State', c.ideal_state],
          ['Value Driver', c.value_driver],
          ['POV', c.pov],
        ].map(([k, v]) => [k as string, (v as string) || 'Unknown']);
        y = addTable(doc, ['Question', 'Observation'], vsRows, y);
        break;
      }
      case 'discovery_questions': {
        y = addHeading(doc, 'Discovery-1 Questions', y, 2);
        (c.questions || []).forEach((q: string, i: number) => {
          y = addBody(doc, `${i + 1}. ${q}`, y);
        });
        break;
      }
      case 'customer_examples': {
        y = addHeading(doc, 'Customer Examples', y, 2);
        const examples = Array.isArray(c) ? c : [];
        if (examples.length) {
          y = addTable(doc, ['Customer', 'Link', 'Relevance'],
            examples.map((e: any) => [e.customer, e.link || '—', e.relevance || '']), y);
        }
        break;
      }
      case 'pivot_statements': {
        y = addHeading(doc, 'Pivot Statements', y, 2);
        y = addTable(doc, ['Pain Statement', 'FOMO Statement'],
          [[c.pain_statement || 'Unknown', c.fomo_statement || 'Unknown']], y);
        break;
      }
      case 'objection_handling': {
        y = addHeading(doc, 'Objection Handling', y, 2);
        const objs = Array.isArray(c) ? c : [];
        if (objs.length) {
          y = addTable(doc, ['Objection', 'Response'],
            objs.map((o: any) => [o.objection, o.response]), y);
        }
        break;
      }
      case 'exit_criteria': {
        y = addHeading(doc, 'Exit Criteria & MEDDPICC', y, 2);
        if (c.known?.length) { y = addBody(doc, 'Known:', y, { bold: true }); y = addBullets(doc, c.known, y); }
        if (c.gaps?.length) { y = addBody(doc, 'Gaps:', y, { bold: true }); y = addBullets(doc, c.gaps, y); }
        if (c.meddpicc_gaps?.length) { y = addBody(doc, 'MEDDPICC Gaps:', y, { bold: true }); y = addBullets(doc, c.meddpicc_gaps, y); }
        break;
      }
      case 'tech_stack': {
        y = addHeading(doc, 'Tech Stack & Consolidation', y, 2);
        const stacks = Array.isArray(c) ? c : [];
        if (stacks.length) {
          y = addTable(doc, ['Layer', 'Vendor', 'Evidence', 'Consolidation Opp.'],
            stacks.map((s: any) => [s.layer, s.vendor || 'Unknown', s.evidence || '', s.consolidation_opportunity || '']), y);
        }
        break;
      }
      case 'appendix': {
        doc.addPage();
        y = 20;
        y = addHeading(doc, 'APPENDIX: Deep Research', y, 1);
        if (c.cx_audit_detail) { y = addHeading(doc, 'CX Audit Detail', y, 3); y = addBody(doc, c.cx_audit_detail, y); }
        if (c.subscription_teardown) { y = addHeading(doc, 'Subscription Teardown', y, 3); y = addBody(doc, c.subscription_teardown, y); }
        if (c.business_model_detail) { y = addHeading(doc, 'Business Model', y, 3); y = addBody(doc, c.business_model_detail, y); }
        if (c.industry_analysis) { y = addHeading(doc, 'Industry Analysis', y, 3); y = addBody(doc, c.industry_analysis, y); }
        break;
      }
      default: {
        y = addHeading(doc, section.name || section.id, y, 2);
        if (typeof c === 'string') y = addBody(doc, c, y);
        else if (c.summary) y = addBody(doc, c.summary, y);
        break;
      }
    }
    y += 4;
  }

  return doc.output('blob');
}
