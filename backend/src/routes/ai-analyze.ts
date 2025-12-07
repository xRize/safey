import { Router } from 'express';
import { analyzeLinksWithAI } from '../services/analyzer.js';
import { rateLimiter } from '../middleware/rateLimit.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

export const aiAnalyzeRouter = Router();

// Request deduplication: track ongoing analyses by request signature
const ongoingAnalyses = new Map<string, Promise<any>>();

function getRequestSignature(links: any[], domain: string): string {
  // Create a signature from normalized URLs and domain
  const normalizedUrls = links
    .map((link: any) => {
      try {
        const u = new URL(link.href);
        u.hash = '';
        if (u.pathname.endsWith('/') && u.pathname.length > 1) {
          u.pathname = u.pathname.slice(0, -1);
        }
        return u.href;
      } catch {
        return link.href;
      }
    })
    .sort()
    .join('|');
  return `${domain}:${normalizedUrls}`;
}

/**
 * Analyze links with AI (prioritized for clicked links)
 * This endpoint returns initial results immediately, then streams AI updates
 */
aiAnalyzeRouter.post('/', rateLimiter, async (req: AuthRequest, res) => {
  try {
    const { links, domain, priorityUrl, sourcePageContext } = req.body;
    
    // Get userId from token if present
    const userId = req.userId || undefined;
    
    if (!Array.isArray(links) || links.length === 0) {
      return res.status(400).json({ error: 'Invalid links array' });
    }
    
    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({ error: 'Invalid domain' });
    }
    
    // Filter out links with extension markers (already processed)
    const extensionMarkerPatterns = [
      /⚠\s*Caution/i,
      /⚠️\s*Caution/i,
      /⚠\s*Safe/i,
      /⚠️\s*Safe/i,
      /⚠\s*Danger/i,
      /⚠️\s*Danger/i,
      /Trust\s*Score/i,
      /\[SAFE\]/i,
      /\[SUSPICIOUS\]/i,
      /\[DANGEROUS\]/i,
      /PHISHING\s*RISK/i,
      /SmartTrust/i
    ];
    
    // Sanitize and filter links (limit to 100 per request, skip already processed)
    const sanitizedLinks = links
      .slice(0, 100)
      .filter((link: any) => {
        const linkText = (link.text || '').toLowerCase();
        // Skip links that have extension markers
        return !extensionMarkerPatterns.some(pattern => 
          pattern.test(link.text || '') || pattern.test(linkText)
        );
      })
      .map((link: any) => ({
        href: link.href?.slice(0, 2048),
        text: link.text?.slice(0, 500),
        rel: link.rel,
        target: link.target,
        download: link.download,
        contextSnippet: link.contextSnippet?.slice(0, 500),
        targetDomain: link.targetDomain?.slice(0, 255)
      }));
    
    if (sanitizedLinks.length === 0) {
      console.log(`[AI Analyze] All links filtered out (already processed)`);
      return res.json({ analyses: [] });
    }
    
    // Check if same request is already being processed
    const requestSignature = getRequestSignature(sanitizedLinks, domain);
    const existingAnalysis = ongoingAnalyses.get(requestSignature);
    
    if (existingAnalysis) {
      // Wait for existing analysis to complete
      console.log(`[AI Analyze] Deduplicating request - waiting for existing analysis`);
      const analyses = await existingAnalysis;
      return res.json({ analyses });
    }
    
    console.log(`[AI Analyze] Processing ${sanitizedLinks.length} links, priority: ${priorityUrl || 'none'}`);
    
    // Create analysis promise and store it
    const analysisPromise = analyzeLinksWithAI(
      sanitizedLinks,
      domain,
      userId,
      sourcePageContext || '',
      priorityUrl
    ).finally(() => {
      // Remove from ongoing analyses when done
      ongoingAnalyses.delete(requestSignature);
    });
    
    ongoingAnalyses.set(requestSignature, analysisPromise);
    
    // Analyze with AI (parallel processing, priority for clicked link)
    const analyses = await analysisPromise;
    
    res.json({ analyses });
  } catch (err) {
    console.error('AI Analyze error:', err);
    res.status(500).json({ error: 'AI analysis failed' });
  }
});

/**
 * Analyze a single link with AI (for clicked links - highest priority)
 */
aiAnalyzeRouter.post('/single', rateLimiter, async (req: AuthRequest, res) => {
  try {
    const { link, domain, sourcePageContext } = req.body;
    const userId = req.userId || undefined;
    
    if (!link || !link.href) {
      return res.status(400).json({ error: 'Invalid link' });
    }
    
    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({ error: 'Invalid domain' });
    }
    
    console.log(`[AI Analyze Single] Priority analysis for: ${link.href}`);
    
    // Analyze single link with highest priority
    const analyses = await analyzeLinksWithAI(
      [link],
      domain,
      userId,
      sourcePageContext || '',
      link.href // This is the priority URL
    );
    
    res.json({ analysis: analyses[0] || null });
  } catch (err) {
    console.error('AI Analyze Single error:', err);
    res.status(500).json({ error: 'AI analysis failed' });
  }
});

