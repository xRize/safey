import { Router } from 'express';
import { analyzeLinks } from '../services/analyzer.js';
import { rateLimiter } from '../middleware/rateLimit.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

export const analyzeRouter = Router();

analyzeRouter.post('/', rateLimiter, async (req: AuthRequest, res) => {
  try {
    const { links, domain } = req.body;
    
    // Get userId from token if present (optional - works without auth too)
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
        contextSnippet: link.contextSnippet?.slice(0, 500),
        targetDomain: link.targetDomain?.slice(0, 255)
      }));
    
    if (sanitizedLinks.length === 0) {
      console.log(`[Analyze] All links filtered out (already processed)`);
      return res.json({ analyses: [] });
    }
    
    // Get source page context if available
    const sourcePageContext = req.body.sourcePageContext || req.body.context || '';
    
    console.log(`[Analyze] Processing ${sanitizedLinks.length} links for domain ${domain}, userId: ${userId || 'none'}`);
    const analyses = await analyzeLinks(sanitizedLinks, domain, userId, sourcePageContext);
    
    // Log how many have AI analysis
    const withAI = analyses.filter(a => a.verdict.gptSummary).length;
    console.log(`[Analyze] Completed: ${analyses.length} total, ${withAI} with AI analysis`);
    
    res.json({ analyses });
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

