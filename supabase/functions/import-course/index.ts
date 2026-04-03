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

function stripTranscriptSections(html: string) {
  return html
    .replace(/<div[^>]*(?:id|class)="[^"]*(?:transcript|captions?|subtitles?|video-transcript)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<section[^>]*(?:id|class)="[^"]*(?:transcript|captions?|subtitles?|video-transcript)[^"]*"[^>]*>[\s\S]*?<\/section>/gi, '')
    .replace(/<aside[^>]*(?:id|class)="[^"]*(?:transcript|captions?|subtitles?|video-transcript)[^"]*"[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<details[^>]*(?:id|class)="[^"]*(?:transcript|captions?|subtitles?|video-transcript)[^"]*"[^>]*>[\s\S]*?<\/details>/gi, '');
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

async function kajabiLogin(baseUrl: string, jar: CookieJar): Promise<{ success: boolean; debug: string[] }> {
  const email = Deno.env.get('COURSE_PLATFORM_EMAIL');
  const password = Deno.env.get('COURSE_PLATFORM_PASSWORD');
  const debug: string[] = [];

  if (!email || !password) {
    throw new Error('Course platform credentials not configured');
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

async function discoverCurriculum(courseUrl: string): Promise<{ platform: string; title: string; lessons: LessonInfo[]; debug: string[] }> {
  const jar = createCookieJar();
  const origin = new URL(courseUrl).origin;
  
  const { success: loggedIn, debug } = await kajabiLogin(courseUrl, jar);
  
  if (!loggedIn) {
    debug.push('Login failed — attempting course page fetch anyway');
  }
  
  // Fetch the course page with session cookies
  debug.push(`Fetching course page: ${courseUrl}`);
  const courseResp = await fetch(courseUrl, {
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
  
  // Extract course title
  const titleMatch = courseHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || 
                     courseHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const courseTitle = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || 'Untitled Course';
  
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

async function fetchLessonContent(courseUrl: string, lessonUrl: string): Promise<{ title: string; content: string; type: string; debug: string[] }> {
  const jar = createCookieJar();
  const debug: string[] = [];
  
  const { success: loggedIn, debug: loginDebug } = await kajabiLogin(courseUrl, jar);
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
    // Remove lines that are just short repeated nav-like items (sidebar lesson titles leaking in)
    .replace(/^\s{4,}.*$/gm, '') // Lines with 4+ leading spaces are likely indented markup leftovers
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
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
  
  // Resolve Wistia video media URLs for transcription
  let mediaUrl = '';
  let videoDuration = 0;
  const wistiaIds = videoEmbeds
    .filter(v => v.startsWith('[Wistia Video:'))
    .map(v => v.match(/\[Wistia Video: ([a-z0-9]+)\]/i)?.[1])
    .filter(Boolean) as string[];
  
  if (wistiaIds.length > 0) {
    const resolved = await resolveWistiaMediaUrl(wistiaIds[0], debug);
    if (resolved) {
      mediaUrl = resolved.url;
      videoDuration = resolved.duration;
    }
  }
  
  debug.push(`Content extracted: ${content.length} chars, type: ${type}, mediaUrl: ${mediaUrl ? 'yes' : 'no'}`);
  
  return { title, content, type, debug, media_url: mediaUrl || undefined, video_duration: videoDuration || undefined };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { url, action, lesson_url } = body;

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
      const result = await fetchLessonContent(url, lesson_url);
      return new Response(
        JSON.stringify({ success: true, ...result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'debug_login') {
      const jar = createCookieJar();
      const { success, debug } = await kajabiLogin(url, jar);
      return new Response(
        JSON.stringify({ success, debug, cookies: [...jar.cookies.keys()] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default: discover
    const result = await discoverCurriculum(url);
    return new Response(
      JSON.stringify({ success: true, ...result }),
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
