const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function fetchTitle(videoUrl: string): Promise<string> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`);
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

    console.log('Scraping YouTube playlist:', url);

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url.trim(),
        formats: ['links'],
        waitFor: 3000,
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
    }

    console.log(`Found ${videoUrls.length} video URLs, fetching titles via oEmbed...`);

    // Fetch titles in parallel batches of 5
    const videos: { title: string; url: string }[] = [];
    for (let i = 0; i < videoUrls.length; i += 5) {
      const batch = videoUrls.slice(i, i + 5);
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
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
