export interface SkillSection {
  title: string;
  content: string;
}

/**
 * Parse ## Section headers from a skill response.
 * Returns sections in order; ignores empty sections.
 * If no headers found, returns a single section with all content.
 */
export function parseSkillSections(text: string): SkillSection[] {
  if (!text?.trim()) return [];

  const lines = text.split('\n');
  const sections: SkillSection[] = [];
  let currentTitle = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) {
      const prevContent = currentContent.join('\n').trim();
      if (prevContent) {
        sections.push({ title: currentTitle, content: prevContent });
      }
      currentTitle = line.replace(/^#{1,3}\s+/, '').trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  const lastContent = currentContent.join('\n').trim();
  if (lastContent) {
    sections.push({ title: currentTitle, content: lastContent });
  }

  if (sections.length === 0 || (sections.length === 1 && !sections[0].title)) {
    return [{ title: '', content: text.trim() }];
  }

  return sections.filter((s) => s.content.trim().length > 0);
}
