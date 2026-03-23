const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function fetchTitle(videoUrl: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) return '';
    const data = await res.json();
    return data.title || '';
  } catch {
    return '';
  }
}

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

    console.log('Scraping YouTube playlist with scroll actions:', url);

    // Build scroll actions to load up to ~1000 videos
    // Each scroll loads ~20-30 videos; 40 scrolls should cover ~1000
    const scrollActions = [];
    for (let i = 0; i < 40; i++) {
      scrollActions.push({ type: 'scroll', direction: 'down', amount: 5000 });
      // Small wait between scrolls for content to load
      if (i % 5 === 4) {
        scrollActions.push({ type: 'wait', milliseconds: 2000 });
      }
    }

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url.trim(),
        formats: ['links'],
        actions: scrollActions,
        waitFor: 3000,
        timeout: 120000,
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

    const allLinks: string[] = data.data?.links || data.links || [];
    const videoUrlPattern = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/;
    const seen = new Set<string>();
    const videoUrls: string[] = [];

    for (const link of allLinks) {
      const match = link.match(videoUrlPattern);
      if (!match) continue;
      const videoId = match[1];
      if (seen.has(videoId)) continue;
      seen.add(videoId);
      videoUrls.push(`https://www.youtube.com/watch?v=${videoId}`);
      if (videoUrls.length >= 1000) break;
    }

    console.log(`Found ${videoUrls.length} video URLs, fetching titles via oEmbed...`);

    // Fetch titles in parallel batches of 30
    const videos: { title: string; url: string }[] = [];
    const BATCH_SIZE = 30;
    for (let i = 0; i < videoUrls.length; i += BATCH_SIZE) {
      const batch = videoUrls.slice(i, i + BATCH_SIZE);
      const titles = await Promise.all(batch.map(fetchTitle));
      batch.forEach((vUrl, j) => {
        videos.push({
          title: titles[j] || `Video ${i + j + 1}`,
          url: vUrl,
        });
      });
    }

    console.log(`Resolved titles for ${videos.length} videos`);

    return new Response(
      JSON.stringify({ success: true, videos }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'An unexpected error occurred. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
