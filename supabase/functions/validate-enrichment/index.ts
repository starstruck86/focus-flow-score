/**
 * Validation test harness for the enrichment orchestrator.
 * Accepts an array of test URLs, runs each through source classification + extraction,
 * and returns full per-item traces without writing to the resources table.
 *
 * This is a READ-ONLY diagnostic tool — it does not modify any DB state.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

// ── Re-use the same classification + extraction logic from the main enrichment function ──

const CONTENT_CAP = 60_000;
const MIN_CONTENT_CHARS = 500;
const GOOD_CONTENT_CHARS = 2000;
const MIN_UNIQUE_WORDS = 50;
const COMPLETE_MIN_SCORE = 70;
const PARTIAL_MIN_SCORE = 35;

const BOILERPLATE_PATTERNS = [
  /cookie\s*(policy|consent|notice)/i,
  /privacy\s*policy/i,
  /terms\s*(of\s*service|and\s*conditions)/i,
  /subscribe\s*(to\s*our|now)/i,
  /sign\s*up\s*for/i,
  /all\s*rights\s*reserved/i,
  /©\s*\d{4}/,
  /skip\s*to\s*(main\s*)?content/i,
];

type SourceType =
  | 'webpage_static' | 'webpage_js' | 'pdf' | 'youtube'
  | 'google_doc' | 'notion' | 'auth_gated' | 'social' | 'podcast' | 'unknown';

interface SourceClassification {
  source_type: SourceType;
  platform: string;
  auth_required: boolean;
  transcript_available: boolean | null;
  downloadable: boolean;
  js_rendered: boolean;
}

const AUTH_GATED_DOMAINS: Array<{ pattern: RegExp; platform: string }> = [
  { pattern: /circle\.so/i, platform: 'Circle' },
  { pattern: /teachable\.com/i, platform: 'Teachable' },
  { pattern: /kajabi\.com/i, platform: 'Kajabi' },
  { pattern: /skool\.com/i, platform: 'Skool' },
  { pattern: /thinkific\.com/i, platform: 'Thinkific' },
  { pattern: /udemy\.com/i, platform: 'Udemy' },
  { pattern: /coursera\.org/i, platform: 'Coursera' },
  { pattern: /linkedin\.com\/learning/i, platform: 'LinkedIn Learning' },
  { pattern: /loom\.com/i, platform: 'Loom' },
  { pattern: /dropbox\.com/i, platform: 'Dropbox' },
  { pattern: /onedrive\.live\.com/i, platform: 'OneDrive' },
  { pattern: /sharepoint\.com/i, platform: 'SharePoint' },
  { pattern: /\.zoom\.us\//i, platform: 'Zoom' },
];

const GOOGLE_DOC_PATTERNS = [/docs\.google\.com/i, /drive\.google\.com/i, /sheets\.google\.com/i, /slides\.google\.com/i];
const JS_HEAVY_DOMAINS = [/medium\.com/i, /substack\.com/i, /hashnode\.dev/i, /dev\.to/i, /notion\.site/i, /webflow\.io/i];

function classifySource(url: string): SourceClassification {
  try {
    const u = new URL(url);
    const host = u.hostname + u.pathname;
    for (const ag of AUTH_GATED_DOMAINS) {
      if (ag.pattern.test(host)) return { source_type: 'auth_gated', platform: ag.platform, auth_required: true, transcript_available: null, downloadable: false, js_rendered: false };
    }
    if (GOOGLE_DOC_PATTERNS.some(p => p.test(host))) return { source_type: 'google_doc', platform: 'Google', auth_required: true, transcript_available: null, downloadable: false, js_rendered: false };
    if (/notion\.so/i.test(host)) return { source_type: 'notion', platform: 'Notion', auth_required: true, transcript_available: null, downloadable: false, js_rendered: true };
    if (/youtube\.com|youtu\.be/i.test(host)) return { source_type: 'youtube', platform: 'YouTube', auth_required: false, transcript_available: true, downloadable: false, js_rendered: true };
    if (/spotify\.com|podcasts\.apple\.com|anchor\.fm/i.test(host)) return { source_type: 'podcast', platform: 'Podcast', auth_required: false, transcript_available: null, downloadable: false, js_rendered: true };
    if (/twitter\.com|x\.com|threads\.net|reddit\.com/i.test(host)) return { source_type: 'social', platform: 'Social', auth_required: false, transcript_available: null, downloadable: false, js_rendered: true };
    if (/\.pdf($|\?)/i.test(u.pathname)) return { source_type: 'pdf', platform: 'Web', auth_required: false, transcript_available: null, downloadable: true, js_rendered: false };
    if (JS_HEAVY_DOMAINS.some(p => p.test(host))) return { source_type: 'webpage_js', platform: u.hostname, auth_required: false, transcript_available: null, downloadable: false, js_rendered: true };
    return { source_type: 'webpage_static', platform: u.hostname, auth_required: false, transcript_available: null, downloadable: false, js_rendered: false };
  } catch {
    return { source_type: 'unknown', platform: 'unknown', auth_required: false, transcript_available: null, downloadable: false, js_rendered: false };
  }
}

interface ExtractionAttempt {
  method: string;
  duration_ms: number;
  chars_extracted: number;
  timeout_hit: boolean;
  auth_wall_detected: boolean;
  http_status: number | null;
  validation_result: 'pass' | 'fail' | 'partial';
  error_category: string | null;
  error_detail: string | null;
}

interface ExtractionResult {
  content: string | null;
  attempt: ExtractionAttempt;
}

async function firecrawlScrape(url: string, apiKey: string, opts: { waitFor?: number; timeout?: number; methodName?: string } = {}): Promise<ExtractionResult> {
  const method = opts.methodName || 'firecrawl_main_content';
  const startMs = Date.now();
  const hardTimeout = opts.timeout || 90_000;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), hardTimeout);
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, ...(opts.waitFor ? { waitFor: opts.waitFor } : {}) }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const durationMs = Date.now() - startMs;
    if (!response.ok) {
      return { content: null, attempt: { method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false, auth_wall_detected: false, http_status: response.status, validation_result: 'fail', error_category: `http_${response.status}`, error_detail: `Firecrawl returned ${response.status}` } };
    }
    const data = await response.json();
    const markdown = (data.data?.markdown || data.markdown || "").slice(0, CONTENT_CAP);
    const authWall = /sign.?in|log.?in|create.?account|access.?denied/i.test(markdown.slice(0, 500)) && markdown.length < 1000;
    return { content: markdown || null, attempt: { method, duration_ms: durationMs, chars_extracted: markdown.length, timeout_hit: false, auth_wall_detected: authWall, http_status: response.status, validation_result: markdown.length > 0 ? (authWall ? 'fail' : 'partial') : 'fail', error_category: authWall ? 'auth_wall' : null, error_detail: authWall ? 'Login/signup wall detected' : null } };
  } catch (e) {
    const durationMs = Date.now() - startMs;
    const isTimeout = e instanceof DOMException && e.name === 'AbortError';
    return { content: null, attempt: { method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: isTimeout, auth_wall_detected: false, http_status: null, validation_result: 'fail', error_category: isTimeout ? 'timeout' : 'network', error_detail: isTimeout ? `Timed out after ${hardTimeout}ms` : (e as Error).message?.slice(0, 200) } };
  }
}

async function firecrawlFullPage(url: string, apiKey: string): Promise<ExtractionResult> {
  const method = 'firecrawl_full_page';
  const startMs = Date.now();
  const hardTimeout = 90_000;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), hardTimeout);
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: false }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const durationMs = Date.now() - startMs;
    if (!response.ok) {
      return { content: null, attempt: { method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: false, auth_wall_detected: false, http_status: response.status, validation_result: 'fail', error_category: `http_${response.status}`, error_detail: `Full-page scrape returned ${response.status}` } };
    }
    const data = await response.json();
    const markdown = (data.data?.markdown || data.markdown || "").slice(0, CONTENT_CAP);
    return { content: markdown || null, attempt: { method, duration_ms: durationMs, chars_extracted: markdown.length, timeout_hit: false, auth_wall_detected: false, http_status: response.status, validation_result: markdown.length > 0 ? 'partial' : 'fail', error_category: null, error_detail: null } };
  } catch (e) {
    const durationMs = Date.now() - startMs;
    const isTimeout = e instanceof DOMException && e.name === 'AbortError';
    return { content: null, attempt: { method, duration_ms: durationMs, chars_extracted: 0, timeout_hit: isTimeout, auth_wall_detected: false, http_status: null, validation_result: 'fail', error_category: isTimeout ? 'timeout' : 'network', error_detail: isTimeout ? 'Timed out' : (e as Error).message?.slice(0, 200) } };
  }
}

function getMethodChain(source: SourceClassification): Array<(url: string, apiKey: string) => Promise<ExtractionResult>> {
  switch (source.source_type) {
    case 'webpage_static': return [
      (u, k) => firecrawlScrape(u, k),
      firecrawlFullPage,
    ];
    case 'webpage_js': return [
      (u, k) => firecrawlScrape(u, k, { waitFor: 10000, timeout: 120_000, methodName: 'firecrawl_js_rendered' }),
      firecrawlFullPage,
      (u, k) => firecrawlScrape(u, k),
    ];
    case 'youtube': return [
      (u, k) => firecrawlScrape(u, k, { waitFor: 8000, timeout: 60_000, methodName: 'firecrawl_youtube' }),
      firecrawlFullPage,
    ];
    case 'pdf': return [(u, k) => firecrawlScrape(u, k), firecrawlFullPage];
    case 'podcast': return [
      (u, k) => firecrawlScrape(u, k, { waitFor: 5000, methodName: 'firecrawl_podcast' }),
      firecrawlFullPage,
    ];
    case 'social': return [(u, k) => firecrawlScrape(u, k), firecrawlFullPage];
    case 'auth_gated': case 'google_doc': case 'notion': return [];
    default: return [(u, k) => firecrawlScrape(u, k)];
  }
}

interface QualityValidation {
  score: number;
  tier: 'complete' | 'shallow' | 'incomplete' | 'failed';
  violations: string[];
  passes: boolean;
  missing_fields: string[];
}

function validateContentQuality(content: string | null): QualityValidation {
  const violations: string[] = [];
  const missingFields: string[] = [];
  const text = content || '';
  const len = text.length;
  let score = 0;

  if (len === 0) { violations.push('No content extracted'); missingFields.push('body_content'); }
  else if (len < MIN_CONTENT_CHARS) { violations.push(`Content too short: ${len} chars`); score += Math.round((len / MIN_CONTENT_CHARS) * 15); }
  else if (len < GOOD_CONTENT_CHARS) { score += 20; }
  else { score += 30; }

  if (len > 0) {
    score += 10;
    if (/^#{1,3}\s/m.test(text) || /\n\n/.test(text)) score += 10; else score += 3;
  }

  if (len > 0) {
    if (text.startsWith('[External Link:') || text.startsWith('[Placeholder')) {
      violations.push('Placeholder stub');
      missingFields.push('real_content');
    } else {
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      const boilerplateLines = lines.filter(line => BOILERPLATE_PATTERNS.some(p => p.test(line)));
      const boilerplateRatio = lines.length > 0 ? boilerplateLines.length / lines.length : 0;
      if (boilerplateRatio > 0.5) { violations.push(`High boilerplate: ${Math.round(boilerplateRatio * 100)}%`); score += 5; }
      else { score += 15; }
      const words = new Set(text.toLowerCase().match(/\b[a-z]{3,}\b/g) || []);
      if (words.size < MIN_UNIQUE_WORDS) { violations.push(`Low vocabulary: ${words.size} unique words`); score += 3; }
      else { score += 15; }
    }
  }

  if (len >= MIN_CONTENT_CHARS) score += 10;
  if (len >= GOOD_CONTENT_CHARS) score += 10;
  else if (len > 0) score += 5;

  let tier: QualityValidation['tier'];
  if (score >= COMPLETE_MIN_SCORE && violations.length === 0) tier = 'complete';
  else if (score >= PARTIAL_MIN_SCORE) tier = 'shallow';
  else if (score >= 10) tier = 'incomplete';
  else tier = 'failed';

  return { score, tier, violations, passes: tier === 'complete', missing_fields: missingFields };
}

type FinalStatus = 'enriched' | 'partial' | 'needs_auth' | 'unsupported' | 'failed';

interface TestResult {
  url: string;
  category: string;
  expected_status: string;
  source_type: SourceType;
  platform: string;
  final_status: FinalStatus;
  method_used: string | null;
  methods_attempted: ExtractionAttempt[];
  attempt_count: number;
  completeness_score: number;
  confidence_score: number;
  extracted_text_length: number;
  validation_passed: boolean;
  failure_reason: string | null;
  recovery_hint: string | null;
  missing_fields: string[];
  status_matches_expected: boolean;
  duration_total_ms: number;
}

async function runTestUrl(
  url: string,
  category: string,
  expectedStatus: string,
  apiKey: string,
): Promise<TestResult> {
  const overallStart = Date.now();
  const source = classifySource(url);
  const attempts: ExtractionAttempt[] = [];

  // Auth-gated — immediate
  if (source.auth_required) {
    return {
      url, category, expected_status: expectedStatus,
      source_type: source.source_type, platform: source.platform,
      final_status: 'needs_auth', method_used: null, methods_attempted: [],
      attempt_count: 0, completeness_score: 0, confidence_score: 0,
      extracted_text_length: 0, validation_passed: false,
      failure_reason: `Auth-gated (${source.platform})`,
      recovery_hint: 'Paste content manually',
      missing_fields: ['body_content'],
      status_matches_expected: expectedStatus === 'needs_auth',
      duration_total_ms: Date.now() - overallStart,
    };
  }

  // No valid URL
  if (!url.startsWith('http')) {
    return {
      url, category, expected_status: expectedStatus,
      source_type: source.source_type, platform: source.platform,
      final_status: 'unsupported', method_used: null, methods_attempted: [],
      attempt_count: 0, completeness_score: 0, confidence_score: 0,
      extracted_text_length: 0, validation_passed: false,
      failure_reason: 'No valid URL', recovery_hint: 'Add a valid HTTP URL',
      missing_fields: ['source_url'],
      status_matches_expected: expectedStatus === 'unsupported',
      duration_total_ms: Date.now() - overallStart,
    };
  }

  const methodChain = getMethodChain(source);
  if (methodChain.length === 0) {
    return {
      url, category, expected_status: expectedStatus,
      source_type: source.source_type, platform: source.platform,
      final_status: 'unsupported', method_used: null, methods_attempted: [],
      attempt_count: 0, completeness_score: 0, confidence_score: 0,
      extracted_text_length: 0, validation_passed: false,
      failure_reason: `No extraction methods for ${source.source_type}`,
      recovery_hint: 'Paste content manually',
      missing_fields: ['body_content'],
      status_matches_expected: expectedStatus === 'unsupported' || expectedStatus === 'needs_auth',
      duration_total_ms: Date.now() - overallStart,
    };
  }

  let bestContent: string | null = null;
  let bestQuality: QualityValidation | null = null;
  let bestMethod: string | null = null;

  for (const extractionMethod of methodChain) {
    const result = await extractionMethod(url, apiKey);
    attempts.push(result.attempt);

    if (result.attempt.auth_wall_detected) {
      return {
        url, category, expected_status: expectedStatus,
        source_type: source.source_type, platform: source.platform,
        final_status: 'needs_auth', method_used: result.attempt.method,
        methods_attempted: attempts, attempt_count: attempts.length,
        completeness_score: 0, confidence_score: 0,
        extracted_text_length: 0, validation_passed: false,
        failure_reason: 'Auth wall detected',
        recovery_hint: 'Paste content manually',
        missing_fields: ['body_content'],
        status_matches_expected: expectedStatus === 'needs_auth',
        duration_total_ms: Date.now() - overallStart,
      };
    }

    if (result.content && result.content.length > 0) {
      const qv = validateContentQuality(result.content);
      result.attempt.validation_result = qv.passes ? 'pass' : (qv.score >= PARTIAL_MIN_SCORE ? 'partial' : 'fail');

      if (qv.passes) {
        bestContent = result.content;
        bestQuality = qv;
        bestMethod = result.attempt.method;
        break;
      }

      if (!bestQuality || qv.score > bestQuality.score) {
        bestContent = result.content;
        bestQuality = qv;
        bestMethod = result.attempt.method;
      }
    }

    if (methodChain.indexOf(extractionMethod) < methodChain.length - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // Evaluate
  if (bestContent && bestQuality && bestQuality.passes) {
    return {
      url, category, expected_status: expectedStatus,
      source_type: source.source_type, platform: source.platform,
      final_status: 'enriched', method_used: bestMethod,
      methods_attempted: attempts, attempt_count: attempts.length,
      completeness_score: bestQuality.score,
      confidence_score: Math.min(100, bestQuality.score + 10),
      extracted_text_length: bestContent.length, validation_passed: true,
      failure_reason: null, recovery_hint: null, missing_fields: [],
      status_matches_expected: expectedStatus === 'enriched',
      duration_total_ms: Date.now() - overallStart,
    };
  }

  if (bestContent && bestQuality && bestQuality.score >= PARTIAL_MIN_SCORE) {
    const failureReason = bestQuality.violations.join('; ') || `Score ${bestQuality.score} < ${COMPLETE_MIN_SCORE}`;
    return {
      url, category, expected_status: expectedStatus,
      source_type: source.source_type, platform: source.platform,
      final_status: 'partial', method_used: bestMethod,
      methods_attempted: attempts, attempt_count: attempts.length,
      completeness_score: bestQuality.score,
      confidence_score: Math.round(bestQuality.score * 0.7),
      extracted_text_length: bestContent.length, validation_passed: false,
      failure_reason: failureReason,
      recovery_hint: 'Review and supplement manually',
      missing_fields: bestQuality.missing_fields,
      status_matches_expected: expectedStatus === 'partial' || expectedStatus === 'enriched',
      duration_total_ms: Date.now() - overallStart,
    };
  }

  // Failed
  const failureReasons = attempts.map(a => a.error_detail || a.error_category).filter(Boolean);
  const primaryReason = failureReasons[0] || 'All methods failed';
  return {
    url, category, expected_status: expectedStatus,
    source_type: source.source_type, platform: source.platform,
    final_status: 'failed', method_used: bestMethod,
    methods_attempted: attempts, attempt_count: attempts.length,
    completeness_score: bestQuality?.score || 0, confidence_score: 0,
    extracted_text_length: bestContent?.length || 0, validation_passed: false,
    failure_reason: primaryReason,
    recovery_hint: 'Paste content manually or try different URL',
    missing_fields: bestQuality?.missing_fields || ['body_content'],
    status_matches_expected: expectedStatus === 'failed',
    duration_total_ms: Date.now() - overallStart,
  };
}

// ── Built-in test dataset ──────────────────────────────────
const BUILT_IN_TESTS = [
  // AUTH-GATED
  { url: 'https://community.circle.so/c/getting-started', category: 'auth_gated', expected_status: 'needs_auth' },
  { url: 'https://courses.teachable.com/courses/enrolled', category: 'auth_gated', expected_status: 'needs_auth' },
  { url: 'https://app.kajabi.com/products', category: 'auth_gated', expected_status: 'needs_auth' },
  { url: 'https://www.skool.com/community', category: 'auth_gated', expected_status: 'needs_auth' },

  // YOUTUBE
  { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', category: 'youtube', expected_status: 'enriched' },
  { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', category: 'youtube', expected_status: 'enriched' },

  // PDF
  { url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', category: 'pdf', expected_status: 'enriched' },

  // JS-HEAVY
  { url: 'https://medium.com/@jeffhaden/the-9-most-important-things-ive-learned-about-productivity-e7dd46b43ba9', category: 'js_heavy', expected_status: 'enriched' },
  { url: 'https://substack.com/home', category: 'js_heavy', expected_status: 'partial' },

  // STATIC WEBPAGES
  { url: 'https://www.paulgraham.com/greatwork.html', category: 'static_webpage', expected_status: 'enriched' },
  { url: 'https://blog.hubspot.com/sales/sales-methodology', category: 'static_webpage', expected_status: 'enriched' },

  // WEAK CONTENT (landing/thin pages)
  { url: 'https://example.com', category: 'weak_content', expected_status: 'partial' },

  // SOCIAL
  { url: 'https://www.reddit.com/r/sales/top/', category: 'social', expected_status: 'enriched' },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: "Firecrawl not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const testUrls: Array<{ url: string; category: string; expected_status: string }> =
      body.test_urls && Array.isArray(body.test_urls) && body.test_urls.length > 0
        ? body.test_urls
        : BUILT_IN_TESTS;

    console.log(`[ValidateEnrichment] Running ${testUrls.length} test cases`);

    const results: TestResult[] = [];
    for (const test of testUrls) {
      console.log(`[Test] ${test.category}: ${test.url.slice(0, 80)}`);
      const result = await runTestUrl(test.url, test.category, test.expected_status, FIRECRAWL_API_KEY);
      results.push(result);
      // Rate limit between tests
      await new Promise(r => setTimeout(r, 2000));
    }

    // Build summary
    const enriched = results.filter(r => r.final_status === 'enriched');
    const partial = results.filter(r => r.final_status === 'partial');
    const needsAuth = results.filter(r => r.final_status === 'needs_auth');
    const unsupported = results.filter(r => r.final_status === 'unsupported');
    const failed = results.filter(r => r.final_status === 'failed');
    const expectedMatches = results.filter(r => r.status_matches_expected);

    const summary = {
      total_tested: results.length,
      enriched: enriched.length,
      partial: partial.length,
      needs_auth: needsAuth.length,
      unsupported: unsupported.length,
      failed: failed.length,
      expected_match_rate: results.length > 0 ? Math.round((expectedMatches.length / results.length) * 100) : 0,
      expected_matches: expectedMatches.length,
      expected_mismatches: results.length - expectedMatches.length,
      fallback_usage_rate: results.length > 0
        ? Math.round((results.filter(r => r.attempt_count > 1).length / results.length) * 100)
        : 0,
      avg_attempts: results.length > 0
        ? Math.round((results.reduce((s, r) => s + r.attempt_count, 0) / results.length) * 100) / 100
        : 0,
      avg_completeness: results.length > 0
        ? Math.round(results.reduce((s, r) => s + r.completeness_score, 0) / results.length)
        : 0,
      avg_confidence: results.length > 0
        ? Math.round(results.reduce((s, r) => s + r.confidence_score, 0) / results.length)
        : 0,
    };

    // Gap analysis
    const gaps = {
      misclassified: results
        .filter(r => !r.status_matches_expected)
        .map(r => ({ url: r.url, category: r.category, expected: r.expected_status, actual: r.final_status, reason: r.failure_reason })),
      low_completeness: results
        .filter(r => r.final_status === 'enriched' && r.completeness_score < COMPLETE_MIN_SCORE)
        .map(r => ({ url: r.url, score: r.completeness_score })),
      single_attempt_tricky: results
        .filter(r => r.attempt_count === 1 && ['js_heavy', 'youtube', 'pdf'].includes(r.category) && r.final_status !== 'enriched')
        .map(r => ({ url: r.url, category: r.category, status: r.final_status })),
      fallback_not_triggered: results
        .filter(r => r.attempt_count <= 1 && r.final_status !== 'enriched' && r.final_status !== 'needs_auth' && r.final_status !== 'unsupported')
        .map(r => ({ url: r.url, category: r.category, status: r.final_status })),
    };

    return new Response(JSON.stringify({ summary, gaps, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("validate-enrichment error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
