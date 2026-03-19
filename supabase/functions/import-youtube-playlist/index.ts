const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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
        formats: ['markdown', 'links'],
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

    // Extract links from response
    const allLinks: string[] = data.data?.links || data.links || [];
    const markdown: string = data.data?.markdown || data.markdown || '';

    // Filter to YouTube video URLs only
    const videoUrlPattern = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/;
    const seen = new Set<string>();
    const videos: { title: string; url: string }[] = [];

    for (const link of allLinks) {
      const match = link.match(videoUrlPattern);
      if (!match) continue;
      const videoId = match[1];
      if (seen.has(videoId)) continue;
      seen.add(videoId);
      videos.push({
        title: '',
        url: link.includes('youtu.be/') ? `https://www.youtube.com/watch?v=${videoId}` : link.split('&')[0],
      });
    }

    // Try to extract titles from markdown
    // YouTube playlist pages typically show titles as links: [Video Title](url)
    const mdLinkPattern = /\[([^\]]+)\]\((https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})[^)]*)\)/g;
    let mdMatch;
    while ((mdMatch = mdLinkPattern.exec(markdown)) !== null) {
      const title = mdMatch[1].trim();
      const videoId = mdMatch[3];
      const existing = videos.find(v => v.url.includes(videoId));
      if (existing && !existing.title && title.length > 2) {
        existing.title = title;
      } else if (!seen.has(videoId)) {
        seen.add(videoId);
        videos.push({
          title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
        });
      }
    }

    // Also try to extract titles from markdown lines like "1. Title" or "- Title" near video links
    const lines = markdown.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const linkMatch = line.match(videoUrlPattern);
      if (!linkMatch) continue;
      const videoId = linkMatch[1];
      const video = videos.find(v => v.url.includes(videoId));
      if (video && !video.title) {
        // Try to get title from the line itself, stripping markdown
        const cleaned = line
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(/^[\d\.\-\*\s]+/, '')
          .replace(/https?:\/\/\S+/g, '')
          .trim();
        if (cleaned.length > 2) {
          video.title = cleaned;
        }
      }
    }

    // Fallback: assign generic titles for any without
    videos.forEach((v, i) => {
      if (!v.title) v.title = `Video ${i + 1}`;
    });

    console.log(`Found ${videos.length} videos`);

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
