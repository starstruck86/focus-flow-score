const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id',
};

type Episode = {
  title: string;
  url: string;
  description?: string;
  duration?: string;
  published?: string;
  episode_number?: string;
  guest?: string | null;
};

type ShowMetadata = {
  show_title: string;
  show_author: string;
  show_description: string;
  show_image: string;
  feed_url: string;
};

/** Extract Apple Podcasts ID from URL */
function extractApplePodcastId(url: string): string | null {
  const match = url.match(/\/id(\d+)/);
  return match ? match[1] : null;
}

/** Extract episode ID from Apple Podcasts URL (?i=XXXXXXX) */
function extractAppleEpisodeId(url: string): string | null {
  const match = url.match(/[?&]i=(\d+)/);
  return match ? match[1] : null;
}

/** Extract Spotify show ID from URL */
function extractSpotifyShowId(url: string): string | null {
  const match = url.match(/open\.spotify\.com\/show\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/** Try to extract guest name from episode title */
function extractGuest(title: string, showTitle: string): string | null {
  // Remove show name prefix if present
  let cleaned = title;
  if (showTitle && cleaned.toLowerCase().startsWith(showTitle.toLowerCase())) {
    cleaned = cleaned.slice(showTitle.length).replace(/^[\s:|-]+/, '');
  }

  // Common patterns: "Show | Guest Name", "X with Guest Name", "X feat. Guest", "X ft. Guest", "X featuring Guest"
  const patterns = [
    /\|\s*(.+)$/,                           // "Title | Guest Name"
    /(?:^|\s)(?:with|w\/)\s+([A-Z][a-z]+ [A-Z][a-z]+)/,  // "with First Last"
    /(?:feat\.?|ft\.?|featuring)\s+(.+?)(?:\s*[-|]|$)/i,    // "feat. Guest"
    /(?:^|\s)x\s+([A-Z][a-z]+ [A-Z][a-z]+)/,               // "Show x Guest Name"
    /(?:guest|interview):\s*(.+?)(?:\s*[-|]|$)/i,            // "Guest: Name"
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) {
      const guest = match[1].trim();
      if (guest.length > 3 && guest.length < 100) return guest;
    }
  }
  return null;
}

/** Extract show-level metadata from RSS channel */
function extractShowMetadata(xml: string): Omit<ShowMetadata, 'feed_url'> {
  // Get channel-level content (before first <item>)
  const channelEnd = xml.indexOf('<item');
  const channelXml = channelEnd > 0 ? xml.slice(0, channelEnd) : xml.slice(0, 5000);

  const titleMatch = channelXml.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
  const authorMatch = channelXml.match(/<itunes:author>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/itunes:author>/);
  const descMatch = channelXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
  const imageMatch = channelXml.match(/<itunes:image\s+href="([^"]+)"/);

  return {
    show_title: titleMatch?.[1]?.trim() || 'Unknown Podcast',
    show_author: authorMatch?.[1]?.trim() || '',
    show_description: (descMatch?.[1]?.trim() || '').slice(0, 2000),
    show_image: imageMatch?.[1] || '',
  };
}

/** Parse RSS XML to extract episodes with full metadata */
function parseRssEpisodes(xml: string, limit: number, showTitle: string): Episode[] {
  const episodes: Episode[] = [];
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(xml)) !== null && episodes.length < limit) {
    const item = itemMatch[1];
    const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
    const enclosureMatch = item.match(/<enclosure[^>]+url="([^"]+)"/);
    const linkMatch = item.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/);
    const descMatch = item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
    const durationMatch = item.match(/<itunes:duration>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/itunes:duration>/);
    const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
    const episodeNumMatch = item.match(/<itunes:episode>(\d+)<\/itunes:episode>/);

    const title = titleMatch?.[1]?.trim() || `Episode ${episodes.length + 1}`;
    const url = enclosureMatch?.[1] || linkMatch?.[1]?.trim() || '';
    const description = descMatch?.[1]?.trim().replace(/<[^>]+>/g, '').slice(0, 1000) || '';
    const guest = extractGuest(title, showTitle);

    episodes.push({
      title,
      url,
      description,
      duration: durationMatch?.[1]?.trim() || undefined,
      published: pubDateMatch?.[1]?.trim() || undefined,
      episode_number: episodeNumMatch?.[1] || undefined,
      guest,
    });
  }
  return episodes;
}

async function fetchApplePodcastEpisodes(podcastId: string, limit: number, episodeId?: string | null): Promise<{ episodes: Episode[], show: ShowMetadata }> {
  const lookupRes = await fetch(`https://itunes.apple.com/lookup?id=${podcastId}&entity=podcast`);
  const lookupData = await lookupRes.json();
  const podcast = lookupData.results?.[0];
  if (!podcast?.feedUrl) {
    throw new Error('Could not find RSS feed for this podcast');
  }

  console.log(`Found RSS feed: ${podcast.feedUrl}`);

  const rssRes = await fetch(podcast.feedUrl);
  if (!rssRes.ok) throw new Error(`Failed to fetch RSS feed: ${rssRes.status}`);
  const rssXml = await rssRes.text();

  const showMeta = extractShowMetadata(rssXml);
  const show: ShowMetadata = { ...showMeta, feed_url: podcast.feedUrl };

  let episodes = parseRssEpisodes(rssXml, limit, show.show_title);

  // Add Apple Podcasts URLs where possible
  episodes = episodes.map((ep) => ({
    ...ep,
    url: ep.url || `https://podcasts.apple.com/podcast/id${podcastId}`,
  }));

  // If single episode import, filter by episode ID
  if (episodeId) {
    // Try iTunes episode lookup for title match
    try {
      const epLookup = await fetch(`https://itunes.apple.com/lookup?id=${episodeId}&entity=podcastEpisode`);
      const epData = await epLookup.json();
      const epResult = epData.results?.find((r: any) => r.wrapperType === 'podcastEpisode');
      if (epResult?.trackName) {
        const epTitle = epResult.trackName.toLowerCase();
        const matched = episodes.filter(e => e.title.toLowerCase().includes(epTitle) || epTitle.includes(e.title.toLowerCase()));
        if (matched.length > 0) {
          episodes = matched;
        }
      }
    } catch {
      // Non-fatal: just return all episodes
    }
  }

  return { episodes, show };
}

async function fetchSpotifyEpisodes(showId: string, limit: number): Promise<{ episodes: Episode[], show: ShowMetadata }> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!apiKey) throw new Error('Firecrawl not configured — needed for Spotify import');

  console.log(`Scraping Spotify show page: ${showId}`);

  const showUrl = `https://open.spotify.com/show/${showId}`;
  const scrollActions = [];
  for (let i = 0; i < 40; i++) {
    scrollActions.push({ type: 'scroll', direction: 'down', amount: 5000 });
    if (i % 5 === 4) scrollActions.push({ type: 'wait', milliseconds: 2000 });
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

  const episodes: Episode[] = episodeUrls.map((epUrl, i) => ({
    title: `Episode ${i + 1}`,
    url: epUrl,
  }));

  // Try to match titles from markdown
  const lines = markdown.split('\n');
  let epIdx = 0;
  for (let i = 0; i < lines.length && epIdx < episodes.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('http') && !line.startsWith('[') && line.length > 3 && line.length < 200) {
      const nearby = lines.slice(i, i + 5).join(' ');
      if (nearby.includes('open.spotify.com/episode/')) {
        const cleanTitle = line.replace(/^[#*]+\s*/, '').trim();
        episodes[epIdx].title = cleanTitle;
        episodes[epIdx].guest = extractGuest(cleanTitle, '');
        epIdx++;
      }
    }
  }

  const show: ShowMetadata = {
    show_title: 'Spotify Podcast',
    show_author: '',
    show_description: '',
    show_image: '',
    feed_url: showUrl,
  };

  // Try to get show title from markdown
  const h1 = markdown.match(/^#\s+(.+)/m);
  if (h1) show.show_title = h1[1].trim();

  return { episodes, show };
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
    let show: ShowMetadata = { show_title: '', show_author: '', show_description: '', show_image: '', feed_url: '' };
    let source = '';

    const appleId = extractApplePodcastId(url);
    const appleEpisodeId = extractAppleEpisodeId(url);
    const spotifyId = extractSpotifyShowId(url);

    if (appleId) {
      source = 'apple';
      console.log(`Fetching Apple Podcast episodes for ID: ${appleId}${appleEpisodeId ? ` (episode: ${appleEpisodeId})` : ''}`);
      const result = await fetchApplePodcastEpisodes(appleId, MAX_EPISODES, appleEpisodeId);
      episodes = result.episodes;
      show = result.show;
    } else if (spotifyId) {
      source = 'spotify';
      console.log(`Fetching Spotify episodes for show: ${spotifyId}`);
      const result = await fetchSpotifyEpisodes(spotifyId, MAX_EPISODES);
      episodes = result.episodes;
      show = result.show;
    } else {
      // Try treating as direct RSS feed
      console.log('Trying as direct RSS feed URL:', url);
      try {
        const rssRes = await fetch(url.trim());
        if (!rssRes.ok) throw new Error(`HTTP ${rssRes.status}`);
        const rssXml = await rssRes.text();
        if (rssXml.includes('<rss') || rssXml.includes('<feed')) {
          source = 'rss';
          const showMeta = extractShowMetadata(rssXml);
          show = { ...showMeta, feed_url: url.trim() };
          episodes = parseRssEpisodes(rssXml, MAX_EPISODES, show.show_title);
        } else {
          throw new Error('Not a recognized podcast URL.');
        }
      } catch (e) {
        return new Response(
          JSON.stringify({ success: false, error: 'Not a recognized podcast URL. Supports: Apple Podcasts, Spotify, or direct RSS feed URLs.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`Found ${episodes.length} episodes from ${source} — show: "${show.show_title}"`);

    return new Response(
      JSON.stringify({ success: true, episodes, source, show }),
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
