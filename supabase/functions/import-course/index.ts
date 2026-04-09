/**
 * import-course: Authenticates to Kajabi course platforms and scrapes curriculum.
 * 
 * Modes:
 *   { url, action: "discover" } → returns curriculum structure
 *   { url, action: "fetch_lesson", lesson_url } → returns lesson content
 *   { url, action: "debug_login" } → returns login debug info
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id',
};

interface CookieJar {
  cookies: Map<string, string>;
  addFromHeaders(headers: Headers): void;
  toString(): string;
}

function createCookieJar(): CookieJar {
  const cookies = new Map<string, string>();
  return {
    cookies,
    addFromHeaders(headers: Headers) {
      // Try getSetCookie first (Deno 1.37+), fallback to manual parsing
      let setCookieHeaders: string[] = [];
      try {
        setCookieHeaders = headers.getSetCookie?.() || [];
      } catch { /* fallback below */ }
      
      // Fallback: iterate all headers
      if (setCookieHeaders.length === 0) {
        headers.forEach((value, key) => {
          if (key.toLowerCase() === 'set-cookie') {
            setCookieHeaders.push(value);
          }
        });
      }
      
      for (const sc of setCookieHeaders) {
        // Handle multiple cookies in one header (comma-separated)
        const cookieParts = sc.split(',').map(s => s.trim());
        for (const part of cookieParts) {
          const nameValue = part.split(';')[0];
          const eqIdx = nameValue.indexOf('=');
          if (eqIdx > 0) {
            const name = nameValue.substring(0, eqIdx).trim();
            const value = nameValue.substring(eqIdx + 1).trim();
            // Skip cookie attributes that look like names
            if (!['path', 'domain', 'expires', 'max-age', 'samesite', 'secure', 'httponly'].includes(name.toLowerCase())) {
              cookies.set(name, value);
            }
          }
        }
      }
    },
    toString() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/**
 * Extract transcript text from DOM elements BEFORE stripping them.
 * Returns the extracted transcript text (or empty string).
 */
function extractDomTranscript(html: string, debug: string[]): string {
  const patterns = [
    /<div[^>]*(?:id|class)="[^"]*(?:transcript|captions?|subtitles?|video-transcript)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<section[^>]*(?:id|class)="[^"]*(?:transcript|captions?|subtitles?|video-transcript)[^"]*"[^>]*>([\s\S]*?)<\/section>/gi,
    /<aside[^>]*(?:id|class)="[^"]*(?:transcript|captions?|subtitles?|video-transcript)[^"]*"[^>]*>([\s\S]*?)<\/aside>/gi,
    /<details[^>]*(?:id|class)="[^"]*(?:transcript|captions?|subtitles?|video-transcript)[^"]*"[^>]*>([\s\S]*?)<\/details>/gi,
    // Expandable transcript toggles (common in course platforms)
    /<div[^>]*(?:id|class)="[^"]*(?:accordion|collapsible|expandable)[^"]*"[^>]*>[\s\S]*?(?:transcript|caption)[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/gi,
  ];

  const segments: string[] = [];
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(html)) !== null) {
      const text = m[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 50) {
        segments.push(text);
      }
    }
  }

  if (segments.length > 0) {
    const transcript = segments.join('\n\n');
    const wordCount = transcript.split(/\s+/).filter(Boolean).length;
    debug.push(`[DOM Transcript] Extracted ${segments.length} segment(s), ${wordCount} words`);
    return transcript;
  }
  return '';
}

function stripTranscriptSections(html: string) {
  return html
    .replace(/<div[^>]*(?:id|class)="[^"]*(?:transcript|captions?|subtitles?|video-transcript)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<section[^>]*(?:id|class)="[^"]*(?:transcript|captions?|subtitles?|video-transcript)[^"]*"[^>]*>[\s\S]*?<\/section>/gi, '')
    .replace(/<aside[^>]*(?:id|class)="[^"]*(?:transcript|captions?|subtitles?|video-transcript)[^"]*"[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<details[^>]*(?:id|class)="[^"]*(?:transcript|captions?|subtitles?|video-transcript)[^"]*"[^>]*>[\s\S]*?<\/details>/gi, '');
}

/**
 * Fetch Wistia captions/transcript via the public embed API.
 */
async function resolveWistiaCaptions(videoId: string, debug: string[]): Promise<string | null> {
  try {
    debug.push(`[Wistia Captions] Fetching captions for ${videoId}...`);
    const resp = await fetch(`https://fast.wistia.com/embed/captions/${videoId}.json`, {
      headers: { 'User-Agent': UA },
    });
    if (!resp.ok) {
      debug.push(`[Wistia Captions] API returned ${resp.status}`);
      await resp.text();
      return null;
    }
    const captions = await resp.json();
    // Wistia captions format: array of { language, text, ... } or { captions: [...] }
    const captionList = Array.isArray(captions) ? captions : captions?.captions || [];
    if (captionList.length === 0) {
      debug.push('[Wistia Captions] No captions available');
      return null;
    }
    // Prefer English, fallback to first available
    const english = captionList.find((c: any) => /^en/i.test(c.language)) || captionList[0];
    if (!english?.hash) {
      // Try direct text field
      if (english?.text) {
        debug.push(`[Wistia Captions] Got direct text (${english.text.length} chars)`);
        return english.text;
      }
      debug.push('[Wistia Captions] No caption hash or text found');
      return null;
    }
    // Fetch the actual caption lines
    const lines = english.hash;
    if (Array.isArray(lines)) {
      const text = lines.map((line: any) => line.text || '').filter(Boolean).join(' ');
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      debug.push(`[Wistia Captions] Extracted ${wordCount} words from ${lines.length} caption lines`);
      return text;
    }
    debug.push('[Wistia Captions] Unexpected caption format');
    return null;
  } catch (err) {
    debug.push(`[Wistia Captions] Error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Resolve a Vimeo video to its text tracks (captions) via oEmbed + player config.
 */
async function resolveVimeoCaptions(videoId: string, debug: string[]): Promise<string | null> {
  try {
    debug.push(`[Vimeo Captions] Attempting caption extraction for ${videoId}...`);
    // Vimeo player config endpoint (public, no API key needed)
    const configResp = await fetch(`https://player.vimeo.com/video/${videoId}/config`, {
      headers: { 'User-Agent': UA },
    });
    if (!configResp.ok) {
      debug.push(`[Vimeo Captions] Config returned ${configResp.status}`);
      await configResp.text();
      return null;
    }
    const config = await configResp.json();
    const textTracks = config?.request?.text_tracks || [];
    if (textTracks.length === 0) {
      debug.push('[Vimeo Captions] No text tracks available');
      return null;
    }
    // Prefer English
    const track = textTracks.find((t: any) => /^en/i.test(t.lang)) || textTracks[0];
    if (!track?.url) {
      debug.push('[Vimeo Captions] No track URL found');
      return null;
    }
    const trackUrl = track.url.startsWith('http') ? track.url : `https://player.vimeo.com${track.url}`;
    const trackResp = await fetch(trackUrl, { headers: { 'User-Agent': UA } });
    if (!trackResp.ok) {
      debug.push(`[Vimeo Captions] Track fetch returned ${trackResp.status}`);
      await trackResp.text();
      return null;
    }
    const trackData = await trackResp.json();
    // Vimeo text tracks are typically an array of { startTime, endTime, text }
    if (Array.isArray(trackData)) {
      const text = trackData.map((cue: any) => cue.text || '').filter(Boolean).join(' ');
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      debug.push(`[Vimeo Captions] Extracted ${wordCount} words from ${trackData.length} cues`);
      return text;
    }
    debug.push('[Vimeo Captions] Unexpected track data format');
    return null;
  } catch (err) {
    debug.push(`[Vimeo Captions] Error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Resolve a Vimeo video ID to a downloadable media URL via player config.
 */
async function resolveVimeoMediaUrl(videoId: string, debug: string[]): Promise<{ url: string; duration: number } | null> {
  try {
    debug.push(`[Vimeo Media] Resolving media URL for ${videoId}...`);
    const configResp = await fetch(`https://player.vimeo.com/video/${videoId}/config`, {
      headers: { 'User-Agent': UA },
    });
    if (!configResp.ok) {
      debug.push(`[Vimeo Media] Config returned ${configResp.status}`);
      await configResp.text();
      return null;
    }
    const config = await configResp.json();
    const duration = config?.video?.duration || 0;
    // Progressive downloads (direct MP4 files)
    const progressive = config?.request?.files?.progressive || [];
    if (progressive.length > 0) {
      // Pick smallest quality for transcription
      const sorted = [...progressive].sort((a: any, b: any) => (a.width || 0) - (b.width || 0));
      const best = sorted[0];
      debug.push(`[Vimeo Media] Resolved progressive: ${best.width}x${best.height}, ${Math.round(duration)}s`);
      return { url: best.url, duration };
    }
    // HLS fallback (less useful for direct download but may work)
    const hls = config?.request?.files?.hls?.cdns;
    if (hls) {
      const firstCdn = Object.values(hls)[0] as any;
      if (firstCdn?.url) {
        debug.push(`[Vimeo Media] Resolved HLS URL (may not work for transcription)`);
        return { url: firstCdn.url, duration };
      }
    }
    debug.push('[Vimeo Media] No downloadable files found');
    return null;
  } catch (err) {
    debug.push(`[Vimeo Media] Error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Resolve a Wistia video ID to its smallest MP4 URL via the public embed API.
 */
async function resolveWistiaMediaUrl(videoId: string, debug: string[]): Promise<{ url: string; duration: number } | null> {
  try {
    debug.push(`Resolving Wistia media URL for ${videoId}...`);
    const mediaResp = await fetch(`https://fast.wistia.com/embed/medias/${videoId}.json`, {
      headers: { 'User-Agent': UA },
    });
    if (!mediaResp.ok) {
      debug.push(`Wistia API returned ${mediaResp.status}`);
      await mediaResp.text();
      return null;
    }
    const mediaData = await mediaResp.json();
    const assets = mediaData?.media?.assets || [];
    const duration = mediaData?.media?.duration || 0;

    const mp4Assets = assets
      .filter((a: { container?: string; url?: string }) => a.container === 'mp4' && a.url)
      .sort((a: { size?: number }, b: { size?: number }) => (a.size || 0) - (b.size || 0));

    if (mp4Assets.length === 0) {
      debug.push('No MP4 assets found');
      return null;
    }

    const smallest = mp4Assets[0];
    const url = smallest.url.startsWith('//') ? `https:${smallest.url}` : smallest.url;
    debug.push(`Resolved: ${smallest.width}x${smallest.height}, ${Math.round(duration)}s`);
    return { url, duration };
  } catch (err) {
    debug.push(`Wistia resolve error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function kajabiLogin(baseUrl: string, jar: CookieJar, creds?: { email?: string; password?: string }): Promise<{ success: boolean; debug: string[] }> {
  const email = creds?.email || Deno.env.get('COURSE_PLATFORM_EMAIL');
  const password = creds?.password || Deno.env.get('COURSE_PLATFORM_PASSWORD');
  const debug: string[] = [];

  if (!email || !password) {
    throw new Error('Course platform credentials not configured. Please enter your email and password for this course platform.');
  }

  const origin = new URL(baseUrl).origin;

  // Step 1: GET the login page to get cookies + CSRF token
  debug.push('Step 1: Fetching login page...');
  const loginPageResp = await fetch(`${origin}/login`, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    redirect: 'follow',
  });
  jar.addFromHeaders(loginPageResp.headers);
  const loginHtml = await loginPageResp.text();
  debug.push(`Login page: ${loginPageResp.status}, ${loginHtml.length} chars, ${jar.cookies.size} cookies`);

  // Try multiple CSRF token patterns
  let csrfToken = '';
  
  // Pattern 1: hidden input authenticity_token
  const inputMatch = loginHtml.match(/name="authenticity_token"[^>]*value="([^"]+)"/i) ||
                     loginHtml.match(/value="([^"]+)"[^>]*name="authenticity_token"/i);
  if (inputMatch) {
    csrfToken = inputMatch[1];
    debug.push(`CSRF from input: ${csrfToken.substring(0, 20)}...`);
  }
  
  // Pattern 2: meta tag
  if (!csrfToken) {
    const metaMatch = loginHtml.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/i) ||
                      loginHtml.match(/<meta\s+content="([^"]+)"\s+name="csrf-token"/i);
    if (metaMatch) {
      csrfToken = metaMatch[1];
      debug.push(`CSRF from meta: ${csrfToken.substring(0, 20)}...`);
    }
  }
  
  // Pattern 3: in script tag (Kajabi sometimes injects via JS)
  if (!csrfToken) {
    const scriptMatch = loginHtml.match(/csrf[_-]?token['":\s]+['"]([^'"]+)['"]/i) ||
                        loginHtml.match(/authenticity[_-]?token['":\s]+['"]([^'"]+)['"]/i);
    if (scriptMatch) {
      csrfToken = scriptMatch[1];
      debug.push(`CSRF from script: ${csrfToken.substring(0, 20)}...`);
    }
  }

  if (!csrfToken) {
    debug.push('WARNING: No CSRF token found in any pattern');
    // Log a snippet of the HTML around form elements for debugging
    const formIdx = loginHtml.indexOf('new_member_session');
    if (formIdx > -1) {
      debug.push(`Form context: ${loginHtml.substring(formIdx, formIdx + 500).replace(/\s+/g, ' ')}`);
    }
  }

  // Step 2: POST login
  debug.push('Step 2: Submitting login...');
  const formData = new URLSearchParams();
  formData.append('utf8', '✓');
  if (csrfToken) formData.append('authenticity_token', csrfToken);
  formData.append('member[email]', email);
  formData.append('member[password]', password);
  formData.append('member[remember_me]', '0');
  formData.append('commit', 'Login');

  const loginResp = await fetch(`${origin}/login`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': jar.toString(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer': `${origin}/login`,
      'Origin': origin,
    },
    body: formData.toString(),
    redirect: 'manual',
  });

  jar.addFromHeaders(loginResp.headers);
  const loginStatus = loginResp.status;
  const location = loginResp.headers.get('location');
  debug.push(`Login response: ${loginStatus}, location: ${location}, cookies: ${jar.cookies.size}`);
  
  // Consume response body
  const loginBody = await loginResp.text();

  // Follow redirects manually to collect all session cookies
  if (location) {
    const redirectUrl = location.startsWith('http') ? location : `${origin}${location}`;
    debug.push(`Following redirect: ${redirectUrl}`);
    
    let currentUrl = redirectUrl;
    for (let i = 0; i < 5; i++) {
      const r = await fetch(currentUrl, {
        headers: { 'User-Agent': UA, 'Cookie': jar.toString(), 'Accept': 'text/html' },
        redirect: 'manual',
      });
      jar.addFromHeaders(r.headers);
      await r.text();
      
      const nextLoc = r.headers.get('location');
      if (!nextLoc || r.status < 300 || r.status >= 400) {
        debug.push(`Redirect chain ended at ${r.status}, cookies: ${jar.cookies.size}`);
        break;
      }
      currentUrl = nextLoc.startsWith('http') ? nextLoc : `${origin}${nextLoc}`;
      debug.push(`Following redirect ${i+2}: ${currentUrl}`);
    }
  }

  // Determine success: 302 redirect typically means success, 422/200 with form means failure
  const isSuccess = loginStatus === 302 || loginStatus === 301;
  debug.push(`Login ${isSuccess ? 'SUCCEEDED' : 'FAILED'} (status: ${loginStatus})`);
  
  return { success: isSuccess, debug };
}

interface LessonInfo {
  title: string;
  url: string;
  module: string;
  index: number;
  duration?: string;
  type?: string;
}

function parseCurriculum(html: string, baseOrigin: string): LessonInfo[] {
  const lessons: LessonInfo[] = [];
  const seen = new Set<string>();
  
  // Kajabi uses specific patterns in course pages
  // Look for post/lesson links within category sections
  
  // Extract module/category headings with their positions
  const moduleHeadings: { text: string; position: number }[] = [];
  
  // Pattern: Kajabi category titles
  const headingPatterns = [
    /class="[^"]*(?:category-title|subcategory__title|module-title|section-heading)[^"]*"[^>]*>([\s\S]*?)<\//gi,
    /<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi,
  ];
  
  for (const pattern of headingPatterns) {
    let m;
    while ((m = pattern.exec(html)) !== null) {
      const text = m[1].replace(/<[^>]+>/g, '').trim();
      if (text && text.length > 2 && text.length < 200) {
        moduleHeadings.push({ text, position: m.index });
      }
    }
  }
  
  // Extract lesson links
  const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let currentModule = 'Course Content';
  let match;
  let index = 0;
  
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const rawText = match[2];
    const linkText = rawText.replace(/<[^>]+>/g, '').trim();
    
    // Clean title: take only first line, trim descriptions
    const cleanTitle = linkText.split('\n')[0].trim();
    if (!href || !cleanTitle || cleanTitle.length < 3 || cleanTitle.length > 300) continue;
    const linkTextClean = cleanTitle;
    if (href === '#' || href === '/') continue;
    if (/\/(login|signup|password|checkout|cart)/.test(href)) continue;
    if (/\.(css|js|png|jpg|svg|ico|woff)/.test(href)) continue;
    // Skip navigation buttons that look like lessons
    if (/^(next module|back|previous|continue|go back|next lesson|prev lesson|previous lesson)$/i.test(linkTextClean)) continue;
    
    // Must look like a lesson/post URL for Kajabi
    const isLesson = /\/(posts|lessons|chapters)\//.test(href) ||
                     /\/categories\/[^/]+\/posts\//.test(href);
    
    if (!isLesson) continue;
    
    const fullUrl = href.startsWith('http') ? href : `${baseOrigin}${href}`;
    const normalized = fullUrl.replace(/[?#].*$/, '');
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    
    // Determine current module from nearest preceding heading
    for (let i = moduleHeadings.length - 1; i >= 0; i--) {
      if (moduleHeadings[i].position < match.index) {
        currentModule = moduleHeadings[i].text;
        break;
      }
    }
    
    // Detect type from context
    const context = html.substring(Math.max(0, match.index - 300), match.index + match[0].length + 300);
    let type = 'text';
    if (/video|wistia|vimeo|youtube|play-button|video-icon/i.test(context)) type = 'video';
    else if (/quiz|assessment/i.test(context)) type = 'quiz';
    else if (/download|\.pdf/i.test(context)) type = 'download';
    
    const durMatch = context.match(/(\d+)\s*(?:min|minutes?)/i);
    
    lessons.push({
      title: linkTextClean,
      url: fullUrl,
      module: currentModule,
      index: index++,
      duration: durMatch?.[0],
      type,
    });
  }
  
  return lessons;
}

async function discoverCurriculum(courseUrl: string, creds?: { email?: string; password?: string }): Promise<{ platform: string; title: string; lessons: LessonInfo[]; debug: string[] }> {
  const jar = createCookieJar();
  const parsedUrl = new URL(courseUrl);
  const origin = parsedUrl.origin;
  
  // Auto-strip /categories/... suffix to scan the full product page
  const categoryMatch = parsedUrl.pathname.match(/^(\/products\/[^/]+)\/categories\/.+$/);
  let effectiveUrl = courseUrl;
  if (categoryMatch) {
    effectiveUrl = `${origin}${categoryMatch[1]}`;
  }
  
  const { success: loggedIn, debug } = await kajabiLogin(effectiveUrl, jar, creds);
  
  if (!loggedIn) {
    debug.push('Login failed — attempting course page fetch anyway');
  }
  
  if (effectiveUrl !== courseUrl) {
    debug.push(`Category URL detected — scanning full product page instead: ${effectiveUrl}`);
  }
  
  // Fetch the course page with session cookies
  debug.push(`Fetching course page: ${effectiveUrl}`);
  const courseResp = await fetch(effectiveUrl, {
    headers: {
      'User-Agent': UA,
      'Cookie': jar.toString(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
  });
  
  jar.addFromHeaders(courseResp.headers);
  const courseHtml = await courseResp.text();
  debug.push(`Course page: ${courseResp.status}, ${courseHtml.length} chars, final URL: ${courseResp.url}`);
  
  // Check if still on login page
  const isLoginPage = courseHtml.includes('member[password]') && courseHtml.includes('new_member_session');
  if (isLoginPage) {
    debug.push('Still on login page — authentication did not persist');
    return {
      platform: 'kajabi',
      title: 'Authentication Required',
      lessons: [],
      debug,
    };
  }
  
  // Extract course title — prefer <title> (usually "Course Name | Platform") over <h1> (can be a lesson name)
  const titleTagMatch = courseHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1Match = courseHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  let courseTitle = 'Untitled Course';
  if (titleTagMatch) {
    // Strip platform suffix like " | Kajabi" or " - pclub.io"
    courseTitle = titleTagMatch[1].replace(/<[^>]+>/g, '').replace(/\s*[|–—-]\s*[^|–—-]*$/, '').trim() || courseTitle;
  } else if (h1Match) {
    courseTitle = h1Match[1].replace(/<[^>]+>/g, '').trim() || courseTitle;
  }
  
  // Detect platform
  let platform = 'kajabi';
  if (/thinkific/i.test(courseHtml)) platform = 'thinkific';
  else if (/teachable/i.test(courseHtml)) platform = 'teachable';
  
  // Parse curriculum
  const lessons = parseCurriculum(courseHtml, origin);
  debug.push(`Found ${lessons.length} lessons`);
  
  // If zero lessons, try broader extraction
  if (lessons.length === 0) {
    debug.push('No structured lessons found — trying broad link extraction');
    const broadLessons: LessonInfo[] = [];
    const broadSeen = new Set<string>();
    const linkRegex = /<a[^>]*href="(\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    
    while ((m = linkRegex.exec(courseHtml)) !== null) {
      const href = m[1];
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      if (!text || text.length < 3 || text.length > 200) continue;
      if (href === '/' || /\/(login|signup|password|checkout)/.test(href)) continue;
      if (/\.(css|js|png|jpg|svg|ico)/.test(href)) continue;
      
      const fullUrl = `${origin}${href}`;
      if (broadSeen.has(fullUrl)) continue;
      broadSeen.add(fullUrl);
      
      broadLessons.push({
        title: text,
        url: fullUrl,
        module: 'Course Content',
        index: broadLessons.length,
        type: 'text',
      });
    }
    
    debug.push(`Broad extraction found ${broadLessons.length} links`);
    
    // Also log some HTML structure for debugging
    const bodySnippet = courseHtml.substring(0, 2000).replace(/\s+/g, ' ');
    debug.push(`HTML start: ${bodySnippet.substring(0, 500)}`);
    
    return { platform, title: courseTitle, lessons: broadLessons, debug };
  }
  
  return { platform, title: courseTitle, lessons, debug };
}

interface LessonQuality {
  content_length: number;
  cleaned_text_length: number;
  content_type: 'text' | 'transcript' | 'video_only' | 'html_junk' | 'login_page' | 'empty' | 'mixed';
  has_login_wall: boolean;
  has_redirect: boolean;
  redirect_url?: string;
  word_count: number;
  video_embeds_found: number;
  issues: string[];
  usable_content: boolean;
}

function classifyLessonContent(text: string, html: string, finalUrl: string, lessonUrl: string): LessonQuality {
  const issues: string[] = [];
  const trimmed = text.trim();
  // cleaned_text_length = text after stripping any residual HTML tags
  const cleanedText = trimmed.replace(/<[^>]+>/g, '').trim();
  const cleanedTextLength = cleanedText.length;
  const wordCount = cleanedText.split(/\s+/).filter(w => w.length > 2).length;

  // Redirect detection
  const hasRedirect = finalUrl !== lessonUrl && new URL(finalUrl).pathname !== new URL(lessonUrl).pathname;
  const redirectUrl = hasRedirect ? finalUrl : undefined;
  if (hasRedirect) issues.push(`Redirected to ${finalUrl}`);

  // Login wall detection
  const loginPatterns = [
    /member\[password\]/i,
    /new_member_session/i,
    /sign[\s_-]?in to (?:continue|access|view)/i,
    /you must (?:log|sign) in/i,
    /please (?:log|sign) in/i,
    /authentication required/i,
    /access denied/i,
    /login to (?:continue|view|access)/i,
  ];
  const hasLoginWall = loginPatterns.some(p => p.test(html));
  if (hasLoginWall) issues.push('Login/auth wall detected in page HTML');

  // Login redirect detection
  const loginRedirect = hasRedirect && /\/login|\/sign_in|\/signin/i.test(finalUrl);
  if (loginRedirect) issues.push('Redirected to login page');

  // Video embed count
  const videoEmbeds = (html.match(/wistia|vimeo|youtube|sproutvideo|video-player/gi) || []).length;

  // Content type classification
  let contentType: LessonQuality['content_type'] = 'text';
  if (hasLoginWall || loginRedirect) {
    contentType = 'login_page';
  } else if (trimmed.length === 0) {
    contentType = 'empty';
    issues.push('No content extracted');
  } else if (trimmed.length < 100 && videoEmbeds > 0) {
    contentType = 'video_only';
    if (wordCount < 10) issues.push('Video-only page with no substantial text');
  } else {
    // Explicit page-chrome / raw-HTML artifact detection
    // Look for structural indicators that the extractor returned page markup, not lesson prose
    const PAGE_CHROME_SIGNALS = [
      /<(?:header|footer|nav|aside|form)[\s>]/gi,        // structural page elements
      /class="[^"]*(?:navbar|footer|sidebar|menu|modal|popup|cookie)[^"]*"/gi, // layout classes
      /(?:font-family|background-color|margin|padding)\s*:/gi,  // inline CSS rules
      /<(?:script|style|link|meta)[\s>]/gi,               // non-content tags
      /<input[\s>]/gi,                                     // form inputs
    ];
    let chromeSignalCount = 0;
    for (const sig of PAGE_CHROME_SIGNALS) {
      chromeSignalCount += (trimmed.match(sig) || []).length;
    }
    const htmlTagCount = (trimmed.match(/<[a-z]+[\s>]/gi) || []).length;
    const textRatio = trimmed.length > 0 ? cleanedTextLength / trimmed.length : 1;

    // html_junk if: heavy chrome artifacts AND low text ratio AND short cleaned text
    if (chromeSignalCount >= 8 && textRatio < 0.4 && cleanedTextLength < 500) {
      contentType = 'html_junk';
      issues.push(`Raw page chrome detected (${chromeSignalCount} signals, ${htmlTagCount} tags, ${Math.round(textRatio * 100)}% text) — extraction failed`);
    } else if (htmlTagCount > 30 && textRatio < 0.3 && cleanedTextLength < 300) {
      // Fallback: extreme tag density with almost no text
      contentType = 'html_junk';
      issues.push(`Extreme tag density (${htmlTagCount} tags, ${Math.round(textRatio * 100)}% text) — extraction failed`);
    } else if (videoEmbeds > 0 && wordCount > 20) {
      contentType = 'mixed';
    }
  }

  // Near-empty guard
  if (contentType === 'text' && wordCount < 15) {
    issues.push(`Very low word count (${wordCount} words)`);
  }

  // Compute usable_content: server-side boolean so client doesn't have to infer
  const BLOCKED_TYPES: Set<string> = new Set(['login_page', 'empty', 'html_junk']);
  const usableContent = !BLOCKED_TYPES.has(contentType) && !hasLoginWall && !loginRedirect && wordCount >= 5;

  return {
    content_length: trimmed.length,
    cleaned_text_length: cleanedTextLength,
    content_type: contentType,
    has_login_wall: hasLoginWall || loginRedirect,
    has_redirect: hasRedirect,
    redirect_url: redirectUrl,
    word_count: wordCount,
    video_embeds_found: videoEmbeds,
    issues,
    usable_content: usableContent,
  };
}

async function fetchLessonContent(courseUrl: string, lessonUrl: string, creds?: { email?: string; password?: string }): Promise<{ title: string; content: string; type: string; debug: string[]; quality: LessonQuality; media_url?: string; video_duration?: number; transcript_source?: string; has_video_transcript?: boolean }> {
  const jar = createCookieJar();
  const debug: string[] = [];
  
  const { success: loggedIn, debug: loginDebug } = await kajabiLogin(courseUrl, jar, creds);
  debug.push(...loginDebug);
  
  if (!loggedIn) {
    debug.push('Login failed for lesson fetch');
  }
  
  debug.push(`Fetching lesson: ${lessonUrl}`);
  const resp = await fetch(lessonUrl, {
    headers: {
      'User-Agent': UA,
      'Cookie': jar.toString(),
      'Accept': 'text/html',
    },
    redirect: 'follow',
  });
  
  const html = await resp.text();
  debug.push(`Lesson page: ${resp.status}, ${html.length} chars`);
  
  // Try multiple title sources: h1 first, then og:title, then <title> (least specific)
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const ogMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i) ||
                  html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:title"/i);
  const titleTagMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  
  let title = '';
  if (h1Match) {
    title = h1Match[1].replace(/<[^>]+>/g, '').trim();
  }
  // If h1 is generic (site name), prefer og:title
  if (!title || title.length < 3 || /on-demand|sales introverts|training/i.test(title)) {
    title = ogMatch?.[1]?.trim() || title;
  }
  // Last resort: <title> tag, but strip site name suffix
  if (!title || title.length < 3) {
    title = titleTagMatch?.[1]?.replace(/<[^>]+>/g, '').replace(/\s*[\|–—-]\s*.+$/, '').trim() || 'Untitled Lesson';
  }
  
  let type = 'text';
  if (/wistia|vimeo|youtube|video-player/i.test(html)) type = 'video';
  
  // Extract video embed info
  const videoEmbeds: string[] = [];
  
  // Wistia
  const wistiaMatches = html.matchAll(/wistia_async_([a-z0-9]+)/gi);
  for (const wm of wistiaMatches) {
    videoEmbeds.push(`[Wistia Video: ${wm[1]}]`);
  }
  const wistiaIframe = html.matchAll(/fast\.wistia\.\w+\/embed\/(?:iframe|medias)\/([a-z0-9]+)/gi);
  for (const wm of wistiaIframe) {
    if (!videoEmbeds.some(v => v.includes(wm[1]))) {
      videoEmbeds.push(`[Wistia Video: ${wm[1]}]`);
    }
  }
  
  // Vimeo
  const vimeoMatches = html.matchAll(/player\.vimeo\.com\/video\/(\d+)/gi);
  for (const vm of vimeoMatches) {
    videoEmbeds.push(`[Vimeo Video: ${vm[1]}]`);
  }
  
  // YouTube
  const ytMatches = html.matchAll(/(?:youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]+)/gi);
  for (const ym of ytMatches) {
    videoEmbeds.push(`[YouTube Video: ${ym[1]}]`);
  }
  
  // Sproutvideo (commonly used by Kajabi)
  const sproutMatches = html.matchAll(/videos-cdn\.sproutvideo\.com\/([a-z0-9]+)/gi);
  for (const sm of sproutMatches) {
    if (!videoEmbeds.some(v => v.includes(sm[1]))) {
      videoEmbeds.push(`[SproutVideo: ${sm[1]}]`);
    }
  }
  
  // Generic iframe video embeds
  if (videoEmbeds.length === 0) {
    const iframeMatches = html.matchAll(/<iframe[^>]*src="([^"]*(?:video|player|embed)[^"]*)"/gi);
    for (const im of iframeMatches) {
      videoEmbeds.push(`[Video Embed: ${im[1]}]`);
    }
  }
  
  // Kajabi's native video player  
  if (videoEmbeds.length === 0 && /data-controller="[^"]*video/i.test(html)) {
    videoEmbeds.push(`[Kajabi Native Video]`);
  }
  
  debug.push(`Video embeds found: ${videoEmbeds.length}`);
  
  // === EXTRACT DOM TRANSCRIPT BEFORE STRIPPING ===
  const domTranscript = extractDomTranscript(html, debug);
  
  // Strip comments sections before content extraction
  // Kajabi uses data-controller="comments" or similar patterns
  let cleanedHtml = html
    .replace(/<[^>]*data-controller="[^"]*comment[^"]*"[^>]*>[\s\S]*$/gi, '')
    .replace(/<section[^>]*(?:comments|discussion)[^>]*>[\s\S]*?<\/section>/gi, '')
    .replace(/<div[^>]*(?:id|class)="[^"]*(?:comments|comment-section|disqus|discussion|kjb-comments|post-comments)[^"]*"[^>]*>[\s\S]*$/gi, '');
  
  // Also strip footer sections  
  cleanedHtml = cleanedHtml
    .replace(/<footer[\s\S]*$/gi, '')
    .replace(/<div[^>]*class="[^"]*(?:coach-section|about-coach|instructor-bio|customer-portal)[^"]*"[\s\S]*$/gi, '');
  
  // Strip sidebar/playlist/navigation sections BEFORE content extraction
  // These are Kajabi course nav elements that leak into content-wrap
  cleanedHtml = cleanedHtml
    .replace(/<div[^>]*class="[^"]*(?:playlist|sidebar|subcategory|category-list|course-sidebar|post-sidebar|kjb-sidebar|product-sidebar|section-list)[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<div[^>]*class="[^"]*(?:navigation|breadcrumb|mark-complete|next-lesson|prev-lesson|lesson-nav|post-nav)[^"]*"[\s\S]*?<\/div>/gi, '');
  cleanedHtml = stripTranscriptSections(cleanedHtml);
  
  // Extract content — try Kajabi-specific post body first
  let content = '';
  
  // Look for the actual lesson body content by scanning for class names
  const classNames = [...cleanedHtml.matchAll(/class="([^"]+)"/gi)].map(m => m[1]);
  const postBodyClasses = classNames.filter(c => /post|lesson|content|body/i.test(c) && !/nav|header|sidebar|menu|playlist|category/i.test(c));
  debug.push(`Post-related classes: ${postBodyClasses.slice(0, 5).join(', ')}`);
  
  // Try to extract from Kajabi's known content containers
  // Order matters: most specific first, broadest last
  const contentPatterns = [
    // Kajabi post body (most specific — actual lesson text)
    /class="[^"]*(?:kjb-html-content)[^"]*"[^>]*>([\s\S]+?)<\/div>/i,
    /class="[^"]*(?:post__body|post-body)[^"]*"[^>]*>([\s\S]+?)<\/div>/i,
    /class="[^"]*(?:product-post__body|lesson-content|course-content)[^"]*"[^>]*>([\s\S]+?)<\/div>/i,
    /data-post-body[^>]*>([\s\S]+?)<\/div>/i,
    // Kajabi section body (contains intro + body, better than content-wrap)
    /class="[^"]*section__body[^"]*"[^>]*>([\s\S]+?)<\/div>\s*<\/div>\s*<\/div>/i,
    // Kajabi content-wrap (broader — may include sidebar, use as fallback)
    /class="[^"]*content-wrap[^"]*"[^>]*>([\s\S]+)/i,
  ];
  
  for (const pattern of contentPatterns) {
    const m = cleanedHtml.match(pattern);
    if (m && m[1] && m[1].trim().length > 50) {
      // Skip matches that are basically just video embed references with no real lesson text
      const stripped = m[1]
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (stripped.length < 50) {
        debug.push(`Skipped pattern (text<50: ${stripped.length}): ${pattern.source.substring(0, 40)}`);
        continue;
      }
      // For video pages, require more substantial text — short noise like "Account Scoring" isn't a real lesson body
      if (type === 'video' && stripped.length < 200) {
        debug.push(`Skipped pattern (video page, text<200: ${stripped.length}): ${pattern.source.substring(0, 40)}`);
        continue;
      }
      content = m[1];
      debug.push(`Matched pattern: ${pattern.source.substring(0, 40)}, raw=${m[1].length}, text=${stripped.length}`);
      break;
    }
  }
  
  // Fallback: use main or article
  if (!content || content.length < 50) {
    const mainMatch = cleanedHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) content = mainMatch[1];
  }
  
  // Last resort: strip nav/header from body
  if (!content || content.length < 50) {
    content = cleanedHtml
      .replace(/[\s\S]*?<body[^>]*>/i, '')
      .replace(/<\/body>[\s\S]*/i, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '');
    debug.push(`Last resort: using full body (${content.length} chars)`);
  }
  
  // Post-extraction: remove any remaining sidebar/playlist content
  content = content
    .replace(/<div[^>]*class="[^"]*(?:playlist|sidebar|navigation|breadcrumb|subcategory|category-list)[^"]*"[\s\S]*?<\/div>/gi, '')
    .replace(/<div[^>]*class="[^"]*(?:mark-complete|next-lesson|prev-lesson)[^"]*"[\s\S]*?<\/div>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '');
  
  // Clean HTML to text
  content = content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    // Remove comment-related content that might remain
    .replace(/<[^>]*(?:comment|reply|avatar)[^>]*>[\s\S]*?<\/[^>]+>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n')
    .replace(/<(?:li)>/gi, '• ')
    .replace(/<[^>]+>/g, '');
  
  // Decode ALL HTML entities properly (comprehensive list)
  content = content
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rdquo;/g, '\u201D')
    .replace(/&ldquo;/g, '\u201C')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&hellip;/g, '\u2026')
    .replace(/&trade;/g, '\u2122')
    .replace(/&copy;/g, '\u00A9')
    .replace(/&reg;/g, '\u00AE')
    .replace(/&bull;/g, '\u2022')
    .replace(/&rarr;/g, '\u2192')
    .replace(/&larr;/g, '\u2190')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  // Remove common nav/UI noise from the text output
  content = content
    .replace(/\b(?:Store|My Library|Search|Settings|Logout|Log Out|Sign Out)\b/g, '')
    .replace(/Mark As Complete/gi, '')
    .replace(/Great Job! Keep Going!/gi, '')
    .replace(/Next Lesson/gi, '')
    .replace(/Next Section/gi, '')
    .replace(/Play Now/gi, '')
    .replace(/Will Begin In \d+ Seconds/gi, '')
    .replace(/Module \d+ of \d+/gi, '')
    .replace(/\d+ Modules/gi, '')
    .replace(/^\s*(?:Back|Next|Previous|Cancel)\s*$/gm, '')
    .replace(/^\s*\|\s*$/gm, '')
    .replace(/^\s*\d+\s*$/gm, '') // Standalone numbers (playlist indices)
    // Remove lines that are only whitespace/noise with deep indent but keep real content
    .replace(/^\s{6,}\S{0,5}\s*$/gm, '') // Lines with 6+ leading spaces and ≤5 non-space chars
    .replace(/^\s*AI\s+\w[\w\s]{2,40}\s*$/gm, '') // Strip Kajabi "AI [Feature Name]" sidebar labels
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Deduplicate consecutive lines (nav breadcrumbs often repeat the lesson title)
  const lines = content.split('\n');
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const key = line.trim().toLowerCase();
    if (!key || key.length > 80 || !seen.has(key)) {
      deduped.push(line);
      if (key && key.length <= 80) seen.add(key);
    }
  }
  content = deduped.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // Trim leading whitespace from all lines (leftover from HTML indentation)
  content = content.split('\n').map(l => l.trimStart()).join('\n');
  
  // Prepend video embed references so they're captured in the resource
  if (videoEmbeds.length > 0) {
    content = videoEmbeds.join('\n') + '\n\n' + content;
  }

  // Try to capture lesson intro/header text that may sit above the main content div
  // Kajabi often has a section__heading or post heading with intro paragraphs
  const introPatterns = [
    /class="[^"]*(?:section__heading|post__heading|lesson-heading|post-heading)[^"]*"[^>]*>([\s\S]+?)<\/div>/i,
    /class="[^"]*(?:section__description|post__description|lesson-intro)[^"]*"[^>]*>([\s\S]+?)<\/div>/i,
    // Kajabi panel heading / media body (common in course pages)
    /class="[^"]*(?:panel__heading|media-body)[^"]*"[^>]*>([\s\S]+?)<\/div>/i,
  ];
  let introText = '';
  for (const ip of introPatterns) {
    const im = cleanedHtml.match(ip);
    if (im && im[1]) {
      const cleaned = im[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      debug.push(`Intro candidate: ${cleaned.substring(0, 80)}... (${cleaned.length} chars)`);
      if (cleaned.length > 20 && !content.includes(cleaned.substring(0, Math.min(80, cleaned.length)))) {
        introText += cleaned + '\n\n';
      }
    }
  }

  // Also try to find standalone paragraphs near the lesson heading that aren't in our content yet
  // These are intro paragraphs that sit between the heading and the main body div
  const h2Matches = [...cleanedHtml.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
  for (const h2 of h2Matches) {
    // Look for <p> tags after this h2 but before the next heading or div container
    const afterH2 = cleanedHtml.substring(h2.index! + h2[0].length);
    const nextSectionIdx = afterH2.search(/<(?:h[1-3]|div[^>]*class="[^"]*(?:kjb-html|post__|section__|content-wrap))/i);
    const betweenSlice = nextSectionIdx > 0 ? afterH2.substring(0, nextSectionIdx) : afterH2.substring(0, 2000);
    const paragraphs = [...betweenSlice.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
    for (const p of paragraphs) {
      const pText = p[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (pText.length > 40 && !content.includes(pText.substring(0, Math.min(60, pText.length)))) {
        introText += pText + '\n\n';
        debug.push(`Intro paragraph captured: ${pText.substring(0, 60)}... (${pText.length} chars)`);
      }
    }
  }

  if (introText) {
    // Insert intro after video embeds but before main content
    const embedEnd = content.lastIndexOf(']\n\n');
    if (embedEnd > 0) {
      content = content.substring(0, embedEnd + 3) + introText + content.substring(embedEnd + 3);
    } else {
      content = introText + content;
    }
    debug.push(`Intro text prepended: ${introText.length} chars`);
  }
  
  // === MULTI-STRATEGY VIDEO TRANSCRIPT EXTRACTION ===
  let mediaUrl = '';
  let videoDuration = 0;
  let videoTranscript = '';
  let transcriptSource = '';

  // Structured extraction trace
  interface TraceStep { attempted: boolean; success: boolean; word_count?: number; detail?: string }
  const trace: Record<string, TraceStep> = {
    dom_transcript: { attempted: false, success: false },
    wistia_captions: { attempted: false, success: false },
    vimeo_captions: { attempted: false, success: false },
    wistia_media: { attempted: false, success: false },
    vimeo_media: { attempted: false, success: false },
    audio_transcription: { attempted: false, success: false },
  };

  const wistiaIds = videoEmbeds
    .filter(v => v.startsWith('[Wistia Video:'))
    .map(v => v.match(/\[Wistia Video: ([a-z0-9]+)\]/i)?.[1])
    .filter(Boolean) as string[];

  const vimeoIds = videoEmbeds
    .filter(v => v.startsWith('[Vimeo Video:'))
    .map(v => v.match(/\[Vimeo Video: (\d+)\]/i)?.[1])
    .filter(Boolean) as string[];

  // Strategy 1: DOM transcript (already extracted above)
  trace.dom_transcript.attempted = true;
  if (domTranscript) {
    const wc = domTranscript.split(/\s+/).filter(Boolean).length;
    trace.dom_transcript.success = true;
    trace.dom_transcript.word_count = wc;
    trace.dom_transcript.detail = `Extracted ${wc} words from page transcript containers`;
    videoTranscript = domTranscript;
    transcriptSource = 'dom_transcript';
    debug.push(`[Transcript Strategy] Using DOM transcript (${wc} words)`);
  } else {
    trace.dom_transcript.detail = 'No transcript containers found in DOM';
  }

  // Strategy 2: Wistia captions API
  if (!videoTranscript && wistiaIds.length > 0) {
    trace.wistia_captions.attempted = true;
    for (const wid of wistiaIds) {
      const captions = await resolveWistiaCaptions(wid, debug);
      if (captions && captions.split(/\s+/).length > 20) {
        const wc = captions.split(/\s+/).filter(Boolean).length;
        trace.wistia_captions.success = true;
        trace.wistia_captions.word_count = wc;
        trace.wistia_captions.detail = `Recovered ${wc} words from Wistia captions API (${wid})`;
        videoTranscript = captions;
        transcriptSource = 'wistia_captions';
        debug.push(`[Transcript Strategy] Using Wistia captions`);
        break;
      } else {
        trace.wistia_captions.detail = captions
          ? `Wistia captions too short (${captions.split(/\s+/).length} words, need >20)`
          : `Wistia captions API returned no content for ${wid}`;
      }
    }
  } else if (!videoTranscript && wistiaIds.length === 0) {
    trace.wistia_captions.detail = 'No Wistia embeds detected';
  }

  // Strategy 3: Vimeo text tracks
  if (!videoTranscript && vimeoIds.length > 0) {
    trace.vimeo_captions.attempted = true;
    for (const vid of vimeoIds) {
      const captions = await resolveVimeoCaptions(vid, debug);
      if (captions && captions.split(/\s+/).length > 20) {
        const wc = captions.split(/\s+/).filter(Boolean).length;
        trace.vimeo_captions.success = true;
        trace.vimeo_captions.word_count = wc;
        trace.vimeo_captions.detail = `Recovered ${wc} words from Vimeo text track (${vid})`;
        videoTranscript = captions;
        transcriptSource = 'vimeo_captions';
        debug.push(`[Transcript Strategy] Using Vimeo captions`);
        break;
      } else {
        trace.vimeo_captions.detail = captions
          ? `Vimeo captions too short (${captions.split(/\s+/).length} words)`
          : `Vimeo config returned no text tracks for ${vid}`;
      }
    }
  } else if (!videoTranscript && vimeoIds.length === 0) {
    trace.vimeo_captions.detail = 'No Vimeo embeds detected';
  }

  // Strategy 4: Resolve media URLs for downstream audio transcription
  if (wistiaIds.length > 0) {
    trace.wistia_media.attempted = true;
    const resolved = await resolveWistiaMediaUrl(wistiaIds[0], debug);
    if (resolved) {
      mediaUrl = resolved.url;
      videoDuration = resolved.duration;
      trace.wistia_media.success = true;
      trace.wistia_media.detail = `Resolved MP4 URL (${Math.round(resolved.duration)}s)`;
    } else {
      trace.wistia_media.detail = `Failed to resolve Wistia media URL for ${wistiaIds[0]}`;
    }
  }

  if (!mediaUrl && vimeoIds.length > 0) {
    trace.vimeo_media.attempted = true;
    const resolved = await resolveVimeoMediaUrl(vimeoIds[0], debug);
    if (resolved) {
      mediaUrl = resolved.url;
      videoDuration = resolved.duration;
      trace.vimeo_media.success = true;
      trace.vimeo_media.detail = `Resolved progressive MP4 URL (${Math.round(resolved.duration)}s)`;
    } else {
      trace.vimeo_media.detail = `Failed to resolve Vimeo media URL for ${vimeoIds[0]}`;
    }
  }

  // Audio transcription is client-side, mark as queued if we have a media URL but no transcript
  if (!videoTranscript && mediaUrl) {
    trace.audio_transcription.attempted = true;
    trace.audio_transcription.detail = 'Media URL resolved — queued for client-side audio transcription';
  } else if (!videoTranscript && !mediaUrl && videoEmbeds.length > 0) {
    trace.audio_transcription.detail = 'No media URL resolved — cannot queue transcription';
  }

  // Determine final_source
  let finalSource: string;
  if (transcriptSource) {
    finalSource = transcriptSource;
  } else if (mediaUrl) {
    finalSource = 'media_url_only';
  } else if (content.split(/\s+/).filter(Boolean).length >= 50) {
    finalSource = 'html_text_only';
  } else if (videoEmbeds.length > 0) {
    finalSource = 'metadata_only';
  } else {
    finalSource = content.trim().length > 0 ? 'html_text_only' : 'failed';
  }

  const extraction_trace = {
    ...trace,
    final_source: finalSource,
  };

  // === MERGE: If we got a video transcript via captions, append it to content ===
  if (videoTranscript) {
    const txWordCount = videoTranscript.split(/\s+/).filter(Boolean).length;
    const contentWordCount = content.split(/\s+/).filter(Boolean).length;
    
    if (contentWordCount < 50) {
      content = (content ? content + '\n\n--- Video Transcript ---\n\n' : '') + videoTranscript;
      debug.push(`[Transcript Merge] Transcript is primary content (${txWordCount} words, source: ${transcriptSource})`);
    } else {
      content = content + '\n\n--- Video Transcript ---\n\n' + videoTranscript;
      debug.push(`[Transcript Merge] Appended transcript (${txWordCount} words) to existing content (${contentWordCount} words)`);
    }
  }
  
  debug.push(`Content extracted: ${content.length} chars, type: ${type}, mediaUrl: ${mediaUrl ? 'yes' : 'no'}, transcriptSource: ${transcriptSource || 'none'}`);
  
  // === DETECT DOWNLOADABLE ASSETS ===
  const detectedAssets = detectLessonAssets(html, lessonUrl, debug);
  
  // Quality classification — run AFTER transcript merge so word counts reflect actual content
  const quality = classifyLessonContent(content, html, resp.url, lessonUrl);
  debug.push(`Quality: type=${quality.content_type}, words=${quality.word_count}, issues=${quality.issues.length > 0 ? quality.issues.join('; ') : 'none'}`);
  
  return {
    title, content, type, debug, quality,
    media_url: mediaUrl || undefined,
    video_duration: videoDuration || undefined,
    transcript_source: transcriptSource || undefined,
    has_video_transcript: Boolean(videoTranscript),
    extraction_trace,
    detected_assets: detectedAssets,
  };
}

interface DetectedAsset {
  filename: string;
  url: string;
  extension: string;
  source_section: string;
}

/**
 * Scan lesson HTML for downloadable assets (PDFs, DOCX, PPTX, XLSX, etc.)
 */
function detectLessonAssets(html: string, lessonUrl: string, debug: string[]): DetectedAsset[] {
  const assets: DetectedAsset[] = [];
  const seenUrls = new Set<string>();
  const baseUrl = new URL(lessonUrl).origin;

  const ASSET_EXTENSIONS = /\.(pdf|docx?|pptx?|xlsx?|csv|txt|rtf|zip|key|pages|numbers)(?:\?|#|$)/i;

  // Strategy 1: Links with download attribute
  const downloadLinks = [...html.matchAll(/<a[^>]*\bdownload\b[^>]*href="([^"]+)"[^>]*>([^<]*)/gi)];
  for (const m of downloadLinks) {
    const href = m[1];
    const text = m[2]?.replace(/<[^>]+>/g, '').trim() || '';
    addAsset(href, text, 'download-attribute');
  }

  // Strategy 2: Links matching asset file extensions
  const allLinks = [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const m of allLinks) {
    const href = m[1];
    if (ASSET_EXTENSIONS.test(href)) {
      const text = m[2]?.replace(/<[^>]+>/g, '').trim() || '';
      addAsset(href, text, 'file-extension-link');
    }
  }

  // Strategy 3: Links inside Download/Resource/Attachment sections
  // Use bounded quantifiers (.{0,5000}) to prevent stack overflow on large HTML
  const sectionPatterns = [
    /(?:downloads?|resources?|attachments?|files?|handouts?|worksheets?|materials?)\s*<\/(?:h[1-6]|span|div|p|strong|b)>.{0,5000}?(<a[^>]*href="[^"]+"[^>]*>[^<]{0,200}<\/a>)/gi,
    /<(?:div|section)[^>]*class="[^"]*(?:download|resource|attachment|file|handout|material)[^"]*"[^>]*>(.{0,5000}?)<\/(?:div|section)>/gi,
    /<(?:div|section)[^>]*(?:id|data-[a-z-]+)="[^"]*(?:download|resource|attachment|file)[^"]*"[^>]*>(.{0,5000}?)<\/(?:div|section)>/gi,
  ];
  for (const pattern of sectionPatterns) {
    let m;
    while ((m = pattern.exec(html)) !== null) {
      const innerLinks = [...m[1].matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]{0,200})<\/a>/gi)];
      for (const link of innerLinks) {
        addAsset(link[1], link[2]?.replace(/<[^>]+>/g, '').trim() || '', 'asset-section');
      }
    }
  }

  // Strategy 4: Kajabi file download blocks (bounded to prevent stack overflow)
  const kajabiFiles = [...html.matchAll(/<div[^>]*class="[^"]*kjb-file[^"]*"[^>]*>.{0,2000}?<a[^>]*href="([^"]+)"[^>]*>([^<]{0,200})<\/a>/gi)];
  for (const m of kajabiFiles) {
    addAsset(m[1], m[2]?.replace(/<[^>]+>/g, '').trim() || '', 'kajabi-file-block');
  }

  // Strategy 5: Kajabi /courses/downloads/ links (URL has no file extension, e.g. /nexus_exercise-pdf)
  const kajabiDownloadLinks = [...html.matchAll(/<a[^>]*href="([^"]*\/courses\/downloads\/[^"]+)"[^>]*>([^<]{0,200})<\/a>/gi)];
  for (const m of kajabiDownloadLinks) {
    const href = m[1];
    const text = m[2]?.replace(/<[^>]+>/g, '').trim() || '';
    // Infer extension from the slug (e.g. "nexus_exercise-pdf" → "pdf")
    const slug = href.split('/').pop() || '';
    const inferredExt = slug.match(/-(pdf|docx?|pptx?|xlsx?|csv|zip)$/i)?.[1]?.toLowerCase();
    if (inferredExt) {
      let resolvedUrl = href;
      try {
        if (href.startsWith('/')) resolvedUrl = baseUrl + href;
        else if (!href.startsWith('http')) resolvedUrl = new URL(href, lessonUrl).toString();
      } catch { continue; }
      if (seenUrls.has(resolvedUrl)) continue;
      seenUrls.add(resolvedUrl);
      const filename = text || decodeURIComponent(slug);
      assets.push({ filename, url: resolvedUrl, extension: inferredExt, source_section: 'kajabi-download-path' });
      debug.push(`[Asset Detection] Kajabi download path: ${filename} (${inferredExt}) from ${resolvedUrl}`);
    }
  }

  // Strategy 6: Kajabi downloads sidebar (class="downloads__download")
  const kajabiSidebarLinks = [...html.matchAll(/<a[^>]*class="[^"]*downloads__download[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]{0,200})<\/a>/gi)];
  for (const m of kajabiSidebarLinks) {
    const href = m[1];
    const text = m[2]?.replace(/<[^>]+>/g, '').trim() || '';
    addAsset(href, text, 'kajabi-downloads-sidebar');
  }

  function addAsset(href: string, linkText: string, source: string) {
    let resolvedUrl = href;
    try {
      if (href.startsWith('/')) resolvedUrl = baseUrl + href;
      else if (!href.startsWith('http')) resolvedUrl = new URL(href, lessonUrl).toString();
    } catch { return; }

    // Skip non-asset URLs
    if (/^(?:javascript|mailto|tel):/i.test(href)) return;
    if (seenUrls.has(resolvedUrl)) return;
    seenUrls.add(resolvedUrl);

    const extMatch = resolvedUrl.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    const ext = extMatch?.[1]?.toLowerCase() || '';

    // Must have a recognizable asset extension OR be from a trusted source strategy
    const trustedSources = ['download-attribute', 'kajabi-downloads-sidebar', 'kajabi-file-block'];
    if (!ASSET_EXTENSIONS.test(resolvedUrl) && !trustedSources.includes(source)) {
      // Try to infer extension from Kajabi-style slug (e.g. /nexus_exercise-pdf)
      const slug = resolvedUrl.split('/').pop() || '';
      const inferredExt = slug.match(/-(pdf|docx?|pptx?|xlsx?|csv|zip)$/i)?.[1]?.toLowerCase();
      if (!inferredExt) return;
    }

    const filename = linkText || decodeURIComponent(resolvedUrl.split('/').pop()?.split('?')[0] || 'unknown');

    assets.push({ filename, url: resolvedUrl, extension: ext, source_section: source });
  }

  // Diagnostic: capture evidence about asset-like references in HTML
  if (assets.length === 0) {
    const assetHints: string[] = [];
    const htmlSnippets: string[] = [];

    // Keyword search with context snippets
    const keywordPatterns = [
      { label: 'pdf_ref', pattern: /\.pdf/gi },
      { label: 'nexus', pattern: /nexus.{0,30}exercise/gi },
      { label: 'download_kw', pattern: /download/gi },
      { label: 'attachment_kw', pattern: /attachment/gi },
      { label: 'kjb_file', pattern: /kjb-file/gi },
      { label: 'file_block', pattern: /file.{0,5}block/gi },
    ];

    for (const { label, pattern } of keywordPatterns) {
      let m;
      let count = 0;
      while ((m = pattern.exec(html)) !== null && count < 2) {
        assetHints.push(`${label}@${m.index}`);
        // Capture surrounding HTML (300 chars before, 300 after)
        const start = Math.max(0, m.index - 300);
        const end = Math.min(html.length, m.index + m[0].length + 300);
        const snippet = html.substring(start, end)
          .replace(/\n\s+/g, ' ')  // collapse whitespace
          .replace(/\s{2,}/g, ' '); // normalize
        htmlSnippets.push(`[${label}@${m.index}] ...${snippet}...`);
        count++;
      }
    }

    // Also look for any <a> tags with href containing known asset keywords
    const anchorWithAsset = html.match(/<a[^>]*href="[^"]*(?:pdf|download|attachment|file)[^"]*"[^>]*>[^<]{0,100}<\/a>/gi);
    if (anchorWithAsset) {
      assetHints.push(`anchor_asset_href:${anchorWithAsset.length}`);
      htmlSnippets.push(...anchorWithAsset.slice(0, 2).map(m => `[anchor_asset] ${m.substring(0, 250)}`));
    }

    if (assetHints.length > 0) {
      debug.push(`[Asset Detection] No assets captured. ${assetHints.length} hint(s): ${assetHints.join(', ')}`);
      debug.push(`[Asset Detection Snippets] ${htmlSnippets.join('\n---\n')}`);
      console.log(`[Asset Detection Hints] ${assetHints.join(', ')}`);
      // Log snippets to edge function logs (truncate to avoid log overflow)
      for (const s of htmlSnippets.slice(0, 4)) {
        console.log(`[Asset Snippet] ${s.substring(0, 500)}`);
      }
    } else {
      debug.push(`[Asset Detection] No assets found and no asset-like references in HTML`);
      console.log(`[Asset Detection] Zero hints in ${html.length} chars of HTML`);
    }
  } else {
    debug.push(`[Asset Detection] Found ${assets.length} downloadable asset(s): ${assets.map(a => `${a.filename} (${a.source_section})`).join(', ')}`);
  }
  return assets;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { url, action, lesson_url, email: reqEmail, password: reqPassword } = body;
    const creds = (reqEmail && reqPassword) ? { email: reqEmail, password: reqPassword } : undefined;

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'Course URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'fetch_lesson') {
      if (!lesson_url) {
        return new Response(
          JSON.stringify({ success: false, error: 'lesson_url is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const result = await fetchLessonContent(url, lesson_url, creds);
      
      // Build standardized lesson result envelope
      const lessonResult = {
        requested_lesson_url: lesson_url,
        final_url: result.debug.find(d => d.startsWith('Lesson page:'))?.includes('final URL:') ? result.debug.find(d => d.includes('final URL:'))?.split('final URL: ')[1] : lesson_url,
        content_length: result.quality.content_length,
        cleaned_text_length: result.quality.cleaned_text_length,
        word_count: result.quality.word_count,
        quality: result.quality,
      };

      // ── BLOCK: login_page, empty, html_junk — never persist ──
      const BLOCKED_TYPES = new Set(['login_page', 'empty', 'html_junk']);
      if (BLOCKED_TYPES.has(result.quality.content_type) || !result.quality.usable_content) {
        const errorMessages: Record<string, string> = {
          login_page: 'Lesson page returned a login wall — authentication failed or expired',
          empty: 'Lesson page returned empty content — nothing to import',
          html_junk: 'Lesson page returned raw HTML fragments — content extraction failed',
        };
        return new Response(
          JSON.stringify({
            success: false,
            error: errorMessages[result.quality.content_type] || 'Content quality too low to import',
            ...lessonResult,
            debug: result.debug,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // ── POLICY: video_only → if we captured a transcript via captions, it's usable; otherwise metadata-only ──
      if (result.quality.content_type === 'video_only') {
        // If transcript was captured via captions API or DOM, the content is already merged and quality recalculated
        // Check if the merged content actually has substance now
        if (result.has_video_transcript && result.quality.word_count >= 50) {
          // Transcript recovered — treat as full content
          return new Response(
            JSON.stringify({
              success: true,
              ...result,
              ...lessonResult,
              metadata_only: false,
              _note: `Video transcript recovered via ${result.transcript_source} (${result.quality.word_count} words)`,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        // No transcript recovered — still needs downstream audio transcription
        return new Response(
          JSON.stringify({
            success: true,
            ...result,
            ...lessonResult,
            metadata_only: !result.media_url ? true : false, // If we have a media URL, client will transcribe
            content: result.media_url ? result.content : '', // Keep content if media URL exists for transcription
            _note: result.media_url
              ? 'Video-only lesson with media URL resolved. Client will attempt audio transcription.'
              : 'Video-only lesson imported as metadata stub. Transcription required for full content.',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ success: true, ...result, ...lessonResult }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'download_asset') {
      const { asset_url } = body;
      if (!asset_url) {
        return new Response(
          JSON.stringify({ success: false, error: 'asset_url is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      // Download the asset with authenticated session
      const jar = createCookieJar();
      await kajabiLogin(url, jar, creds);
      
      const assetResp = await fetch(asset_url, {
        headers: { 'User-Agent': UA, 'Cookie': jar.toString() },
        redirect: 'follow',
      });
      
      if (!assetResp.ok) {
        return new Response(
          JSON.stringify({ success: false, error: `Asset download failed: HTTP ${assetResp.status}` }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const contentType = assetResp.headers.get('content-type') || 'application/octet-stream';
      const arrayBuffer = await assetResp.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      
      return new Response(
        JSON.stringify({
          success: true,
          content_type: contentType,
          size_bytes: arrayBuffer.byteLength,
          data_base64: base64,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'debug_login') {
      const jar = createCookieJar();
      const { success, debug } = await kajabiLogin(url, jar, creds);
      return new Response(
        JSON.stringify({ success, debug, cookies: [...jar.cookies.keys()] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default: discover
    const result = await discoverCurriculum(url, creds);
    const domain = new URL(url).hostname;
    return new Response(
      JSON.stringify({
        success: true,
        ...result,
        meta: {
          domain,
          used_request_credentials: !!creds,
          auth_status: result.lessons.length === 0 && result.title === 'Authentication Required' ? 'auth_failed' : 'authenticated',
          lessons_discovered: result.lessons.length,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
