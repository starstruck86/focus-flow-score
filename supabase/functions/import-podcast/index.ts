const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id',
};

type Episode = { title: string; url: string };

/** Extract Apple Podcasts ID from URL */
function extractApplePodcastId(url: string): string | null {
  // https://podcasts.apple.com/us/podcast/some-name/id1234567890
  const match = url.match(/\/id(\d+)/);
  return match ? match[1] : null;
}

/** Extract Spotify show ID from URL */
function extractSpotifyShowId(url: string): string | null {
  // https://open.spotify.com/show/ABC123...
  const match = url.match(/open\.spotify\.com\/show\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/** Parse RSS XML to extract episodes */
function parseRssEpisodes(xml: string, limit: number): Episode[] {
  const episodes: Episode[] = [];
  // Match <item> blocks
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(xml)) !== null && episodes.length < limit) {
    const item = itemMatch[1];
    const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
    // Try enclosure URL first (audio file), then link
    const enclosureMatch = item.match(/<enclosure[^>]+url="([^"]+)"/);
    const linkMatch = item.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/);
    const title = titleMatch?.[1]?.trim() || `Episode ${episodes.length + 1}`;
    const url = enclosureMatch?.[1] || linkMatch?.[1]?.trim() || '';
    if (title) {
      episodes.push({ title, url });
    }
  }
  return episodes;
}

async function fetchApplePodcastEpisodes(podcastId: string, limit: number): Promise<Episode[]> {
  // Step 1: Get podcast info + RSS feed URL from iTunes API
  const lookupRes = await fetch(
    `https://itunes.apple.com/lookup?id=${podcastId}&entity=podcast`
  );
  const lookupData = await lookupRes.json();
  const podcast = lookupData.results?.[0];
  if (!podcast?.feedUrl) {
    throw new Error('Could not find RSS feed for this podcast');
  }

  console.log(`Found RSS feed: ${podcast.feedUrl}`);

  // Step 2: Fetch and parse the RSS feed for all episodes
  const rssRes = await fetch(podcast.feedUrl);
  if (!rssRes.ok) throw new Error(`Failed to fetch RSS feed: ${rssRes.status}`);
  const rssXml = await rssRes.text();

  const episodes = parseRssEpisodes(rssXml, limit);

  // Add Apple Podcasts URLs where possible
  return episodes.map((ep) => ({
    title: ep.title,
    url: ep.url || `https://podcasts.apple.com/podcast/id${podcastId}`,
  }));
}

async function fetchSpotifyEpisodes(showId: string, limit: number): Promise<Episode[]> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!apiKey) throw new Error('Firecrawl not configured — needed for Spotify import');

  console.log(`Scraping Spotify show page with scroll actions: ${showId}`);

  const showUrl = `https://open.spotify.com/show/${showId}`;

  // Build scroll actions to load episodes
  const scrollActions = [];
  for (let i = 0; i < 40; i++) {
    scrollActions.push({ type: 'scroll', direction: 'down', amount: 5000 });
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
      url: showUrl,
      formats: ['links', 'markdown'],
      actions: scrollActions,
      waitFor: 3000,
      timeout: 120000,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Firecrawl returned ${response.status}`);

  const allLinks: string[] = data.data?.links || data.links || [];
  const markdown: string = data.data?.markdown || data.markdown || '';

  // Extract episode URLs
  const episodePattern = /open\.spotify\.com\/episode\/([a-zA-Z0-9]+)/;
  const seen = new Set<string>();
  const episodeUrls: string[] = [];

  for (const link of allLinks) {
    const match = link.match(episodePattern);
    if (!match) continue;
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    episodeUrls.push(`https://open.spotify.com/episode/${match[1]}`);
    if (episodeUrls.length >= limit) break;
  }

  // Try to extract titles from markdown content
  // Spotify pages typically show episode titles in the markdown
  const episodes: Episode[] = episodeUrls.map((epUrl, i) => ({
    title: `Episode ${i + 1}`,
    url: epUrl,
  }));

  // Try to match titles from markdown lines near episode links
  const lines = markdown.split('\n');
  let epIdx = 0;
  for (let i = 0; i < lines.length && epIdx < episodes.length; i++) {
    const line = lines[i].trim();
    // Episode titles in Spotify markdown are typically headings or bold text before episode links
    if (line && !line.startsWith('http') && !line.startsWith('[') && line.length > 3 && line.length < 200) {
      // Check if next few lines contain an episode URL
      const nearby = lines.slice(i, i + 5).join(' ');
      if (nearby.includes('open.spotify.com/episode/')) {
        episodes[epIdx].title = line.replace(/^[#*]+\s*/, '').trim();
        epIdx++;
      }
    }
  }

  return episodes;
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

    const MAX_EPISODES = 1000;
    let episodes: Episode[] = [];
    let source = '';

    const appleId = extractApplePodcastId(url);
    const spotifyId = extractSpotifyShowId(url);

    if (appleId) {
      source = 'apple';
      console.log(`Fetching Apple Podcast episodes for ID: ${appleId}`);
      episodes = await fetchApplePodcastEpisodes(appleId, MAX_EPISODES);
    } else if (spotifyId) {
      source = 'spotify';
      console.log(`Fetching Spotify episodes for show: ${spotifyId}`);
      episodes = await fetchSpotifyEpisodes(spotifyId, MAX_EPISODES);
    } else {
      // Try treating it as an RSS feed URL directly
      console.log('Trying as direct RSS feed URL:', url);
      try {
        const rssRes = await fetch(url.trim());
        if (!rssRes.ok) throw new Error(`HTTP ${rssRes.status}`);
        const rssXml = await rssRes.text();
        if (rssXml.includes('<rss') || rssXml.includes('<feed')) {
          source = 'rss';
          episodes = parseRssEpisodes(rssXml, MAX_EPISODES);
        } else {
          throw new Error('Not a recognized podcast URL. Supports: Apple Podcasts, Spotify, or direct RSS feed URLs.');
        }
      } catch (e) {
        return new Response(
          JSON.stringify({ success: false, error: 'Not a recognized podcast URL. Supports: Apple Podcasts, Spotify, or direct RSS feed URLs.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`Found ${episodes.length} episodes from ${source}`);

    return new Response(
      JSON.stringify({ success: true, episodes, source }),
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
