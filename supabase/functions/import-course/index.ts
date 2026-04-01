/**
 * import-course: Authenticates to course platforms (Kajabi, Thinkific, etc.)
 * and scrapes curriculum structure + lesson content.
 * 
 * Supports two modes:
 *   1. { url, action: "discover" } → returns curriculum structure (modules + lessons)
 *   2. { url, action: "fetch_lesson", lesson_url } → returns full lesson content
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id',
};

function detectPlatform(url: string): 'kajabi' | 'thinkific' | 'teachable' | 'unknown' {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname.includes('thinkific')) return 'thinkific';
  if (hostname.includes('teachable')) return 'teachable';
  // Kajabi custom domains don't include "kajabi" — detect from page content later
  return 'kajabi'; // default assumption for custom domains
}

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
      const setCookies = headers.getSetCookie?.() || [];
      for (const sc of setCookies) {
        const parts = sc.split(';')[0];
        const eqIdx = parts.indexOf('=');
        if (eqIdx > 0) {
          const name = parts.substring(0, eqIdx).trim();
          const value = parts.substring(eqIdx + 1).trim();
          cookies.set(name, value);
        }
      }
    },
    toString() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

async function kajabiLogin(baseUrl: string, jar: CookieJar): Promise<boolean> {
  const email = Deno.env.get('COURSE_PLATFORM_EMAIL');
  const password = Deno.env.get('COURSE_PLATFORM_PASSWORD');

  if (!email || !password) {
    throw new Error('Course platform credentials not configured');
  }

  const origin = new URL(baseUrl).origin;

  // Step 1: GET the login page to get CSRF token + cookies
  console.log('Fetching login page...');
  const loginPageResp = await fetch(`${origin}/login`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
    redirect: 'manual',
  });

  jar.addFromHeaders(loginPageResp.headers);
  const loginHtml = await loginPageResp.text();

  // Extract CSRF token
  const csrfMatch = loginHtml.match(/name="authenticity_token"\s+value="([^"]+)"/);
  const csrfToken = csrfMatch?.[1] || '';

  if (!csrfToken) {
    console.warn('No CSRF token found, attempting login anyway');
  }

  console.log('Submitting login form...');

  // Step 2: POST login
  const formData = new URLSearchParams();
  if (csrfToken) formData.append('authenticity_token', csrfToken);
  formData.append('member[email]', email);
  formData.append('member[password]', password);
  formData.append('commit', 'Log In');

  const loginResp = await fetch(`${origin}/login`, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': jar.toString(),
      'Accept': 'text/html,application/xhtml+xml',
      'Referer': `${origin}/login`,
    },
    body: formData.toString(),
    redirect: 'manual',
  });

  jar.addFromHeaders(loginResp.headers);

  // Follow redirects manually to collect all cookies
  const location = loginResp.headers.get('location');
  console.log(`Login response: ${loginResp.status}, redirect: ${location}`);

  if (location) {
    const redirectUrl = location.startsWith('http') ? location : `${origin}${location}`;
    const followResp = await fetch(redirectUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Cookie': jar.toString(),
        'Accept': 'text/html',
      },
      redirect: 'manual',
    });
    jar.addFromHeaders(followResp.headers);
    await followResp.text(); // consume body

    // Follow one more redirect if needed
    const loc2 = followResp.headers.get('location');
    if (loc2) {
      const url2 = loc2.startsWith('http') ? loc2 : `${origin}${loc2}`;
      const r2 = await fetch(url2, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Cookie': jar.toString(),
          'Accept': 'text/html',
        },
        redirect: 'manual',
      });
      jar.addFromHeaders(r2.headers);
      await r2.text();
    }
  }

  // Check if we're logged in (look for session cookie or lack of login redirect)
  const hasCookies = jar.cookies.size > 2;
  console.log(`Login result: ${hasCookies ? 'success' : 'may have failed'} (${jar.cookies.size} cookies)`);
  return hasCookies;
}

interface LessonInfo {
  title: string;
  url: string;
  module: string;
  index: number;
  duration?: string;
  type?: string; // video, text, quiz, etc.
}

function parseKajabiCurriculum(html: string, baseOrigin: string): LessonInfo[] {
  const lessons: LessonInfo[] = [];
  let index = 0;

  // Kajabi course pages typically have a sidebar/curriculum with module/lesson structure
  // Pattern 1: Look for curriculum sections with links
  const moduleRegex = /<(?:div|section|h[2-4])[^>]*class="[^"]*(?:category|module|section|chapter)[^"]*"[^>]*>[\s\S]*?<\/(?:div|section|h[2-4])>/gi;
  
  // More reliable: extract all lesson links with their context
  // Kajabi uses data attributes and specific CSS classes
  
  // Try to find structured lesson data in the HTML
  // Pattern: Look for lesson list items with links
  const lessonLinkRegex = /<a[^>]*href="([^"]*(?:\/(?:lessons|posts|chapters|modules|categories)\/[^"]*|\/[^"]*(?:lesson|post|chapter)[^"]*))"[^>]*>([\s\S]*?)<\/a>/gi;
  
  let currentModule = 'Main Content';
  let match;
  
  // First pass: try to extract module headings
  const moduleHeadings: { text: string; position: number }[] = [];
  const headingRegex = /<(?:h[2-4]|div|span)[^>]*class="[^"]*(?:category-title|module-title|section-title|chapter-title|subcategory__title)[^"]*"[^>]*>([\s\S]*?)<\/(?:h[2-4]|div|span)>/gi;
  while ((match = headingRegex.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text) moduleHeadings.push({ text, position: match.index });
  }
  
  // Also look for category/section divs
  const catRegex = /class="[^"]*(?:category__|subcategory__|module-)[^"]*"[\s\S]*?(?:category-title|module-title|subcategory__title)[^"]*"[^>]*>([\s\S]*?)<\//gi;
  while ((match = catRegex.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text && !moduleHeadings.find(m => m.text === text)) {
      moduleHeadings.push({ text, position: match.index });
    }
  }
  
  // Second pass: extract lesson links
  const seen = new Set<string>();
  const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const linkText = match[2].replace(/<[^>]+>/g, '').trim();
    
    // Filter for lesson-like URLs
    if (!href || !linkText) continue;
    if (href.includes('/login') || href.includes('/signup') || href === '#') continue;
    if (href.includes('/products/') && !href.includes('/categories/') && !href.includes('/posts/')) continue;
    
    // Must look like a lesson URL
    const isLesson = /\/(lessons|posts|chapters|categories\/[^/]+\/posts)\//.test(href) ||
                     (href.includes('/posts/') && linkText.length > 3);
    
    if (!isLesson) continue;
    
    const fullUrl = href.startsWith('http') ? href : `${baseOrigin}${href}`;
    const normalized = fullUrl.replace(/[?#].*$/, '');
    
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    
    // Determine current module based on position
    const pos = match.index;
    for (let i = moduleHeadings.length - 1; i >= 0; i--) {
      if (moduleHeadings[i].position < pos) {
        currentModule = moduleHeadings[i].text;
        break;
      }
    }
    
    // Detect lesson type from surrounding HTML context
    const context = html.substring(Math.max(0, match.index - 200), match.index + match[0].length + 200);
    let type = 'text';
    if (/video|play|watch/i.test(context)) type = 'video';
    else if (/quiz|assessment/i.test(context)) type = 'quiz';
    else if (/download|pdf/i.test(context)) type = 'download';
    
    // Extract duration if present
    const durMatch = context.match(/(\d+)\s*(?:min|minutes?|hrs?|hours?)/i);
    
    lessons.push({
      title: linkText.substring(0, 200),
      url: fullUrl,
      module: currentModule,
      index: index++,
      duration: durMatch?.[0],
      type,
    });
  }
  
  return lessons;
}

async function discoverCurriculum(courseUrl: string): Promise<{ platform: string; title: string; lessons: LessonInfo[] }> {
  const jar = createCookieJar();
  const origin = new URL(courseUrl).origin;
  
  // Login first
  const loggedIn = await kajabiLogin(courseUrl, jar);
  if (!loggedIn) {
    console.warn('Login may have failed, attempting to fetch course page anyway');
  }
  
  // Fetch the course page
  console.log('Fetching course page:', courseUrl);
  const courseResp = await fetch(courseUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Cookie': jar.toString(),
      'Accept': 'text/html',
    },
    redirect: 'follow',
  });
  
  const courseHtml = await courseResp.text();
  console.log(`Course page fetched: ${courseResp.status}, ${courseHtml.length} chars`);
  
  // Check if we got redirected to login
  if (courseHtml.includes('member[password]') || courseResp.url.includes('/login')) {
    throw new Error('Authentication failed — could not access course content. Please verify your credentials.');
  }
  
  // Extract course title
  const titleMatch = courseHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const courseTitle = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || 'Untitled Course';
  
  // Detect platform from HTML
  let platform = 'kajabi';
  if (courseHtml.includes('thinkific')) platform = 'thinkific';
  else if (courseHtml.includes('teachable')) platform = 'teachable';
  else if (courseHtml.includes('kajabi') || courseHtml.includes('Kajabi')) platform = 'kajabi';
  
  // Parse curriculum
  const lessons = parseKajabiCurriculum(courseHtml, origin);
  
  console.log(`Found ${lessons.length} lessons in ${platform} course "${courseTitle}"`);
  
  // If we found zero lessons, try fetching with Firecrawl as fallback
  if (lessons.length === 0) {
    console.log('No lessons found via HTML parsing, trying alternative patterns...');
    
    // Try broader link extraction
    const allLinks: LessonInfo[] = [];
    const broadRegex = /<a[^>]*href="(\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    const seenUrls = new Set<string>();
    
    while ((m = broadRegex.exec(courseHtml)) !== null) {
      const href = m[1];
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      
      if (!text || text.length < 3 || text.length > 200) continue;
      if (href === '/' || href.includes('/login') || href.includes('/signup')) continue;
      if (/\.(css|js|png|jpg|svg|ico)/.test(href)) continue;
      
      const fullUrl = `${origin}${href}`;
      if (seenUrls.has(fullUrl)) continue;
      seenUrls.add(fullUrl);
      
      allLinks.push({
        title: text,
        url: fullUrl,
        module: 'Course Content',
        index: allLinks.length,
        type: 'text',
      });
    }
    
    if (allLinks.length > 0) {
      return { platform, title: courseTitle, lessons: allLinks };
    }
  }
  
  return { platform, title: courseTitle, lessons };
}

async function fetchLessonContent(lessonUrl: string): Promise<{ title: string; content: string; type: string }> {
  const jar = createCookieJar();
  
  await kajabiLogin(lessonUrl, jar);
  
  console.log('Fetching lesson:', lessonUrl);
  const resp = await fetch(lessonUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Cookie': jar.toString(),
      'Accept': 'text/html',
    },
    redirect: 'follow',
  });
  
  const html = await resp.text();
  
  // Extract title
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || 'Untitled Lesson';
  
  // Detect lesson type
  let type = 'text';
  if (html.includes('wistia') || html.includes('vimeo') || html.includes('youtube') || html.includes('video-player')) {
    type = 'video';
  }
  
  // Extract main content — try multiple patterns for Kajabi
  let content = '';
  
  // Pattern 1: Kajabi post body
  const bodyMatch = html.match(/class="[^"]*(?:post__body|lesson-body|post-body|entry-content|article-content|kjb-html-content)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|article|section)>/i);
  if (bodyMatch) {
    content = bodyMatch[1];
  }
  
  // Pattern 2: Main content area
  if (!content) {
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) content = mainMatch[1];
  }
  
  // Pattern 3: Article tag
  if (!content) {
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) content = articleMatch[1];
  }
  
  // Clean HTML to text
  content = content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n')
    .replace(/<(?:li)>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  return { title, content, type };
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
          JSON.stringify({ success: false, error: 'lesson_url is required for fetch_lesson' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const result = await fetchLessonContent(lesson_url);
      return new Response(
        JSON.stringify({ success: true, ...result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default: discover curriculum
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
