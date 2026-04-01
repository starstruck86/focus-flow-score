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

type SourceCounts = {
  rss_count: number;
  itunes_count: number;
  total_returned: number;
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
  let cleaned = title;
  if (showTitle && cleaned.toLowerCase().startsWith(showTitle.toLowerCase())) {
    cleaned = cleaned.slice(showTitle.length).replace(/^[\s:|-]+/, '');
  }

  const patterns = [
    /\|\s*(.+)$/,
    /(?:^|\s)(?:with|w\/)\s+([A-Z][a-z]+ [A-Z][a-z]+)/,
    /(?:feat\.?|ft\.?|featuring)\s+(.+?)(?:\s*[-|]|$)/i,
    /(?:^|\s)x\s+([A-Z][a-z]+ [A-Z][a-z]+)/,
    /(?:guest|interview):\s*(.+?)(?:\s*[-|]|$)/i,
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

/** Fetch episodes from iTunes Search API to supplement RSS */
async function fetchItunesEpisodes(podcastId: string, limit: number, showTitle: string): Promise<Episode[]> {
  const episodes: Episode[] = [];
  const maxPerCall = 200;
  
  for (let offset = 0; offset < limit; offset += maxPerCall) {
    const currentLimit = Math.min(maxPerCall, limit - offset);
    const url = `https://itunes.apple.com/lookup?id=${podcastId}&entity=podcastEpisode&limit=${currentLimit}&offset=${offset}`;
    console.log(`iTunes Search API: offset=${offset}, limit=${currentLimit}`);
    
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`iTunes API returned ${res.status} at offset ${offset}`);
        break;
      }
      const data = await res.json();
      const results = data.results || [];
      
      // First result is the show itself, rest are episodes
      const episodeResults = results.filter((r: any) => r.wrapperType === 'podcastEpisode');
      
      if (episodeResults.length === 0) break;
      
      for (const ep of episodeResults) {
        episodes.push({
          title: ep.trackName || `Episode ${episodes.length + 1}`,
          url: ep.episodeUrl || ep.trackViewUrl || '',
          description: (ep.description || '').slice(0, 1000),
          duration: ep.trackTimeMillis ? String(Math.round(ep.trackTimeMillis / 1000)) : undefined,
          published: ep.releaseDate || undefined,
          episode_number: undefined,
          guest: extractGuest(ep.trackName || '', showTitle),
        });
      }
      
      // If we got fewer than requested, we've reached the end
      if (episodeResults.length < currentLimit) break;
    } catch (e) {
      console.warn(`iTunes Search API error at offset ${offset}:`, e);
      break;
    }
  }
  
  return episodes;
}

/** Deduplicate episodes by title similarity or URL match */
function deduplicateEpisodes(rssEpisodes: Episode[], itunesEpisodes: Episode[]): Episode[] {
  const seen = new Map<string, Episode>();
  
  // RSS episodes take priority (they have enclosure URLs)
  for (const ep of rssEpisodes) {
    const key = ep.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
    seen.set(key, ep);
  }
  
  // Add iTunes episodes that aren't already covered
  for (const ep of itunesEpisodes) {
    const key = ep.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
    if (!seen.has(key)) {
      seen.set(key, ep);
    }
  }
  
  return Array.from(seen.values());
}

async function fetchApplePodcastEpisodes(podcastId: string, limit: number, episodeId?: string | null): Promise<{ episodes: Episode[], show: ShowMetadata, source_counts: SourceCounts }> {
  const lookupRes = await fetch(`https://itunes.apple.com/lookup?id=${podcastId}&entity=podcast`);
  const lookupData = await lookupRes.json();
  const podcast = lookupData.results?.[0];
  if (!podcast?.feedUrl) {
    throw new Error('Could not find RSS feed for this podcast');
  }

  const trackCount = podcast.trackCount || 0;
  console.log(`Found RSS feed: ${podcast.feedUrl} — trackCount: ${trackCount}`);

  const rssRes = await fetch(podcast.feedUrl);
  if (!rssRes.ok) throw new Error(`Failed to fetch RSS feed: ${rssRes.status}`);
  const rssXml = await rssRes.text();

  const showMeta = extractShowMetadata(rssXml);
  const show: ShowMetadata = { ...showMeta, feed_url: podcast.feedUrl };

  let rssEpisodes = parseRssEpisodes(rssXml, limit, show.show_title);
  const rssCount = rssEpisodes.length;
  let itunesCount = 0;
  let episodes = rssEpisodes;

  // If RSS returned significantly fewer episodes than trackCount, supplement with iTunes Search API
  if (trackCount > 0 && rssCount < trackCount * 0.8 && rssCount < limit) {
    console.log(`RSS returned ${rssCount} of ~${trackCount} episodes — supplementing with iTunes Search API`);
    const itunesEpisodes = await fetchItunesEpisodes(podcastId, limit, show.show_title);
    itunesCount = itunesEpisodes.length;
    console.log(`iTunes returned ${itunesCount} additional episodes`);
    episodes = deduplicateEpisodes(rssEpisodes, itunesEpisodes);
  }

  // Add Apple Podcasts URLs where possible
  episodes = episodes.map((ep) => ({
    ...ep,
    url: ep.url || `https://podcasts.apple.com/podcast/id${podcastId}`,
  }));

  // If single episode import, filter by episode ID
  if (episodeId) {
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
      // Non-fatal
    }
  }

  const source_counts: SourceCounts = {
    rss_count: rssCount,
    itunes_count: itunesCount,
    total_returned: episodes.length,
  };

  return { episodes, show, source_counts };
}

async function fetchSpotifyEpisodes(showId: string, limit: number): Promise<{ episodes: Episode[], show: ShowMetadata, source_counts: SourceCounts }> {
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

  const h1 = markdown.match(/^#\s+(.+)/m);
  if (h1) show.show_title = h1[1].trim();

  return { episodes, show, source_counts: { rss_count: 0, itunes_count: 0, total_returned: episodes.length } };
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
    let source_counts: SourceCounts = { rss_count: 0, itunes_count: 0, total_returned: 0 };

    const appleId = extractApplePodcastId(url);
    const appleEpisodeId = extractAppleEpisodeId(url);
    const spotifyId = extractSpotifyShowId(url);

    if (appleId) {
      source = 'apple';
      console.log(`Fetching Apple Podcast episodes for ID: ${appleId}${appleEpisodeId ? ` (episode: ${appleEpisodeId})` : ''}`);
      const result = await fetchApplePodcastEpisodes(appleId, MAX_EPISODES, appleEpisodeId);
      episodes = result.episodes;
      show = result.show;
      source_counts = result.source_counts;
    } else if (spotifyId) {
      source = 'spotify';
      console.log(`Fetching Spotify episodes for show: ${spotifyId}`);
      const result = await fetchSpotifyEpisodes(spotifyId, MAX_EPISODES);
      episodes = result.episodes;
      show = result.show;
      source_counts = result.source_counts;
    } else {
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
          source_counts = { rss_count: episodes.length, itunes_count: 0, total_returned: episodes.length };
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

    console.log(`Found ${episodes.length} episodes from ${source} — show: "${show.show_title}" (RSS: ${source_counts.rss_count}, iTunes: ${source_counts.itunes_count})`);

    return new Response(
      JSON.stringify({ success: true, episodes, source, show, source_counts }),
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
