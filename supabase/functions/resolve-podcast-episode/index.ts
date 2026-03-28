/**
 * resolve-podcast-episode — Edge function
 * 
 * Resolves Spotify episodes, Apple Podcast episodes, and generic podcast pages
 * into structured metadata + audio enclosure URLs when possible.
 * 
 * Does NOT transcribe — just resolves the source so the client orchestrator
 * can route to transcribe-audio or manual assist.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface ResolveResult {
  success: boolean;
  subtype: string;
  metadata: {
    title: string | null;
    showName: string | null;
    description: string | null;
    durationMs: number | null;
    artworkUrl: string | null;
    episodeUrl: string | null;
    publishDate: string | null;
  };
  resolution: {
    rssFeedUrl: string | null;
    audioEnclosureUrl: string | null;
    transcriptSourceUrl: string | null;
    canonicalPageUrl: string | null;
  };
  finalStatus: string; // 'audio_resolved' | 'metadata_only' | 'needs_manual_assist' | 'failed'
  failureCode: string | null;
  failureReason: string | null;
  resolverStages: Array<{ stage: string; status: string; detail?: string }>;
}

// ── Spotify ────────────────────────────────────────────────

function extractSpotifyEpisodeId(url: string): string | null {
  const m = url.match(/open\.spotify\.com\/episode\/([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

async function resolveSpotifyEpisode(url: string, episodeId: string): Promise<ResolveResult> {
  const stages: ResolveResult['resolverStages'] = [];
  const metadata: ResolveResult['metadata'] = {
    title: null, showName: null, description: null,
    durationMs: null, artworkUrl: null, episodeUrl: url, publishDate: null,
  };
  const resolution: ResolveResult['resolution'] = {
    rssFeedUrl: null, audioEnclosureUrl: null,
    transcriptSourceUrl: null, canonicalPageUrl: null,
  };

  // Stage 1: oEmbed metadata
  stages.push({ stage: 'resolving_platform_metadata', status: 'running' });
  try {
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const resp = await fetch(oembedUrl);
    if (resp.ok) {
      const data = await resp.json();
      metadata.title = data.title || null;
      metadata.artworkUrl = data.thumbnail_url || null;
      // oEmbed title is usually "episode - show" format
      if (data.title && data.title.includes(' - ')) {
        const parts = data.title.split(' - ');
        metadata.showName = parts[parts.length - 1]?.trim() || null;
      }
      stages[stages.length - 1] = { stage: 'resolving_platform_metadata', status: 'done', detail: `Title: ${metadata.title}` };
    } else {
      stages[stages.length - 1] = { stage: 'resolving_platform_metadata', status: 'failed', detail: `oEmbed ${resp.status}` };
    }
  } catch (e) {
    stages[stages.length - 1] = { stage: 'resolving_platform_metadata', status: 'failed', detail: String(e) };
  }

  // Stage 2: Try Firecrawl for page scraping (gets description, show notes)
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (firecrawlKey) {
    stages.push({ stage: 'resolving_canonical_episode_page', status: 'running' });
    try {
      const scrapeResp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          waitFor: 3000,
          timeout: 30000,
        }),
      });
      if (scrapeResp.ok) {
        const scrapeData = await scrapeResp.json();
        const markdown: string = scrapeData.data?.markdown || '';
        if (markdown.length > 100) {
          // Extract description from markdown (first substantial paragraph)
          const paragraphs = markdown.split('\n\n').filter((p: string) => p.trim().length > 50);
          if (paragraphs.length > 0) {
            metadata.description = paragraphs.slice(0, 3).join('\n\n').substring(0, 2000);
          }
          // Try to extract show name if not already found
          if (!metadata.showName) {
            const showMatch = markdown.match(/(?:Show|Podcast)[:\s]+([^\n]+)/i);
            if (showMatch) metadata.showName = showMatch[1].trim();
          }
        }
        stages[stages.length - 1] = { stage: 'resolving_canonical_episode_page', status: 'done', detail: `${markdown.length} chars scraped` };
      } else {
        stages[stages.length - 1] = { stage: 'resolving_canonical_episode_page', status: 'failed', detail: `Firecrawl ${scrapeResp.status}` };
      }
    } catch (e) {
      stages[stages.length - 1] = { stage: 'resolving_canonical_episode_page', status: 'failed', detail: String(e) };
    }
  }

  // Stage 3: Search for transcript source (using episode title)
  if (metadata.title) {
    stages.push({ stage: 'searching_transcript_source', status: 'running' });
    // We can't easily search for transcripts without a search API
    // Mark as attempted but not found
    stages[stages.length - 1] = { stage: 'searching_transcript_source', status: 'done', detail: 'No external transcript source detected' };
  }

  // Spotify episodes never have direct audio URLs accessible
  const hasUsableMetadata = !!(metadata.title || metadata.description);
  
  return {
    success: true,
    subtype: 'spotify_episode',
    metadata,
    resolution,
    finalStatus: hasUsableMetadata ? 'metadata_only' : 'needs_manual_assist',
    failureCode: 'SPOTIFY_NO_DIRECT_AUDIO',
    failureReason: hasUsableMetadata
      ? 'Spotify metadata captured; no direct audio/transcript source found. Paste transcript or provide alternate URL.'
      : 'Could not extract Spotify metadata. Paste transcript or notes manually.',
    resolverStages: stages,
  };
}

// ── Apple Podcasts ─────────────────────────────────────────

function extractApplePodcastIds(url: string): { showId: string | null; episodeId: string | null } {
  const showMatch = url.match(/\/id(\d+)/);
  const episodeMatch = url.match(/[?&]i=(\d+)/);
  return {
    showId: showMatch ? showMatch[1] : null,
    episodeId: episodeMatch ? episodeMatch[1] : null,
  };
}

async function resolveApplePodcastEpisode(url: string, showId: string, episodeId: string | null): Promise<ResolveResult> {
  const stages: ResolveResult['resolverStages'] = [];
  const metadata: ResolveResult['metadata'] = {
    title: null, showName: null, description: null,
    durationMs: null, artworkUrl: null, episodeUrl: url, publishDate: null,
  };
  const resolution: ResolveResult['resolution'] = {
    rssFeedUrl: null, audioEnclosureUrl: null,
    transcriptSourceUrl: null, canonicalPageUrl: url,
  };

  // Stage 1: iTunes Lookup API for show info + RSS feed URL
  stages.push({ stage: 'resolving_platform_metadata', status: 'running' });
  let feedUrl: string | null = null;
  try {
    const lookupUrl = episodeId
      ? `https://itunes.apple.com/lookup?id=${showId}&entity=podcast`
      : `https://itunes.apple.com/lookup?id=${showId}`;
    const resp = await fetch(lookupUrl);
    if (resp.ok) {
      const data = await resp.json();
      const podcast = data.results?.[0];
      if (podcast) {
        metadata.showName = podcast.collectionName || podcast.trackName || null;
        metadata.artworkUrl = podcast.artworkUrl600 || podcast.artworkUrl100 || null;
        feedUrl = podcast.feedUrl || null;
        resolution.rssFeedUrl = feedUrl;
      }
      stages[stages.length - 1] = {
        stage: 'resolving_platform_metadata', status: 'done',
        detail: `Show: ${metadata.showName || 'unknown'}, Feed: ${feedUrl ? 'found' : 'not found'}`,
      };
    } else {
      stages[stages.length - 1] = { stage: 'resolving_platform_metadata', status: 'failed', detail: `iTunes API ${resp.status}` };
    }
  } catch (e) {
    stages[stages.length - 1] = { stage: 'resolving_platform_metadata', status: 'failed', detail: String(e) };
  }

  // Stage 2: Resolve RSS feed
  if (feedUrl) {
    stages.push({ stage: 'resolving_rss_feed', status: 'running' });
    try {
      const rssResp = await fetch(feedUrl);
      if (rssResp.ok) {
        const rssXml = await rssResp.text();
        stages[stages.length - 1] = { stage: 'resolving_rss_feed', status: 'done', detail: `${rssXml.length} chars` };

        // Stage 3: Find the episode enclosure
        stages.push({ stage: 'resolving_audio_enclosure', status: 'running' });
        
        // Parse items to find matching episode
        const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
        let itemMatch;
        let bestMatch: { title: string; enclosureUrl: string; description: string; pubDate: string } | null = null;
        let itemIndex = 0;

        while ((itemMatch = itemRegex.exec(rssXml)) !== null) {
          const item = itemMatch[1];
          const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
          const enclosureMatch = item.match(/<enclosure[^>]+url="([^"]+)"/);
          const descMatch = item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
          const dateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
          const itunesEpMatch = item.match(/<itunes:episode>(\d+)<\/itunes:episode>/);
          
          const itemTitle = titleMatch?.[1]?.trim() || '';
          const encUrl = enclosureMatch?.[1] || '';
          const desc = descMatch?.[1]?.trim()?.substring(0, 1000) || '';
          const pubDate = dateMatch?.[1]?.trim() || '';

          // If we have an episode ID from Apple, try to match by position or title
          // Apple episode IDs don't directly map to RSS, so we try the first episode
          // or use title matching if possible
          if (!bestMatch && encUrl) {
            bestMatch = { title: itemTitle, enclosureUrl: encUrl, description: desc, pubDate };
          }

          // If episode param exists, try heuristic matching 
          // Apple ?i= param is the trackId - try to match via iTunes episode lookup
          itemIndex++;
          if (itemIndex > 200) break; // safety limit
        }

        // If we have an episodeId, try iTunes episode lookup for title matching
        if (episodeId) {
          try {
            const epLookup = await fetch(`https://itunes.apple.com/lookup?id=${episodeId}`);
            if (epLookup.ok) {
              const epData = await epLookup.json();
              const episode = epData.results?.[0];
              if (episode) {
                metadata.title = episode.trackName || null;
                metadata.description = episode.description || metadata.description;
                metadata.durationMs = episode.trackTimeMillis || null;
                metadata.publishDate = episode.releaseDate || null;

                // Now search RSS for title match
                if (metadata.title) {
                  const searchTitle = metadata.title.toLowerCase();
                  const itemRegex2 = /<item[\s>]([\s\S]*?)<\/item>/gi;
                  let im2;
                  while ((im2 = itemRegex2.exec(rssXml)) !== null) {
                    const it = im2[1];
                    const tm = it.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
                    const em = it.match(/<enclosure[^>]+url="([^"]+)"/);
                    const rssTitle = tm?.[1]?.trim()?.toLowerCase() || '';
                    if (em?.[1] && rssTitle && (
                      rssTitle.includes(searchTitle) || searchTitle.includes(rssTitle) ||
                      rssTitle === searchTitle
                    )) {
                      bestMatch = { title: tm![1]!.trim(), enclosureUrl: em[1], description: '', pubDate: '' };
                      break;
                    }
                  }
                }
              }
            }
          } catch { /* non-critical */ }
        }

        if (bestMatch?.enclosureUrl) {
          resolution.audioEnclosureUrl = bestMatch.enclosureUrl;
          if (!metadata.title) metadata.title = bestMatch.title;
          if (!metadata.description && bestMatch.description) metadata.description = bestMatch.description;
          stages[stages.length - 1] = {
            stage: 'resolving_audio_enclosure', status: 'done',
            detail: `Found: ${bestMatch.title || 'untitled'}`,
          };
        } else {
          stages[stages.length - 1] = {
            stage: 'resolving_audio_enclosure', status: 'failed',
            detail: 'No matching enclosure found in RSS feed',
          };
        }
      } else {
        stages[stages.length - 1] = { stage: 'resolving_rss_feed', status: 'failed', detail: `RSS fetch ${rssResp.status}` };
      }
    } catch (e) {
      stages[stages.length - 1] = { stage: 'resolving_rss_feed', status: 'failed', detail: String(e) };
    }
  } else {
    stages.push({ stage: 'resolving_rss_feed', status: 'failed', detail: 'No feed URL from iTunes API' });
  }

  // Determine final status
  let finalStatus: string;
  let failureCode: string | null = null;
  let failureReason: string | null = null;

  if (resolution.audioEnclosureUrl) {
    finalStatus = 'audio_resolved';
    // No failure — audio URL found, can proceed to transcription
  } else if (metadata.title || metadata.description) {
    finalStatus = 'metadata_only';
    failureCode = feedUrl ? 'APPLE_ENCLOSURE_NOT_FOUND' : 'APPLE_FEED_NOT_RESOLVED';
    failureReason = feedUrl
      ? `RSS feed found but could not match episode enclosure. Show: ${metadata.showName}. Paste transcript or provide direct audio URL.`
      : `Could not resolve RSS feed for show ID ${showId}. Metadata captured. Paste transcript or provide alternate URL.`;
  } else {
    finalStatus = 'needs_manual_assist';
    failureCode = 'APPLE_PAGE_PARSED_NO_FEED';
    failureReason = 'Could not resolve Apple Podcasts episode. Provide transcript, notes, or direct audio URL.';
  }

  return {
    success: true,
    subtype: episodeId ? 'apple_podcast_episode' : 'apple_podcast_show',
    metadata,
    resolution,
    finalStatus,
    failureCode,
    failureReason,
    resolverStages: stages,
  };
}

// ── Anchor.fm ──────────────────────────────────────────────

function isAnchorUrl(url: string): boolean {
  return /anchor\.fm/i.test(url);
}

async function resolveAnchorEpisode(url: string): Promise<ResolveResult> {
  const stages: ResolveResult['resolverStages'] = [];
  const metadata: ResolveResult['metadata'] = {
    title: null, showName: null, description: null,
    durationMs: null, artworkUrl: null, episodeUrl: url, publishDate: null,
  };
  const resolution: ResolveResult['resolution'] = {
    rssFeedUrl: null, audioEnclosureUrl: null,
    transcriptSourceUrl: null, canonicalPageUrl: url,
  };

  // Anchor.fm URLs follow pattern: anchor.fm/s/{showId}/podcast or anchor.fm/{showName}/episodes/{slug}
  // Try to derive RSS feed URL — Anchor provides RSS at anchor.fm/s/{showId}/podcast/rss
  // or for new Spotify-hosted: podcasters.spotify.com/pod/{showName}/rss
  
  stages.push({ stage: 'resolving_anchor_rss', status: 'running' });
  
  // Try to scrape the anchor page to find the RSS link or audio player
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  let pageContent = '';
  
  if (firecrawlKey) {
    try {
      const scrapeResp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formats: ['markdown', 'html'], waitFor: 3000, timeout: 30000 }),
      });
      if (scrapeResp.ok) {
        const data = await scrapeResp.json();
        pageContent = data.data?.markdown || '';
        const html = data.data?.html || '';
        
        // Look for audio URL in the HTML
        const audioMatch = html.match(/(?:src|href)="(https?:\/\/[^"]*\.(?:mp3|m4a|ogg)[^"]*)"/i);
        if (audioMatch) {
          resolution.audioEnclosureUrl = audioMatch[1];
        }
        
        // Look for RSS link
        const rssMatch = html.match(/(?:href)="(https?:\/\/[^"]*\/rss[^"]*)"/i)
          || html.match(/(?:href)="(https?:\/\/anchor\.fm\/s\/[^"]*\/podcast\/rss)"/i);
        if (rssMatch) {
          resolution.rssFeedUrl = rssMatch[1];
        }
        
        // Extract title from page
        const titleMatch = pageContent.match(/^#\s+(.+)/m) || pageContent.match(/^(.{10,80})/m);
        if (titleMatch) metadata.title = titleMatch[1].trim();
        
        // Extract description
        const paragraphs = pageContent.split('\n\n').filter((p: string) => p.trim().length > 50);
        if (paragraphs.length > 0) {
          metadata.description = paragraphs.slice(0, 3).join('\n\n').substring(0, 2000);
        }
        
        stages[stages.length - 1] = { stage: 'resolving_anchor_rss', status: 'done', detail: `audio=${resolution.audioEnclosureUrl ? 'found' : 'none'}, rss=${resolution.rssFeedUrl ? 'found' : 'none'}` };
      } else {
        stages[stages.length - 1] = { stage: 'resolving_anchor_rss', status: 'failed', detail: `Scrape ${scrapeResp.status}` };
      }
    } catch (e) {
      stages[stages.length - 1] = { stage: 'resolving_anchor_rss', status: 'failed', detail: String(e) };
    }
  } else {
    stages[stages.length - 1] = { stage: 'resolving_anchor_rss', status: 'failed', detail: 'No Firecrawl key for page scrape' };
  }

  // If we found RSS but no direct audio, try to parse the RSS for enclosures
  if (resolution.rssFeedUrl && !resolution.audioEnclosureUrl) {
    stages.push({ stage: 'resolving_audio_enclosure', status: 'running' });
    try {
      const rssResp = await fetch(resolution.rssFeedUrl);
      if (rssResp.ok) {
        const rssXml = await rssResp.text();
        // Get first episode enclosure
        const encMatch = rssXml.match(/<enclosure[^>]+url="([^"]+)"/);
        if (encMatch) {
          resolution.audioEnclosureUrl = encMatch[1];
          stages[stages.length - 1] = { stage: 'resolving_audio_enclosure', status: 'done', detail: 'Found from RSS' };
        } else {
          stages[stages.length - 1] = { stage: 'resolving_audio_enclosure', status: 'failed', detail: 'No enclosure in RSS' };
        }
      }
    } catch (e) {
      stages[stages.length - 1] = { stage: 'resolving_audio_enclosure', status: 'failed', detail: String(e) };
    }
  }

  let finalStatus: string;
  let failureCode: string | null = null;
  let failureReason: string | null = null;

  if (resolution.audioEnclosureUrl) {
    finalStatus = 'audio_resolved';
  } else if (metadata.title || metadata.description) {
    finalStatus = 'metadata_only';
    failureCode = 'ANCHOR_NO_AUDIO_URL';
    failureReason = 'Anchor.fm page scraped but no direct audio URL found. Paste transcript or provide direct audio URL.';
  } else {
    finalStatus = 'needs_manual_assist';
    failureCode = 'ANCHOR_PARSE_FAILED';
    failureReason = 'Could not extract audio or metadata from Anchor.fm. Paste transcript manually.';
  }

  return {
    success: true,
    subtype: 'anchor_episode',
    metadata,
    resolution,
    finalStatus,
    failureCode,
    failureReason,
    resolverStages: stages,
  };
}

// ── Main handler ───────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, subtype_hint } = await req.json();
    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let result: ResolveResult;

    const spotifyEpId = extractSpotifyEpisodeId(url);
    const appleIds = extractApplePodcastIds(url);

    if (spotifyEpId) {
      result = await resolveSpotifyEpisode(url, spotifyEpId);
    } else if (appleIds.showId) {
      result = await resolveApplePodcastEpisode(url, appleIds.showId, appleIds.episodeId);
    } else if (isAnchorUrl(url)) {
      result = await resolveAnchorEpisode(url);
    } else {
      // Unknown podcast URL — try as generic page
      result = {
        success: false,
        subtype: subtype_hint || 'unsupported_audio',
        metadata: { title: null, showName: null, description: null, durationMs: null, artworkUrl: null, episodeUrl: url, publishDate: null },
        resolution: { rssFeedUrl: null, audioEnclosureUrl: null, transcriptSourceUrl: null, canonicalPageUrl: null },
        finalStatus: 'needs_manual_assist',
        failureCode: 'CANONICAL_PAGE_NOT_FOUND',
        failureReason: 'URL is not a recognized Spotify, Apple Podcasts, or Anchor episode. Provide a direct audio URL or paste transcript.',
        resolverStages: [],
      };
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('resolve-podcast-episode error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
