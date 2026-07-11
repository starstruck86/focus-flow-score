import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { Citation, parseCitationSources } from '../Citation';

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

  it('preserves validated web URL and publication date metadata', () => {
    const sources = parseCitationSources({
      version: 3,
      web_sources: [{
        id: 'https://example.com/news',
        title: 'Acme earnings update',
        url: 'https://example.com/news',
        published_at: '2026-07-10',
      }],
    });

    expect(sources).toEqual([{
      id: 'https://example.com/news',
      title: 'Acme earnings update',
      url: 'https://example.com/news',
      published_at: '2026-07-10',
      kind: 'web_source',
    }]);
  });

  it('rejects unsafe or undated web sources', () => {
    const sources = parseCitationSources({
      web_sources: [
        {
          id: 'bad-1',
          title: 'Unsafe',
          url: 'javascript:alert(1)',
          published_at: '2026-07-10',
        },
        {
          id: 'bad-2',
          title: 'Undated',
          url: 'https://example.com/undated',
        },
      ],
    });

    expect(sources).toEqual([]);
  });

  it('renders a dated web badge as a safe external link', () => {
    const { container } = render(createElement(Citation, {
      citations: {
        version: 3,
        web_sources: [{
          id: 'https://example.com/news',
          title: 'Acme earnings update',
          url: 'https://example.com/news',
          published_at: '2026-07-10',
        }],
      },
    }));

    const link = container.querySelector('a[data-source-kind="web_source"]');
    expect(link?.getAttribute('href')).toBe('https://example.com/news');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(link?.textContent).toContain('Acme earnings update');
    expect(link?.textContent).toContain('2026-07-10');
  });
});
