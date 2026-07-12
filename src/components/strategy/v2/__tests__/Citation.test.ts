import { describe, expect, it } from 'vitest';
import { parseCitationSources } from '../Citation';

describe('parseCitationSources', () => {
  it('includes competitive intelligence and industry POV provenance', () => {
    const sources = parseCitationSources({
      version: 1,
      competitive_intel: [{ id: 'ci-1', title: 'Adjust' }],
      vertical_briefs: [{ id: 'vb-1', title: 'Retail POV' }],
    });

    expect(sources).toEqual([
      { id: 'ci-1', title: 'Adjust', kind: 'competitive_intel' },
      { id: 'vb-1', title: 'Retail POV', kind: 'vertical_brief' },
    ]);
  });

  it('rejects malformed rows and deduplicates by source kind and id', () => {
    const sources = parseCitationSources({
      competitive_intel: [
        { id: 'ci-1', title: 'Adjust' },
        { id: 'ci-1', title: 'Duplicate' },
        { id: '', title: 'Missing id' },
      ],
      vertical_briefs: [{ id: 'ci-1', title: 'Retail POV' }],
    });

    expect(sources).toHaveLength(2);
    expect(sources.map((source) => source.kind)).toEqual([
      'competitive_intel',
      'vertical_brief',
    ]);
  });
});
