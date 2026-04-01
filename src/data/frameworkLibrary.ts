/**
 * Framework + Author attribution library for Knowledge Items.
 */

export interface FrameworkEntry {
  who: string;
  framework: string;
  aliases: string[];  // keywords to match in content
}

export const FRAMEWORK_LIBRARY: FrameworkEntry[] = [
  {
    who: 'Keenan',
    framework: 'GAP Selling',
    aliases: ['gap selling', 'keenan', 'current state', 'future state', 'gap', 'problem identification'],
  },
  {
    who: 'Matthew Dixon',
    framework: 'Challenger Sale',
    aliases: ['challenger', 'challenger sale', 'matthew dixon', 'teach tailor take control', 'commercial teaching', 'constructive tension'],
  },
  {
    who: 'John McMahon',
    framework: 'MEDDICC',
    aliases: ['meddicc', 'meddic', 'meddpicc', 'john mcmahon', 'metrics economic buyer decision criteria decision process identify pain champion competition'],
  },
  {
    who: 'Force Management',
    framework: 'Command of the Message',
    aliases: ['command of the message', 'force management', 'value framework', 'positive business outcomes', 'required capabilities', 'com framework'],
  },
  {
    who: 'Nick Cegelski / Armand Farrokh',
    framework: '30 Minutes to President\'s Club',
    aliases: ['30mpc', '30 minutes to president', 'nick cegelski', 'armand farrokh', 'cold call opener', 'permission-based opener'],
  },
  {
    who: 'Jeb Blount',
    framework: 'Fanatical Prospecting',
    aliases: ['fanatical prospecting', 'jeb blount', 'golden hours', 'prospecting pyramid'],
  },
  {
    who: 'Mike Weinberg',
    framework: 'New Sales Simplified',
    aliases: ['new sales simplified', 'mike weinberg', 'sales story', 'target account'],
  },
  {
    who: 'Chris Voss',
    framework: 'Never Split the Difference',
    aliases: ['chris voss', 'never split the difference', 'tactical empathy', 'mirroring', 'labeling', 'calibrated questions', 'accusation audit'],
  },
  {
    who: 'Neil Rackham',
    framework: 'SPIN Selling',
    aliases: ['spin selling', 'neil rackham', 'situation problem implication need-payoff'],
  },
  {
    who: 'David Sandler',
    framework: 'Sandler Selling System',
    aliases: ['sandler', 'david sandler', 'pain funnel', 'up-front contract', 'negative reverse'],
  },
];

/**
 * Auto-detect framework attribution from text content.
 * Returns the best matching framework entry or null.
 */
export function detectFramework(text: string): FrameworkEntry | null {
  const lower = text.toLowerCase();
  let bestMatch: FrameworkEntry | null = null;
  let bestScore = 0;

  for (const entry of FRAMEWORK_LIBRARY) {
    let score = 0;
    for (const alias of entry.aliases) {
      if (lower.includes(alias)) {
        score += alias.length; // longer matches score higher
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  return bestScore >= 4 ? bestMatch : null;
}

/** Get unique list of all framework names */
export function getAllFrameworks(): string[] {
  return [...new Set(FRAMEWORK_LIBRARY.map(f => f.framework))];
}

/** Get unique list of all who values */
export function getAllAuthors(): string[] {
  return [...new Set(FRAMEWORK_LIBRARY.map(f => f.who))];
}
