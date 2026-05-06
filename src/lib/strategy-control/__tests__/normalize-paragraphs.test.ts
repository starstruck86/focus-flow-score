import { describe, it, expect } from "vitest";
import { normalizeParagraphs } from "../normalizeParagraphs";
import { checkReadability } from "../artifactGate";

function makeWords(n: number): string {
  const words = [];
  for (let i = 0; i < n; i++) words.push(`word${i}`);
  return words.join(" ");
}

function makeSentences(count: number, wordsEach: number): string {
  return Array.from({ length: count }, (_, i) =>
    `Sentence${i} ` + makeWords(wordsEach - 1) + "."
  ).join(" ");
}

describe("normalizeParagraphs", () => {
  it("splits oversized prose paragraph at sentence boundaries", () => {
    // 3 sentences × 50 words each = 150 words total
    const longPara = makeSentences(3, 50);
    const { text, telemetry } = normalizeParagraphs(longPara);
    expect(telemetry.paragraphs_split).toBeGreaterThanOrEqual(1);
    expect(telemetry.longest_paragraph_before).toBeGreaterThan(120);
    expect(telemetry.longest_paragraph_after).toBeLessThanOrEqual(120);
    // All original content preserved
    const originalWords = longPara.split(/\s+/).length;
    const normalizedWords = text.split(/\s+/).length;
    expect(normalizedWords).toBe(originalWords);
  });

  it("preserves markdown headings", () => {
    const input = "# My Heading\n\n" + makeSentences(3, 50);
    const { text } = normalizeParagraphs(input);
    expect(text).toContain("# My Heading");
  });

  it("preserves citations", () => {
    const citation = "[KI:abc-123]";
    const input = `This is important because ${citation} the data shows results. ` + makeWords(130);
    const { text } = normalizeParagraphs(input);
    expect(text).toContain(citation);
  });

  it("preserves bullet lists", () => {
    const input = "- First item\n- Second item\n- Third item";
    const { text } = normalizeParagraphs(input);
    expect(text).toBe(input);
  });

  it("preserves numbered lists", () => {
    const input = "1. First\n2. Second\n3. Third";
    const { text } = normalizeParagraphs(input);
    expect(text).toBe(input);
  });

  it("preserves code fences", () => {
    const longCode = "```\n" + makeWords(200) + "\n```";
    const { text, telemetry } = normalizeParagraphs(longCode);
    expect(text).toBe(longCode);
    expect(telemetry.paragraphs_split).toBe(0);
  });

  it("leaves already-good paragraphs unchanged", () => {
    const shortPara = makeWords(50);
    const { text, telemetry } = normalizeParagraphs(shortPara);
    expect(text).toBe(shortPara);
    expect(telemetry.paragraphs_split).toBe(0);
  });

  it("handles JSON structured artifacts", () => {
    const obj = {
      executive_summary: makeSentences(3, 50),
      risks: "Short risk section.",
    };
    const input = JSON.stringify(obj);
    const { text, telemetry } = normalizeParagraphs(input);
    expect(telemetry.paragraphs_split).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(text);
    expect(parsed.risks).toBe("Short risk section.");
    // All original words preserved in executive_summary
    expect(parsed.executive_summary.split(/\s+/).length).toBe(
      obj.executive_summary.split(/\s+/).length
    );
  });

  it("gate passes after normalization on previously-failing content", () => {
    // Create content that would fail readability with a 150-word paragraph
    const longPara = makeSentences(3, 50);
    // Verify it would fail without normalization
    const preDiag = checkReadability(longPara);
    expect(preDiag.pass).toBe(false);

    // Normalize then re-check
    const { text } = normalizeParagraphs(longPara);
    const postDiag = checkReadability(text);
    expect(postDiag.pass).toBe(true);
  });

  it("preserves markdown tables", () => {
    const table = "| Col1 | Col2 |\n|------|------|\n| A    | B    |";
    const { text } = normalizeParagraphs(table);
    expect(text).toBe(table);
  });

  it("does not reduce total word count", () => {
    const input = makeSentences(5, 40); // 200 words across 5 sentences
    const originalCount = input.split(/\s+/).length;
    const { text } = normalizeParagraphs(input);
    const normalizedCount = text.split(/\s+/).length;
    expect(normalizedCount).toBe(originalCount);
  });
});
