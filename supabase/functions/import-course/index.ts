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
  
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || 'Untitled Lesson';
  
  let type = 'text';
  if (/wistia|vimeo|youtube|video-player/i.test(html)) type = 'video';
  
  // Extract content from multiple possible containers
  let content = '';
  const contentPatterns = [
    /class="[^"]*(?:post__body|lesson-body|post-body|entry-content|kjb-html-content|article-content)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|article|section)>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
  ];
  
  for (const pattern of contentPatterns) {
    const m = html.match(pattern);
    if (m && m[1].length > content.length) {
      content = m[1];
    }
  }
  
  // Clean HTML to text
  content = content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
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
  
  debug.push(`Content extracted: ${content.length} chars, type: ${type}`);
  
  return { title, content, type, debug };
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
