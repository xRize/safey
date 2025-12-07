import type { LinkMeta } from '../../shared/types.js';
import { sanitizeForGpt } from '../utils/sanitize.js';

// URL normalization helper (duplicated from analyzer to avoid circular dependency)
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    if (u.pathname.endsWith('/') && u.pathname.length > 1) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  } catch {
    return url;
  }
}

interface HeuristicsResult {
  issues: string[];
  flags: Record<string, boolean>;
}

interface LinkContent {
  title: string;
  text: string;
  url: string;
  statusCode: number;
  error?: string;
}

export interface OllamaAnalysisResult {
  contentRelevance: string;
  followRecommendation: string;
  clickBehavior: string;
  safetyRating: number; // 0-100 scale
  reasoning: string;
}

// Cache for Ollama responses
const ollamaCache = new Map<string, { result: OllamaAnalysisResult; timestamp: number }>();
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

// Ollama availability state
let ollamaAvailable: boolean | null = null;
let ollamaLastCheck: number = 0;
const OLLAMA_CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes

/**
 * Check if Ollama is available and healthy
 */
export async function checkOllamaHealth(): Promise<{ available: boolean; model?: string; error?: string; availableModels?: string[] }> {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'llama2';

  // Skip check if URL is placeholder
  if (!ollamaUrl || ollamaUrl.includes('placeholder')) {
    return { available: false, error: 'Ollama URL not configured' };
  }

  try {
    // Step 1: Check if Ollama service is running
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    let response: Response;
    try {
      response = await fetch(`${ollamaUrl}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        return { available: false, error: 'Ollama connection timeout - is Ollama running?' };
      }
      if (fetchErr.code === 'ECONNREFUSED' || fetchErr.message?.includes('ECONNREFUSED')) {
        return { 
          available: false, 
          error: `Cannot connect to Ollama at ${ollamaUrl}. Make sure Ollama is running.` 
        };
      }
      throw fetchErr;
    }

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { 
        available: false, 
        error: `Ollama API returned status ${response.status}. Is Ollama running?` 
      };
    }

    const data = await response.json() as { models?: Array<{ name: string }> };
    const models = data.models || [];
    const availableModelNames = models.map((m) => m.name);
    
    // Step 2: Check if the configured model is available
    // Try exact match first, then partial match
    let foundModel: string | null = null;
    for (const availableModel of availableModelNames) {
      if (availableModel === model) {
        foundModel = availableModel;
        break;
      }
      // Check if model name starts with the configured model (e.g., "mistral" matches "mistral:7b")
      if (availableModel.startsWith(model + ':') || availableModel.startsWith(model + '-')) {
        foundModel = availableModel;
        break;
      }
    }
    
    if (!foundModel) {
      if (models.length === 0) {
        return { 
          available: false, 
          error: `No models installed in Ollama. Run: ollama pull ${model}`,
          availableModels: []
        };
      }
      return { 
        available: false, 
        error: `Model '${model}' not found. Available models: ${availableModelNames.join(', ')}. Run: ollama pull ${model}`,
        availableModels: availableModelNames
      };
    }

    // Step 3: Test with a simple generate request using the found model
    // Use a longer timeout since models may need to load on first use
    const testController = new AbortController();
    const testTimeoutId = setTimeout(() => testController.abort(), 20000); // 20 second timeout for test (models may load)

    let testResponse: Response;
    try {
      testResponse = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        signal: testController.signal,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: foundModel, // Use the found model name
          prompt: 'Hi', // Minimal prompt
          stream: false,
          options: {
            num_predict: 1, // Just 1 token for quick test
            temperature: 0
          }
        })
      });
    } catch (testErr: any) {
      clearTimeout(testTimeoutId);
      if (testErr.name === 'AbortError') {
        // If model exists in list but test times out, it might be loading
        // Consider it available - the model exists, just needs to load on first use
        ollamaAvailable = true; // Mark as available since model exists
        ollamaLastCheck = Date.now();
        return { 
          available: true, 
          model: foundModel, 
          availableModels: availableModelNames
          // Don't include error - model exists, just loading
        };
      }
      throw testErr;
    }

    clearTimeout(testTimeoutId);

    if (!testResponse.ok) {
      const errorText = await testResponse.text().catch(() => 'Unknown error');
      let errorMsg = `Model '${foundModel}' test failed with status ${testResponse.status}`;
      
      if (testResponse.status === 404) {
        errorMsg = `Model '${foundModel}' not found (404). Available models: ${availableModelNames.join(', ')}. Run: ollama pull ${model}`;
      } else if (testResponse.status === 500) {
        // 500 might mean model is loading or corrupted
        // If model exists in list, consider it available but warn
        console.warn(`⚠️  Model '${foundModel}' returned 500 - may be loading. Will retry on first use.`);
        ollamaAvailable = true;
        ollamaLastCheck = Date.now();
        return { 
          available: true, 
          model: foundModel, 
          availableModels: availableModelNames,
          error: 'Model test returned 500 but model exists - may be loading'
        };
      }
      
      return { 
        available: false, 
        error: errorMsg,
        availableModels: availableModelNames
      };
    }

    // Success - mark as available
    ollamaAvailable = true;
    ollamaLastCheck = Date.now();
    return { available: true, model: foundModel, availableModels: availableModelNames };
  } catch (err: any) {
    ollamaAvailable = false;
    ollamaLastCheck = Date.now();
    
    if (err.name === 'AbortError') {
      return { available: false, error: 'Ollama connection timeout' };
    }
    
    return { 
      available: false, 
      error: err.message || 'Failed to connect to Ollama' 
    };
  }
}

/**
 * Get cached Ollama availability status or check if needed
 */
export async function isOllamaAvailable(): Promise<boolean> {
  const now = Date.now();
  
  // Use cached result if recent
  if (ollamaAvailable !== null && (now - ollamaLastCheck) < OLLAMA_CHECK_INTERVAL) {
    return ollamaAvailable;
  }

  // Check Ollama health
  const health = await checkOllamaHealth();
  return health.available;
}

/**
 * Fetch content from a URL (with timeout and size limits)
 */
export async function fetchLinkContent(url: string): Promise<LinkContent> {
  try {
    // No timeout - let content fetch complete fully for larger context windows
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SmartTrust/1.0; +https://smarttrust.example.com)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    } as RequestInit);

    if (!response.ok) {
      return {
        title: '',
        text: '',
        url: response.url || url,
        statusCode: response.status,
        error: `HTTP ${response.status}`
      };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return {
        title: '',
        text: '',
        url: response.url || url,
        statusCode: response.status,
        error: 'Not HTML content'
      };
    }

    let html = await response.text();
    
    // Process full HTML content (limit to 1MB to allow larger context windows)
    const maxHtmlSize = 1000000; // 1MB limit for larger context
    html = html.slice(0, maxHtmlSize);
    
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    
    // Extract text content intelligently - prioritize important content
    // Remove scripts, styles, and other non-content elements
    let textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '') // Remove navigation
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '') // Remove footer
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '') // Remove header (keep title separately)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Increase content limit for larger context window
    // Keep up to 15000 chars for comprehensive analysis
    const maxContentLength = 15000;
    if (textContent.length > maxContentLength) {
      // Keep first 10000 chars (most important) + last 5000 chars (summary/conclusion)
      const firstPart = textContent.slice(0, 10000);
      const lastPart = textContent.slice(-5000);
      textContent = `${firstPart} ... [content truncated] ... ${lastPart}`;
    }

    return {
      title: sanitizeForGpt(title),
      text: sanitizeForGpt(textContent),
      url: response.url || url,
      statusCode: response.status
    };
  } catch (err: any) {
    return {
      title: '',
      text: '',
      url: url,
      statusCode: 0,
      error: err.message || 'Failed to fetch'
    };
  }
}

/**
 * Call Ollama API for analysis
 */
async function callOllama(prompt: string): Promise<string | null> {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'llama2';

  // Availability check removed - should be checked before calling this function
  // This prevents redundant checks when called from analyzeSuspiciousLink
  
  console.log(`[Ollama API] Making API call to ${ollamaUrl} with model ${model}`);

  try {
    // No timeout - let the model process fully without interruption
    // Large context windows need time to process, timeouts cause failures

    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.2, // Lower temperature for more consistent JSON output
          top_p: 0.9,
          num_predict: 2000 // Increased for comprehensive analysis
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
    }

    // Get raw response text
    const responseText = await response.text();
    
    // Check if response is empty
    if (!responseText || responseText.trim().length === 0) {
      console.warn(`[Ollama API] Response body is empty - may be temporary`);
      // Don't mark unavailable - might be temporary issue
      return null;
    }
    
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch (parseErr: any) {
      console.error(`[Ollama API] Failed to parse JSON response: ${parseErr.message}`);
      console.error(`[Ollama API] Response preview: ${responseText.slice(0, 200)}...`);
      // Don't mark unavailable - parsing error might be due to model output format
      throw new Error(`Invalid JSON response from Ollama: ${parseErr.message}`);
    }
    
    // Check for error in response
    if (data.error) {
      console.error(`[Ollama API] Error in response: ${data.error}`);
      // Only mark unavailable for critical errors (model not found, etc.)
      if (data.error.includes('model') || data.error.includes('not found')) {
        ollamaAvailable = false;
        ollamaLastCheck = Date.now();
      }
      throw new Error(`Ollama API returned error: ${data.error}`);
    }
    
    // Extract response field (Ollama API standard when stream: false)
    const result = data.response || data.text || data.content || null;
    
    // Mark as available on success
    ollamaAvailable = true;
    ollamaLastCheck = Date.now();
    
    if (!result) {
      console.warn(`[Ollama API] Response is empty or null`);
      if (data.done === false) {
        console.warn(`[Ollama API] Generation not complete (done: false)`);
      }
      return null;
    }
    
    console.log(`[Ollama API] Successfully got response (${result.length} chars)`);
    
    return result;
  } catch (err: any) {
    // Only mark unavailable on actual connection/API errors
    // No timeout errors since we removed timeouts
    if (err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch failed')) {
      console.error(`[Ollama API] Connection error: ${err.message}`);
      ollamaAvailable = false;
      ollamaLastCheck = Date.now();
    } else {
      console.error(`[Ollama API] Error: ${err.message || err}`);
      // Don't mark unavailable for other errors - might be temporary
    }
    return null;
  }
}

/**
 * Analyze suspicious link with Ollama
 * This is the streamlined process for suspicious/untrusted links only
 */
export async function analyzeSuspiciousLink(
  link: LinkMeta,
  sourcePageContext: string,
  heuristics: HeuristicsResult,
  trustScore: number,
  sourceDomain?: string
): Promise<OllamaAnalysisResult | null> {
  // Check if Ollama is configured
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  if (!ollamaUrl || ollamaUrl.includes('placeholder')) {
    console.debug('Ollama not configured - skipping AI analysis');
    return null;
  }

  // Check cache first (before availability check to avoid redundant calls)
  // Use URL-only cache key (trustScore can vary, causing unnecessary re-analysis)
  const normalizedUrl = normalizeUrl(link.href);
  const cacheKey = normalizedUrl;
  const cached = ollamaCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[Ollama] Using cached result for: ${link.href}`);
    return cached.result;
  }

  // Check if Ollama is available (only if not cached)
  const available = await isOllamaAvailable();
  if (!available) {
    console.debug('Ollama not available - skipping AI analysis');
    return null;
  }

  try {
    // Step 1: Fetch the actual content of the link
    const originalUrl = link.href; // Preserve original URL
    console.log(`[Ollama] Analyzing: ${originalUrl}`);
    const linkContent = await fetchLinkContent(originalUrl);
    
    // Log redirect if occurred
    if (linkContent.url && linkContent.url !== originalUrl) {
      console.log(`[Ollama] Redirect detected: ${originalUrl} -> ${linkContent.url}`);
    }

    if (linkContent.error || !linkContent.text) {
      return {
        contentRelevance: 'Could not fetch link content',
        followRecommendation: 'Unable to analyze - content not accessible',
        clickBehavior: 'Unknown - content fetch failed',
        safetyRating: Math.max(0, Math.min(100, trustScore * 100 - 20)), // Penalize for fetch failure
        reasoning: `Failed to fetch content: ${linkContent.error || 'Unknown error'}`
      };
    }

    // Step 2: Create comprehensive analysis prompt with larger context window
    // Use full content for better analysis quality
    const fullLinkContent = sanitizeForGpt(linkContent.text); // Already optimized in fetchLinkContent
    // Use larger source context for better understanding
    const optimizedSourceContext = sanitizeForGpt(sourcePageContext || '').slice(0, 5000);
    const allIssues = heuristics.issues.length > 0 ? heuristics.issues.join('; ') : 'None';
    
    // Extract source page domain from context if available, or use provided sourceDomain
    let extractedSourceDomain = 'Unknown';
    if (sourceDomain) {
      extractedSourceDomain = sourceDomain;
    } else if (sourcePageContext) {
      const sourceDomainMatch = sourcePageContext.match(/Page Domain:\s*([^\n]+)/i);
      if (sourceDomainMatch) {
        extractedSourceDomain = sourceDomainMatch[1].trim();
      }
    }
    const linkDomain = new URL(link.href).hostname;
    const isSameDomain = extractedSourceDomain !== 'Unknown' && 
                         (extractedSourceDomain === linkDomain || 
                          linkDomain.endsWith('.' + extractedSourceDomain) ||
                          extractedSourceDomain.endsWith('.' + linkDomain));
    
    // Improved prompt emphasizing source page context and relevance
    const prompt = `You are a cybersecurity analyst. Analyze this link in the context of the SOURCE PAGE where the user is currently browsing. Return ONLY valid JSON, no other text.

CRITICAL: Consider the SOURCE PAGE context when evaluating the link. A link that is safe on the official website (e.g., "Buy WinRAR" on winrar.com) may be suspicious on other websites.

REQUIRED JSON FORMAT:
{
  "contentRelevance": "Brief 1-2 sentence description of what the link leads to and how it relates to the source page",
  "followRecommendation": "SAFE_TO_FOLLOW" or "CAUTION_ADVISED" or "AVOID",
  "clickBehavior": "Brief description of what happens when user clicks (1 sentence)",
  "safetyRating": 75,
  "reasoning": "2-3 sentence assessment considering: (1) Is this link relevant to the source page? (2) Does it make sense in this context? (3) Is the source page the official/legitimate site for this link?"
}

SOURCE PAGE CONTEXT (where user is browsing):
${optimizedSourceContext}

LINK TO ANALYZE:
- Link URL: ${sanitizeForGpt(link.href)}
- Link Domain: ${linkDomain}
- Link Text: ${sanitizeForGpt(link.text)}
- Target Page Title: ${linkContent.title || 'No title'}
- Target Page Full Content: ${fullLinkContent}

ANALYSIS CONTEXT:
- Source Domain: ${extractedSourceDomain}
- Link Domain: ${linkDomain}
- Domain Match: ${isSameDomain ? 'YES - Same domain (link is on the same site as source page)' : 'NO - Different domain'}
- Current Trust Score: ${(trustScore * 100).toFixed(0)}%
- Security Issues Detected: ${allIssues}

EVALUATION CRITERIA:
1. If source page and link are on the same domain (e.g., both on winrar.com), links like "Buy WinRAR" are SAFE_TO_FOLLOW
2. If source page is the official website for the product/service, purchase/download links are typically SAFE_TO_FOLLOW
3. If link appears on unrelated third-party sites, be more cautious (CAUTION_ADVISED or AVOID)
4. Consider if the link makes logical sense in the context of the source page content

Return ONLY the JSON object, no markdown, no code blocks, no explanations.`;

    // Step 3: Call Ollama API
    const response = await callOllama(prompt);
    if (!response) {
      console.warn(`[Ollama] Empty response - using heuristic/external check results`);
      return null;
    }

    // Step 4: Parse JSON response - optimized strategies (improved prompt should produce cleaner JSON)
    let result: OllamaAnalysisResult | null = null;
    
    // Strategy 1: Try parsing the entire response (most common with improved prompt)
    try {
      const parsed = JSON.parse(response.trim());
      if (parsed && typeof parsed === 'object') {
        result = parsed as OllamaAnalysisResult;
      }
    } catch (parseErr: any) {
      // Strategy 2: Extract JSON from code blocks (if model wraps in markdown)
      const codeBlockMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        try {
          const parsed = JSON.parse(codeBlockMatch[1]);
          if (parsed && typeof parsed === 'object') {
            result = parsed as OllamaAnalysisResult;
          }
        } catch (parseErr2: any) {
          // Strategy 3: Find JSON object boundaries (fallback)
          const jsonStart = response.indexOf('{');
          const jsonEnd = response.lastIndexOf('}');
          if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
            try {
              const cleaned = response.substring(jsonStart, jsonEnd + 1);
              const parsed = JSON.parse(cleaned);
              if (parsed && typeof parsed === 'object') {
                result = parsed as OllamaAnalysisResult;
              }
            } catch (parseErr3: any) {
              console.warn(`[Ollama] All JSON parsing strategies failed`);
            }
          }
        }
      } else {
        // Try finding JSON object if no code blocks
        const jsonStart = response.indexOf('{');
        const jsonEnd = response.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          try {
            const cleaned = response.substring(jsonStart, jsonEnd + 1);
            const parsed = JSON.parse(cleaned);
            if (parsed && typeof parsed === 'object') {
              result = parsed as OllamaAnalysisResult;
            }
          } catch (parseErr3: any) {
            console.warn(`[Ollama] JSON parsing failed: ${parseErr.message}`);
          }
        }
      }
    }
    
    if (!result) {
      console.error('[Ollama] Could not parse JSON from response after all strategies');
      console.error('[Ollama] Response preview:', response.slice(0, 500));
      // Return a fallback response instead of throwing
      // Determine category from trustScore
      const fallbackCategory = trustScore < 0.4 ? 'DANGEROUS' : trustScore < 0.7 ? 'SUSPICIOUS' : 'SAFE';
      return {
        contentRelevance: 'AI analysis completed but response format was invalid. Using heuristic analysis.',
        followRecommendation: fallbackCategory === 'DANGEROUS' ? 'AVOID' : 'CAUTION_ADVISED',
        clickBehavior: 'Could not determine click behavior from AI response',
        safetyRating: Math.round(trustScore * 100),
        reasoning: `AI response parsing failed. Trust score: ${(trustScore * 100).toFixed(0)}% based on heuristics.`
      };
    }
    
    // Validate parsed result structure

    // Validate and normalize safety rating
    if (typeof result.safetyRating !== 'number' || isNaN(result.safetyRating)) {
      console.warn('Invalid safetyRating, using trustScore:', result.safetyRating);
      result.safetyRating = Math.round(trustScore * 100);
    }
    result.safetyRating = Math.max(0, Math.min(100, Math.round(result.safetyRating)));

    // Validate and normalize other fields
    if (!result.contentRelevance || typeof result.contentRelevance !== 'string') {
      result.contentRelevance = 'Content analysis unavailable - could not determine relevance';
    } else {
      result.contentRelevance = result.contentRelevance.trim().slice(0, 500);
    }
    
    if (!result.followRecommendation || typeof result.followRecommendation !== 'string') {
      result.followRecommendation = 'CAUTION_ADVISED';
    } else {
      // Normalize recommendation
      const rec = result.followRecommendation.toUpperCase().trim();
      if (rec.includes('SAFE') || rec.includes('FOLLOW')) {
        result.followRecommendation = 'SAFE_TO_FOLLOW';
      } else if (rec.includes('AVOID') || rec.includes('DANGER')) {
        result.followRecommendation = 'AVOID';
      } else {
        result.followRecommendation = 'CAUTION_ADVISED';
      }
    }
    
    if (!result.clickBehavior || typeof result.clickBehavior !== 'string') {
      result.clickBehavior = 'Unknown behavior - could not determine click behavior';
    } else {
      result.clickBehavior = result.clickBehavior.trim().slice(0, 300);
    }
    
    if (!result.reasoning || typeof result.reasoning !== 'string') {
      result.reasoning = 'Analysis incomplete - could not generate reasoning';
    } else {
      result.reasoning = result.reasoning.trim().slice(0, 500);
    }

    // Cache result using normalized URL as key
    ollamaCache.set(cacheKey, { result, timestamp: Date.now() });
    console.log(`[Ollama] Analysis complete and cached for: ${originalUrl}`);
    
    // Verify link.href hasn't been mutated
    if (link.href !== originalUrl) {
      console.error(`[Ollama] WARNING: link.href was mutated! Original: ${originalUrl}, Current: ${link.href}`);
    }

    return result;
  } catch (err: any) {
    console.error(`[Ollama] Analysis error for ${link.href}:`, err);
    console.error(`[Ollama] Error stack:`, err.stack);
    return null;
  }
}

