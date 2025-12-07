import type { LinkMeta, LinkAnalysis, TrustVerdict } from '../../shared/types.js';
import { calculateHeuristics, isTrustedDomain } from './heuristics.js';
import { getGptAnalysis } from './gpt.js';
import { checkExternalServices, AggregatedCheckResult } from './externalCheckers.js';
import { analyzeSuspiciousLink, type OllamaAnalysisResult } from './ollama.js';
import { pool } from '../db/index.js';
import { hasExtensionMarker } from '../utils/sanitize.js';

// Cache TTL: use cached results if scanned within this time (24 hours)
const CACHE_TTL_HOURS = 24;
const CACHE_TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000;

/**
 * Normalize URL for consistent caching (remove trailing slashes, fragments, etc.)
 */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Remove fragment, normalize path
    u.hash = '';
    if (u.pathname.endsWith('/') && u.pathname.length > 1) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  } catch {
    return url;
  }
}

/**
 * Get cached scan result from database
 */
async function getCachedScan(url: string): Promise<LinkAnalysis | null> {
  try {
    const normalizedUrl = normalizeUrl(url);
    const cacheCutoff = new Date(Date.now() - CACHE_TTL_MS);
    
    const result = await pool.query(
      `SELECT url, link_text, detected_issues, trust_score, gpt_summary, 
              ollama_analysis, external_checks, recommendation, risk_tags, 
              confidence, category, created_at
       FROM link_scans
       WHERE url = $1 AND created_at > $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [normalizedUrl, cacheCutoff]
    );
    
    if (result.rows.length > 0) {
      const row = result.rows[0];
      console.log(`[Cache] Found cached result for ${url} (from ${row.created_at})`);
      
      // Reconstruct verdict from database
      const verdict: TrustVerdict = {
        trustScore: parseFloat(row.trust_score),
        category: row.category,
        issues: row.detected_issues || [],
        gptSummary: row.gpt_summary || undefined,
        recommendation: row.recommendation || undefined,
        riskTags: row.risk_tags || undefined,
        confidence: row.confidence ? parseFloat(row.confidence) : undefined
      };
      
      // Reconstruct link metadata
      const link: LinkMeta = {
        href: row.url,
        text: row.link_text || '',
        targetDomain: new URL(row.url).hostname
      };
      
      return { link, verdict };
    }
    
    return null;
  } catch (err) {
    console.error(`[Cache] Error retrieving cached scan for ${url}:`, err);
    return null;
  }
}

/**
 * Batch get cached scans for multiple URLs
 */
async function getCachedScans(urls: string[]): Promise<Map<string, LinkAnalysis>> {
  const cached = new Map<string, LinkAnalysis>();
  
  if (urls.length === 0) return cached;
  
  try {
    const normalizedUrls = urls.map(normalizeUrl);
    const cacheCutoff = new Date(Date.now() - CACHE_TTL_MS);
    
    const result = await pool.query(
      `SELECT url, link_text, detected_issues, trust_score, gpt_summary, 
              ollama_analysis, external_checks, recommendation, risk_tags, 
              confidence, category, created_at
       FROM link_scans
       WHERE url = ANY($1::text[]) AND created_at > $2
       ORDER BY url, created_at DESC`,
      [normalizedUrls, cacheCutoff]
    );
    
    // Group by URL (take most recent for each)
    const urlMap = new Map<string, any>();
    for (const row of result.rows) {
      if (!urlMap.has(row.url)) {
        urlMap.set(row.url, row);
      }
    }
    
    // Convert to LinkAnalysis format
    for (const [url, row] of urlMap) {
      const verdict: TrustVerdict = {
        trustScore: parseFloat(row.trust_score),
        category: row.category,
        issues: row.detected_issues || [],
        gptSummary: row.gpt_summary || undefined,
        recommendation: row.recommendation || undefined,
        riskTags: row.risk_tags || undefined,
        confidence: row.confidence ? parseFloat(row.confidence) : undefined
      };
      
      const link: LinkMeta = {
        href: row.url,
        text: row.link_text || '',
        targetDomain: new URL(row.url).hostname
      };
      
      cached.set(url, { link, verdict });
      console.log(`[Cache] Found cached result for ${url}`);
    }
    
    console.log(`[Cache] Retrieved ${cached.size} cached results out of ${urls.length} URLs`);
  } catch (err) {
    console.error('[Cache] Error batch retrieving cached scans:', err);
  }
  
  return cached;
}

/**
 * Analyze links with AI in parallel, prioritizing clicked links
 * Returns initial results immediately, then processes AI analysis in parallel batches in the background
 */
export async function analyzeLinksWithAI(
  links: LinkMeta[],
  domain: string,
  userId?: string,
  sourcePageContext?: string,
  priorityUrl?: string,
  onUpdate?: (analysis: LinkAnalysis, index: number) => void
): Promise<LinkAnalysis[]> {
  
  // Step 0: Filter out links with extension markers (already processed)
  const filteredLinks: Array<{ link: LinkMeta; originalIndex: number }> = [];
  for (let i = 0; i < links.length; i++) {
    if (!hasExtensionMarker(links[i].text)) {
      filteredLinks.push({ link: links[i], originalIndex: i });
    } else {
      console.log(`[Analyze] Skipping link with extension marker: ${links[i].href}`);
    }
  }
  
  if (filteredLinks.length === 0) {
    console.log(`[Analyze] All links filtered out (already processed)`);
    return links.map(link => ({
      link,
      verdict: {
        trustScore: 0.5,
        category: 'SAFE' as const,
        issues: [],
        confidence: 0.5
      }
    }));
  }
  
  // Step 0.5: Check database cache first (batch lookup for efficiency)
  const urls = filteredLinks.map(({ link }) => normalizeUrl(link.href));
  const cachedScans = await getCachedScans(urls);
  const analyses: LinkAnalysis[] = new Array(links.length); // Pre-allocate for original indices
  const linksToAnalyze: Array<{ link: LinkMeta; index: number; originalIndex: number }> = [];
  
  // Separate cached vs uncached links
  for (let i = 0; i < filteredLinks.length; i++) {
    const { link, originalIndex } = filteredLinks[i];
    const normalizedUrl = normalizeUrl(link.href);
    const cached = cachedScans.get(normalizedUrl);
    
    if (cached) {
      analyses[originalIndex] = cached;
    } else {
      linksToAnalyze.push({ link, index: i, originalIndex });
    }
  }
  
  if (linksToAnalyze.length === 0) {
    console.log(`[Analyze] All ${links.length} links found in cache`);
    return analyses;
  }
  
  console.log(`[Analyze] ${cachedScans.size} cached, ${linksToAnalyze.length} need analysis`);
  
  // Step 1: Calculate heuristics for uncached links only
  const heuristicsResults = linksToAnalyze.map(({ link }) => ({
    link,
    heuristics: calculateHeuristics(link)
  }));
  
  // Step 2: Check uncached links with external services in parallel (skip for trusted domains)
  const externalCheckResults = await Promise.all(
    linksToAnalyze.map(async ({ link }) => {
      // Skip external checks for trusted domains (they're already safe)
      if (isTrustedDomain(link.targetDomain)) {
        return {
          safe: true,
          confidence: 1.0,
          sources: [],
          threatCount: 0
        } as AggregatedCheckResult;
      }
      
      try {
        return await checkExternalServices(link);
      } catch (err) {
        console.error(`External check failed for ${link.href}:`, err);
        return {
          safe: true,
          confidence: 0.5,
          sources: [],
          threatCount: 0
        } as AggregatedCheckResult;
      }
    })
  );
  
  // Step 3: Create initial verdicts (heuristics + external checks) - return immediately
  // Deduplicate by normalized URL to avoid processing same link multiple times
  const seenUrls = new Set<string>();
  const urlToAnalysisItem = new Map<string, {
    link: LinkMeta;
    heuristics: ReturnType<typeof calculateHeuristics>;
    externalResult: AggregatedCheckResult;
    trustScore: number;
    category: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS';
    verdict: TrustVerdict;
    originalIndices: number[]; // Track all original indices for this URL
  }>();
  
  const aiAnalysisQueue: Array<{
    link: LinkMeta;
    heuristics: ReturnType<typeof calculateHeuristics>;
    externalResult: AggregatedCheckResult;
    trustScore: number;
    category: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS';
    verdict: TrustVerdict;
    originalIndices: number[]; // All indices that map to this URL
  }> = [];
  
  for (let j = 0; j < linksToAnalyze.length; j++) {
    const { link, originalIndex } = linksToAnalyze[j];
    const heuristics = heuristicsResults[j].heuristics;
    const externalResult = externalCheckResults[j];
    
    // Deduplicate by normalized URL
    const normalizedUrl = normalizeUrl(link.href);
    
    // Speed optimization: Skip AI and external checks for trusted domains
    const isTrusted = isTrustedDomain(link.targetDomain);
    
    let verdict: TrustVerdict;
    
    if (isTrusted) {
      // Trusted domain - mark as SAFE immediately, skip all checks
      verdict = {
        trustScore: 1.0,
        category: 'SAFE',
        issues: [],
        confidence: 1.0,
        gptSummary: '✅ Trusted domain - No analysis needed. This is a renowned, safe website.'
      };
      analyses[originalIndex] = { link, verdict };
      continue; // Skip to next link
    }
    
    // Combine heuristics and external checks for non-trusted domains
    let trustScore = calculateTrustScore(heuristics, externalResult);
    let category = categorizeTrust(trustScore);
    
    // Merge issues from external checks
    const allIssues = [...heuristics.issues];
    if (externalResult.threatCount > 0) {
      allIssues.push(`external_threats: ${externalResult.threatCount} service(s) flagged this URL`);
    }
    externalResult.sources.forEach(source => {
      if (!source.safe && source.details) {
        allIssues.push(`${source.source.toLowerCase()}: ${source.details}`);
      }
    });
    
    verdict = {
      trustScore,
      category,
      issues: allIssues,
      confidence: Math.max(0.7, externalResult.confidence)
    };
    
    // Store initial analysis (return immediately)
    analyses[originalIndex] = { link, verdict };
    
    // Speed optimization: Fast-check - skip AI for obviously dangerous/safe links
    // If trust score is very low (< 0.2) and external checks confirm danger, skip AI
    const isObviouslyDangerous = trustScore < 0.2 && externalResult.threatCount > 0;
    // More aggressive safe detection: if trust score is high (> 0.8) and no issues, skip AI
    const isObviouslySafe = (trustScore > 0.8 && allIssues.length === 0) || 
                           (trustScore > 0.85 && externalResult.safe && externalResult.confidence > 0.8);
    
    // Queue for AI analysis (skip obviously dangerous/safe links for speed)
    const allowAIWithoutAuth = process.env.ALLOW_AI_WITHOUT_AUTH === 'true';
    const shouldRunAI = (userId || allowAIWithoutAuth) && !isObviouslyDangerous && !isObviouslySafe;
    
    if (shouldRunAI) {
      // Check if we've already seen this URL (deduplicate)
      if (seenUrls.has(normalizedUrl)) {
        // This is a duplicate - add to existing item's indices
        const existingItem = urlToAnalysisItem.get(normalizedUrl);
        if (existingItem) {
          existingItem.originalIndices.push(originalIndex);
        }
      } else {
        // First occurrence of this URL - add to queue
        seenUrls.add(normalizedUrl);
        const queueItem = {
          link,
          heuristics,
          externalResult,
          trustScore,
          category,
          verdict,
          originalIndices: [originalIndex]
        };
        urlToAnalysisItem.set(normalizedUrl, queueItem);
        aiAnalysisQueue.push(queueItem);
      }
    } else if (isObviouslyDangerous) {
      // Add a note that AI was skipped for speed
      verdict.gptSummary = '⚠️ High risk detected by security checks. AI analysis skipped for faster response.';
    } else if (isObviouslySafe) {
      // Add a note that link is clearly safe
      verdict.gptSummary = '✅ Link verified as safe by multiple security services.';
    }
  }
  
  // Step 4: Process AI analysis sequentially (one at a time) in the background
  // Sequential processing prevents weird/unfilterable responses from parallel requests
  if (aiAnalysisQueue.length > 0) {
    // Separate priority (clicked) link from others
    const priorityIndex = priorityUrl 
      ? aiAnalysisQueue.findIndex(item => normalizeUrl(item.link.href) === normalizeUrl(priorityUrl))
      : -1;
    
    const priorityItem = priorityIndex >= 0 ? aiAnalysisQueue.splice(priorityIndex, 1)[0] : null;
    const regularItems = aiAnalysisQueue;
    
    // Process AI analysis sequentially in background (fire and forget, but with callbacks for updates)
    (async () => {
      // Process priority link first (if exists)
      if (priorityItem) {
        console.log(`[AI] Processing priority link: ${priorityItem.link.href}`);
        await processAIAnalysis(priorityItem, userId || undefined, sourcePageContext || '', domain);
        // Update all analyses that map to this URL (handle duplicates)
        const updatedAnalysis: LinkAnalysis = {
          link: priorityItem.link,
          verdict: priorityItem.verdict
        };
        for (const idx of priorityItem.originalIndices) {
          analyses[idx] = updatedAnalysis;
          if (onUpdate) {
            onUpdate(updatedAnalysis, idx);
          }
        }
      }
      
      // Process remaining links sequentially (one at a time) to avoid response issues
      for (let i = 0; i < regularItems.length; i++) {
        const item = regularItems[i];
        console.log(`[AI] Processing link ${i + 1}/${regularItems.length}: ${item.link.href} (${item.originalIndices.length} occurrence(s))`);
        
        try {
          await processAIAnalysis(item, userId || undefined, sourcePageContext || '', domain);
          // Update all analyses that map to this URL (handle duplicates)
          const updatedAnalysis: LinkAnalysis = {
            link: item.link,
            verdict: item.verdict
          };
          for (const idx of item.originalIndices) {
            analyses[idx] = updatedAnalysis;
            if (onUpdate) {
              onUpdate(updatedAnalysis, idx);
            }
          }
        } catch (err) {
          console.error(`[AI] Error processing link ${item.link.href}:`, err);
          // Continue with next link even if one fails
        }
      }
    })().catch(err => {
      console.error('[AI] Background AI processing error:', err);
    });
  }
  
  // Fill in any gaps (for links that were filtered out or had errors)
  for (let i = 0; i < links.length; i++) {
    if (!analyses[i]) {
      // If link was filtered out due to extension marker, return a safe default
      if (hasExtensionMarker(links[i].text)) {
        analyses[i] = {
          link: links[i],
          verdict: {
            trustScore: 0.5,
            category: 'SAFE',
            issues: [],
            confidence: 0.5,
            gptSummary: 'Link already processed by extension'
          }
        };
      } else {
        // Error case - create basic analysis
        const link = links[i];
        const heuristics = calculateHeuristics(link);
        const trustScore = calculateTrustScore(heuristics);
        analyses[i] = {
          link,
          verdict: {
            trustScore,
            category: categorizeTrust(trustScore),
            issues: heuristics.issues,
            confidence: 0.5
          }
        };
      }
    }
  }
  
  // Return initial results immediately (before AI processing completes)
  return analyses;
}

/**
 * Process AI analysis for a single link
 */
async function processAIAnalysis(
  item: {
    link: LinkMeta;
    heuristics: ReturnType<typeof calculateHeuristics>;
    externalResult: AggregatedCheckResult;
    trustScore: number;
    category: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS';
    verdict: TrustVerdict;
    originalIndices?: number[]; // All indices that map to this URL (for deduplication)
    originalIndex?: number; // Keep for backward compatibility
  },
  userId: string | undefined,
  sourcePageContext: string,
  domain: string
): Promise<void> {
  const { link, heuristics, externalResult, verdict } = item;
  let { trustScore, category } = item;
  
  // Preserve original URL to prevent mutation issues
  const originalLinkUrl = link.href;
  
  // Check user plan if needed
  const allowAIWithoutAuth = process.env.ALLOW_AI_WITHOUT_AUTH === 'true';
  if (userId && !allowAIWithoutAuth) {
    const user = await getUserPlan(userId);
    if (!user || (user.plan !== 'premium' && user.plan !== 'trial')) {
      return; // Skip AI analysis
    }
  }
  
  try {
    // Extract source domain for better context
    const sourceDomainForAnalysis = domain || (sourcePageContext ? 
      sourcePageContext.match(/Page Domain:\s*([^\n]+)/i)?.[1]?.trim() : undefined);
    
    const ollamaResult = await analyzeSuspiciousLink(
      link,
      sourcePageContext || link.contextSnippet || '',
      heuristics,
      trustScore,
      sourceDomainForAnalysis
    );
    
    if (ollamaResult) {
      const aiTrustScore = ollamaResult.safetyRating / 100;
      
      // Update trust score and category based on AI recommendation
      if (ollamaResult.followRecommendation === 'SAFE_TO_FOLLOW') {
        trustScore = Math.max(0.7, Math.min(1.0, aiTrustScore));
        category = 'SAFE';
      } else if (ollamaResult.followRecommendation === 'AVOID') {
        trustScore = Math.min(0.3, Math.max(0, aiTrustScore));
        category = 'DANGEROUS';
      } else if (ollamaResult.followRecommendation === 'CAUTION_ADVISED') {
        trustScore = Math.max(0.4, Math.min(0.69, aiTrustScore));
        category = 'SUSPICIOUS';
      } else {
        trustScore = aiTrustScore * 0.6 + trustScore * 0.4;
        category = categorizeTrust(trustScore);
      }
      
      // Update verdict
      verdict.trustScore = trustScore;
      verdict.category = category;
      
      console.log(`[AI] ${link.href}: ${category} (score: ${trustScore.toFixed(2)})`);
      
      // Format AI summary
      const aiSummaryParts: string[] = [];
      if (ollamaResult.contentRelevance) {
        aiSummaryParts.push(`📄 Content Relevance: ${ollamaResult.contentRelevance}`);
      }
      if (ollamaResult.clickBehavior) {
        aiSummaryParts.push(`🖱️ Click Behavior: ${ollamaResult.clickBehavior}`);
      }
      if (ollamaResult.reasoning) {
        aiSummaryParts.push(`💭 Reasoning: ${ollamaResult.reasoning}`);
      }
      if (ollamaResult.followRecommendation) {
        const recText = ollamaResult.followRecommendation === 'SAFE_TO_FOLLOW' ? '✅ Safe to Follow' :
                       ollamaResult.followRecommendation === 'AVOID' ? '❌ Avoid' :
                       '⚠️ Proceed with Caution';
        aiSummaryParts.push(`\n${recText}`);
      }
      
      verdict.gptSummary = aiSummaryParts.join('\n\n');
      verdict.recommendation = ollamaResult.followRecommendation;
      verdict.riskTags = [
        ollamaResult.followRecommendation === 'AVOID' ? 'high_risk' : 
        ollamaResult.followRecommendation === 'CAUTION_ADVISED' ? 'moderate_risk' : 'low_risk'
      ];
      verdict.confidence = 0.85;
      
      // Store in database - ensure we use the original URL
      const linkForStorage: LinkMeta = {
        ...link,
        href: originalLinkUrl
      };
      storeScanResult(userId || null, linkForStorage, verdict, externalResult, ollamaResult).catch(console.error);
    }
  } catch (err: any) {
    // Log error but don't throw - continue with heuristic/external check results
    console.warn(`[AI] Analysis failed for ${link.href}: ${err.message || err}. Continuing with heuristic/external check results.`);
    // Optionally add a note to the verdict that AI analysis was unavailable
    if (!verdict.gptSummary) {
      verdict.gptSummary = 'AI analysis temporarily unavailable. Heuristic and external security checks are still active.';
    }
  }
}

export async function analyzeLinks(
  links: LinkMeta[],
  domain: string,
  userId?: string,
  sourcePageContext?: string
): Promise<LinkAnalysis[]> {
  const analyses: LinkAnalysis[] = [];
  
  // Step 1: Calculate heuristics for all links first
  const heuristicsResults = links.map(link => ({
    link,
    heuristics: calculateHeuristics(link)
  }));
  
  // Step 2: Check all links with external services in parallel
  const externalCheckResults = await Promise.all(
    heuristicsResults.map(async ({ link }) => {
      try {
        return await checkExternalServices(link);
      } catch (err) {
        console.error(`External check failed for ${link.href}:`, err);
        return {
          safe: true,
          confidence: 0.5,
          sources: [],
          threatCount: 0
        } as AggregatedCheckResult;
      }
    })
  );
  
  // Step 3: Combine heuristics + external checks, determine which links need AI analysis
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const heuristics = heuristicsResults[i].heuristics;
    const externalResult = externalCheckResults[i];
    
    // Combine heuristics and external checks
    let trustScore = calculateTrustScore(heuristics, externalResult);
    let category = categorizeTrust(trustScore);
    
    // Merge issues from external checks
    const allIssues = [...heuristics.issues];
    if (externalResult.threatCount > 0) {
      allIssues.push(`external_threats: ${externalResult.threatCount} service(s) flagged this URL`);
    }
    externalResult.sources.forEach(source => {
      if (!source.safe && source.details) {
        allIssues.push(`${source.source.toLowerCase()}: ${source.details}`);
      }
    });
    
    let verdict: TrustVerdict = {
      trustScore,
      category,
      issues: allIssues,
      confidence: Math.max(0.7, externalResult.confidence)
    };
    
    // Step 4: Streamlined Ollama AI analysis for SUSPICIOUS or DANGEROUS links only
    // This happens BEFORE the general GPT analysis
    // Also run for links that are close to suspicious threshold (trustScore < 0.5)
    // For testing: allow AI analysis without userId if explicitly enabled via env var
    const allowAIWithoutAuth = process.env.ALLOW_AI_WITHOUT_AUTH === 'true';
    const shouldRunAI = (category === 'SUSPICIOUS' || category === 'DANGEROUS' || trustScore < 0.5) && (userId || allowAIWithoutAuth);
    
    // Declare ollamaResult outside the if block so it's accessible later
    let ollamaResult: OllamaAnalysisResult | null = null;
    
    if (shouldRunAI) {
      // If no userId but AI is allowed without auth, proceed
      if (!userId && allowAIWithoutAuth) {
        console.log(`[AI] Running AI analysis without auth (testing mode) for ${link.href}`);
        // Skip user plan check, proceed directly to AI analysis
      } else {
        const user = await getUserPlan(userId!);
        console.log(`[AI] Checking user plan for link ${link.href}: user=${userId}, plan=${user?.plan}, category=${category}, trustScore=${trustScore.toFixed(2)}`);
        
        if (!user || (user.plan !== 'premium' && user.plan !== 'trial')) {
          console.log(`[AI] Skipping AI analysis: user plan=${user?.plan}, required=premium/trial`);
          // Continue to next link
          analyses.push({
            link,
            verdict
          });
          continue;
        }
        console.log(`[AI] User plan check passed, proceeding with Ollama analysis...`);
      }
      
      // Run AI analysis (either with auth or in testing mode)
      try {
        console.log(`[AI] Starting Ollama analysis for ${link.href} (${category})`);
        // Extract source domain for better context
        const sourceDomainForAnalysis = domain || (sourcePageContext ? 
          sourcePageContext.match(/Page Domain:\s*([^\n]+)/i)?.[1]?.trim() : undefined);
        
        ollamaResult = await analyzeSuspiciousLink(
          link,
          sourcePageContext || link.contextSnippet || '',
          heuristics,
          trustScore,
          sourceDomainForAnalysis
        );
        
        console.log(`[AI] Ollama result for ${link.href}:`, ollamaResult ? 'SUCCESS' : 'NULL');
        
        if (ollamaResult) {
            console.log(`[AI] Processing Ollama result: safetyRating=${ollamaResult.safetyRating}, recommendation=${ollamaResult.followRecommendation}`);
            // Use AI safety rating to adjust trust score (convert 0-100 to 0-1)
            const aiTrustScore = ollamaResult.safetyRating / 100;
            
            // Update trust score and category based on AI recommendation FIRST
            if (ollamaResult.followRecommendation === 'SAFE_TO_FOLLOW') {
              // AI says it's safe - upgrade category to SAFE and use AI rating (minimum 0.7 for SAFE)
              trustScore = Math.max(0.7, Math.min(1.0, aiTrustScore));
              category = 'SAFE';
              console.log(`[AI] Upgraded to SAFE based on AI recommendation: ${link.href}`);
            } else if (ollamaResult.followRecommendation === 'AVOID') {
              // AI says avoid - downgrade to DANGEROUS and use AI rating (maximum 0.3 for DANGEROUS)
              trustScore = Math.min(0.3, Math.max(0, aiTrustScore));
              category = 'DANGEROUS';
              console.log(`[AI] Downgraded to DANGEROUS based on AI recommendation: ${link.href}`);
            } else if (ollamaResult.followRecommendation === 'CAUTION_ADVISED') {
              // AI says caution - keep SUSPICIOUS, adjust trust score based on AI rating
              trustScore = Math.max(0.4, Math.min(0.69, aiTrustScore)); // Keep in SUSPICIOUS range (0.4-0.69)
              category = 'SUSPICIOUS';
              console.log(`[AI] Kept as SUSPICIOUS based on AI recommendation: ${link.href}`);
            } else {
              // Fallback: blend AI rating with existing score if recommendation is unclear
              trustScore = aiTrustScore * 0.6 + trustScore * 0.4;
              category = categorizeTrust(trustScore);
            }
            
            // Update verdict with AI analysis
            verdict.trustScore = trustScore;
            verdict.category = category;
            
            // Format AI summary with all relevant information (in English)
            const aiSummaryParts: string[] = [];
            if (ollamaResult.contentRelevance) {
              aiSummaryParts.push(`📄 Content Relevance: ${ollamaResult.contentRelevance}`);
            }
            if (ollamaResult.clickBehavior) {
              aiSummaryParts.push(`🖱️ Click Behavior: ${ollamaResult.clickBehavior}`);
            }
            if (ollamaResult.reasoning) {
              aiSummaryParts.push(`💭 Reasoning: ${ollamaResult.reasoning}`);
            }
            if (ollamaResult.followRecommendation) {
              const recText = ollamaResult.followRecommendation === 'SAFE_TO_FOLLOW' ? '✅ Safe to Follow' :
                             ollamaResult.followRecommendation === 'AVOID' ? '❌ Avoid' :
                             '⚠️ Proceed with Caution';
              aiSummaryParts.push(`\n${recText}`);
            }
            
            verdict.gptSummary = aiSummaryParts.join('\n\n');
            verdict.recommendation = ollamaResult.followRecommendation;
            verdict.riskTags = [
              ollamaResult.followRecommendation === 'AVOID' ? 'high_risk' : 
              ollamaResult.followRecommendation === 'CAUTION_ADVISED' ? 'moderate_risk' : 'low_risk'
            ];
            verdict.confidence = 0.85; // High confidence for AI analysis
            
            // Add click behavior to issues (but don't duplicate in summary)
            if (ollamaResult.clickBehavior && !ollamaResult.clickBehavior.includes('Unknown')) {
              allIssues.push(`AI: ${ollamaResult.clickBehavior}`);
            }
            verdict.issues = allIssues;
            
            console.log(`[AI] Final verdict for ${link.href}: gptSummary=${verdict.gptSummary ? 'SET' : 'MISSING'}, trustScore=${verdict.trustScore}`);
          } else {
            console.warn(`[AI] Ollama returned null for ${link.href} - AI analysis unavailable`);
          }
        } catch (err) {
          console.error(`[AI] Ollama analysis failed for ${link.href}:`, err);
          // Continue with regular analysis
        }
    } else {
      if (!userId && !allowAIWithoutAuth) {
        console.log(`[AI] Skipping AI analysis: no userId for ${link.href} (set ALLOW_AI_WITHOUT_AUTH=true to enable testing)`);
      } else if (category === 'SAFE' && trustScore >= 0.5) {
        console.log(`[AI] Skipping AI analysis: link is SAFE (${link.href}, score=${trustScore.toFixed(2)})`);
      }
    }
    
    // Step 5: General GPT analysis (fallback or for SAFE links, if OpenAI is configured)
    if (userId && category === 'SAFE' && !verdict.gptSummary) {
      const user = await getUserPlan(userId);
      if (user && (user.plan === 'premium' || user.plan === 'trial')) {
        try {
          const gptResult = await getGptAnalysis(link, heuristics, trustScore, externalResult);
          if (gptResult) {
            verdict.gptSummary = gptResult.summary;
            verdict.recommendation = gptResult.recommendation;
            verdict.riskTags = gptResult.concise_risk_tags;
            verdict.confidence = gptResult.confidence || verdict.confidence;
          }
        } catch (err) {
          console.error('GPT analysis failed:', err);
        }
      }
    }
    
    analyses.push({
      link,
      verdict
    });
    
    // Store scan result in database (async, don't wait) - store for all users and anonymous
    storeScanResult(userId || null, link, verdict, externalResult, ollamaResult).catch(err => {
      console.error(`[DB] Failed to store scan result for ${link.href}:`, err);
    });
  }
  
  // Fill in any gaps in analyses array (shouldn't happen, but safety check)
  for (let i = 0; i < links.length; i++) {
    if (!analyses[i]) {
      // If link was filtered out due to extension marker, return a safe default
      if (hasExtensionMarker(links[i].text)) {
        analyses[i] = {
          link: links[i],
          verdict: {
            trustScore: 0.5,
            category: 'SAFE',
            issues: [],
            confidence: 0.5,
            gptSummary: 'Link already processed by extension'
          }
        };
      } else {
        // Error case - create basic analysis
        const link = links[i];
        const heuristics = calculateHeuristics(link);
        const trustScore = calculateTrustScore(heuristics);
        analyses[i] = {
          link,
          verdict: {
            trustScore,
            category: categorizeTrust(trustScore),
            issues: heuristics.issues,
            confidence: 0.5
          }
        };
      }
    }
  }
  
  return analyses;
}

function calculateTrustScore(
  heuristics: {
    issues: string[];
    flags: Record<string, boolean>;
  },
  externalResult?: AggregatedCheckResult
): number {
  let score = 0.5; // Neutral starting point
  
  // Deduct points for each issue (weighted)
  for (const issue of heuristics.issues) {
    if (issue.includes('PHISHING_RISK') || issue.includes('typosquatting')) {
      score -= 0.50; // Very heavy penalty for typosquatting/phishing
    }
    if (issue.includes('short_url')) score -= 0.12;
    if (issue.includes('no_https')) score -= 0.20;
    if (issue.includes('punycode')) score -= 0.18;
    if (issue.includes('suspicious_tld')) score -= 0.15;
    if (issue.includes('ip_address')) score -= 0.15;
    if (issue.includes('suspicious_params')) score -= 0.10;
    if (issue.includes('encoded_url')) score -= 0.08;
    if (issue.includes('invalid_url')) score -= 0.25;
    if (issue.includes('external_threats')) score -= 0.30; // Heavy penalty for external threats
  }
  
  // Positive signals
  if (heuristics.flags.hasNoopener) score += 0.05;
  if (heuristics.flags.isKnownSafe) score += 0.20;
  if (heuristics.flags.hasValidSSL) score += 0.10;
  if (heuristics.flags.hasValidDomain) score += 0.05;
  
  // Apply external check results (weighted heavily)
  if (externalResult) {
    if (!externalResult.safe && externalResult.confidence > 0.7) {
      // External services flagged it - reduce score significantly
      score = Math.min(score, 0.3);
    } else if (externalResult.safe && externalResult.confidence > 0.7) {
      // External services confirm it's safe - boost score
      score = Math.min(1.0, score + 0.15);
    }
    // Use external confidence to adjust final score
    score = score * 0.6 + (externalResult.safe ? externalResult.confidence : 1 - externalResult.confidence) * 0.4;
  }
  
  return Math.max(0, Math.min(1, score));
}

function categorizeTrust(score: number): 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS' {
  if (score >= 0.7) return 'SAFE';
  if (score >= 0.4) return 'SUSPICIOUS';
  return 'DANGEROUS';
}

async function getUserPlan(userId: string): Promise<{ plan: string; trial_expires_at?: Date } | null> {
  const result = await pool.query(
    'SELECT plan, trial_expires_at FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

// In-memory lock to prevent concurrent storage of the same URL
const storageLocks = new Map<string, Promise<void>>();

async function storeScanResult(
  userId: string | null,
  link: LinkMeta,
  verdict: TrustVerdict,
  externalResult?: AggregatedCheckResult,
  ollamaResult?: OllamaAnalysisResult | null
): Promise<void> {
  const normalizedUrl = normalizeUrl(link.href);
  
  // Check if storage is already in progress for this URL
  const existingStorage = storageLocks.get(normalizedUrl);
  if (existingStorage) {
    // Wait for existing storage to complete
    await existingStorage;
    return;
  }
  
  // Create storage promise and lock it
  const storagePromise = (async () => {
    try {
      // First, check if a recent result exists (within cache TTL)
      const cacheCutoff = new Date(Date.now() - CACHE_TTL_MS);
      const existingResult = await pool.query(
        `SELECT id, created_at, gpt_summary, confidence FROM link_scans 
         WHERE url = $1 AND created_at > $2 
         ORDER BY created_at DESC LIMIT 1`,
        [normalizedUrl, cacheCutoff]
      );
      
      if (existingResult.rows.length > 0) {
        // Update existing record (only if we have new AI analysis or better data)
        const existing = existingResult.rows[0];
        const shouldUpdate = ollamaResult || 
                           (verdict.gptSummary && !existing.gpt_summary) ||
                           (verdict.confidence && verdict.confidence > (parseFloat(existing.confidence) || 0));
        
        if (shouldUpdate) {
          await pool.query(
            `UPDATE link_scans SET
              user_id = COALESCE($1, user_id),
              domain = $2,
              link_text = $3,
              detected_issues = $4,
              trust_score = $5,
              gpt_summary = COALESCE($6, gpt_summary),
              ollama_analysis = COALESCE($7, ollama_analysis),
              external_checks = COALESCE($8, external_checks),
              recommendation = COALESCE($9, recommendation),
              risk_tags = COALESCE($10, risk_tags),
              confidence = COALESCE($11, confidence),
              category = $12,
              updated_at = NOW()
            WHERE id = $13`,
            [
              userId,
              link.targetDomain,
              link.text,
              JSON.stringify(verdict.issues),
              verdict.trustScore,
              verdict.gptSummary || null,
              ollamaResult ? JSON.stringify(ollamaResult) : null,
              externalResult ? JSON.stringify(externalResult) : null,
              verdict.recommendation || null,
              verdict.riskTags ? JSON.stringify(verdict.riskTags) : null,
              verdict.confidence || null,
              verdict.category,
              existing.id
            ]
          );
        }
        // If no update needed, just return (don't create duplicate)
        return;
      }
      
      // No existing record - insert new one
      // Use INSERT with ON CONFLICT to handle race conditions
      await pool.query(
        `INSERT INTO link_scans (
          user_id, domain, url, link_text, detected_issues, trust_score, 
          gpt_summary, ollama_analysis, external_checks, recommendation, 
          risk_tags, confidence, category, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
        ON CONFLICT (url) 
        DO UPDATE SET
          user_id = COALESCE(EXCLUDED.user_id, link_scans.user_id),
          domain = EXCLUDED.domain,
          link_text = EXCLUDED.link_text,
          detected_issues = EXCLUDED.detected_issues,
          trust_score = EXCLUDED.trust_score,
          gpt_summary = COALESCE(EXCLUDED.gpt_summary, link_scans.gpt_summary),
          ollama_analysis = COALESCE(EXCLUDED.ollama_analysis, link_scans.ollama_analysis),
          external_checks = COALESCE(EXCLUDED.external_checks, link_scans.external_checks),
          recommendation = COALESCE(EXCLUDED.recommendation, link_scans.recommendation),
          risk_tags = COALESCE(EXCLUDED.risk_tags, link_scans.risk_tags),
          confidence = COALESCE(EXCLUDED.confidence, link_scans.confidence),
          category = EXCLUDED.category,
          updated_at = NOW()
        WHERE link_scans.created_at > NOW() - INTERVAL '${CACHE_TTL_HOURS} hours'`,
        [
          userId,
          link.targetDomain,
          normalizedUrl,
          link.text,
          JSON.stringify(verdict.issues),
          verdict.trustScore,
          verdict.gptSummary || null,
          ollamaResult ? JSON.stringify(ollamaResult) : null,
          externalResult ? JSON.stringify(externalResult) : null,
          verdict.recommendation || null,
          verdict.riskTags ? JSON.stringify(verdict.riskTags) : null,
          verdict.confidence || null,
          verdict.category
        ]
      );
    } catch (err: any) {
      // If UPSERT fails (e.g., no unique constraint), try regular INSERT
      if (err.code === '23505' || err.message?.includes('unique constraint')) {
        // Unique constraint violation - try UPDATE instead
        try {
          await pool.query(
            `UPDATE link_scans SET
              user_id = COALESCE($1, user_id),
              domain = $2,
              link_text = $3,
              detected_issues = $4,
              trust_score = $5,
              gpt_summary = COALESCE($6, gpt_summary),
              ollama_analysis = COALESCE($7, ollama_analysis),
              external_checks = COALESCE($8, external_checks),
              recommendation = COALESCE($9, recommendation),
              risk_tags = COALESCE($10, risk_tags),
              confidence = COALESCE($11, confidence),
              category = $12,
              updated_at = NOW()
            WHERE url = $13 AND created_at > NOW() - INTERVAL '${CACHE_TTL_HOURS} hours'`,
            [
              userId,
              link.targetDomain,
              link.text,
              JSON.stringify(verdict.issues),
              verdict.trustScore,
              verdict.gptSummary || null,
              ollamaResult ? JSON.stringify(ollamaResult) : null,
              externalResult ? JSON.stringify(externalResult) : null,
              verdict.recommendation || null,
              verdict.riskTags ? JSON.stringify(verdict.riskTags) : null,
              verdict.confidence || null,
              verdict.category,
              normalizedUrl
            ]
          );
        } catch (updateErr) {
          // If update didn't affect any rows, insert new
          await pool.query(
            `INSERT INTO link_scans (
              user_id, domain, url, link_text, detected_issues, trust_score, 
              gpt_summary, ollama_analysis, external_checks, recommendation, 
              risk_tags, confidence, category
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              userId,
              link.targetDomain,
              normalizedUrl,
              link.text,
              JSON.stringify(verdict.issues),
              verdict.trustScore,
              verdict.gptSummary || null,
              ollamaResult ? JSON.stringify(ollamaResult) : null,
              externalResult ? JSON.stringify(externalResult) : null,
              verdict.recommendation || null,
              verdict.riskTags ? JSON.stringify(verdict.riskTags) : null,
              verdict.confidence || null,
              verdict.category
            ]
          );
        }
      } else {
        // Other error - log it but don't throw (non-critical)
        console.error(`[DB] Failed to store scan result for ${normalizedUrl}:`, err);
      }
    } finally {
      // Always remove lock when done
      storageLocks.delete(normalizedUrl);
    }
  })();
  
  // Store the promise in the lock map
  storageLocks.set(normalizedUrl, storagePromise);
  
  // Await the storage to complete
  await storagePromise;
}
