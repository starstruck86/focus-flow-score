const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const JUNK_PATTERNS = [
  /^#/,
  /\.(svg|png|jpg|jpeg|gif|avif|webp|ico|woff2?|ttf|eot|css|js)(\?|$)/i,
  /cdn\.prod\.website-files\.com/i,
  /fonts\.googleapis\.com/i,
  /fonts\.gstatic\.com/i,
  /(twitter|x)\.com\/(share|intent)/i,
  /facebook\.com\/sharer/i,
  /linkedin\.com\/sharing/i,
  /instagram\.com\/?$/i,
  /tiktok\.com\/?$/i,
  /mailto:/i,
  /tel:/i,
  /javascript:/i,
  /^data:/i,
  /privacy-policy|terms-of-service|cookie-policy|terms-and-conditions/i,
];

function isJunkUrl(link: string, sourceHost: string): boolean {
  if (!link || link === '#' || link === '/') return true;
  for (const p of JUNK_PATTERNS) {
    if (p.test(link)) return true;
  }
  try {
    const u = new URL(link);
    // Skip same-page anchors
    if (u.pathname === '/' && u.hash && !u.search) return true;
  } catch {
    return true;
  }
  return false;
}

type ExtractedLink = { title: string; url: string; category?: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let sourceHost = '';
    try {
      sourceHost = new URL(url.trim()).hostname;
    } catch { }

    console.log('Scraping webpage for links:', url);

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url.trim(),
        formats: ['markdown', 'links'],
        onlyMainContent: true,
        waitFor: 5000,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Firecrawl error:', data);
      return new Response(
        JSON.stringify({ success: false, error: data.error || `Firecrawl returned ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const markdown: string = data.data?.markdown || data.markdown || '';
    const rawLinks: string[] = data.data?.links || data.links || [];

    // Extract [title](url) pairs from markdown for clean titles
    const mdLinkRegex = /\[([^\]]{2,})\]\((https?:\/\/[^\s)]+)\)/g;
    const titleMap = new Map<string, string>();
    let match: RegExpExecArray | null;
    while ((match = mdLinkRegex.exec(markdown)) !== null) {
      const title = match[1].trim();
      const linkUrl = match[2].trim();
      // Keep first (best) title per URL
      if (!titleMap.has(linkUrl) && title.length > 1) {
        titleMap.set(linkUrl, title);
      }
    }

    // Extract categories from markdown headings
    const categoryMap = new Map<string, string>();
    const lines = markdown.split('\n');
    let currentCategory = '';
    for (const line of lines) {
      const headingMatch = line.match(/^#{1,3}\s+(.+)/);
      if (headingMatch) {
        currentCategory = headingMatch[1].replace(/[*_]/g, '').trim();
        continue;
      }
      // Find links in this line and assign current category
      const lineLinks = [...line.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)];
      for (const lm of lineLinks) {
        if (currentCategory && !categoryMap.has(lm[1])) {
          categoryMap.set(lm[1], currentCategory);
        }
      }
    }

    // Deduplicate and filter
    const seen = new Set<string>();
    const links: ExtractedLink[] = [];

    // Process markdown links first (they have titles)
    for (const [linkUrl, title] of titleMap.entries()) {
      if (isJunkUrl(linkUrl, sourceHost)) continue;
      try {
        const normalized = new URL(linkUrl).href.replace(/\/+$/, '');
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        links.push({
          title,
          url: linkUrl,
          category: categoryMap.get(linkUrl) || undefined,
        });
      } catch {
        continue;
      }
    }

    // Add any remaining links from the links array that weren't in markdown
    for (const link of rawLinks) {
      if (isJunkUrl(link, sourceHost)) continue;
      try {
        const normalized = new URL(link).href.replace(/\/+$/, '');
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        // Try to derive a title from URL path
        const u = new URL(link);
        const pathTitle = u.pathname
          .split('/')
          .filter(Boolean)
          .pop()
          ?.replace(/[-_]/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase()) || link;
        links.push({
          title: pathTitle,
          url: link,
          category: categoryMap.get(link) || undefined,
        });
      } catch {
        continue;
      }
    }

    console.log(`Extracted ${links.length} unique links from ${url}`);

    return new Response(
      JSON.stringify({ success: true, links }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
