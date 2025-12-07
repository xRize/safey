import { Router } from 'express';
import { getGptAnalysis } from '../services/gpt.js';
import { gptRateLimiter } from '../middleware/rateLimit.js';
import { calculateHeuristics } from '../services/heuristics.js';

export const gptRouter = Router();

gptRouter.post('/', gptRateLimiter, async (req, res) => {
  try {
    const { link, trustScore } = req.body;
    
    if (!link || !link.href) {
      return res.status(400).json({ error: 'Invalid link data' });
    }
    
    const heuristics = calculateHeuristics(link);
    const score = trustScore || 0.5;
    
    const result = await getGptAnalysis(link, heuristics, score);
    
    if (!result) {
      return res.status(503).json({ error: 'GPT analysis unavailable' });
    }
    
    res.json(result);
  } catch (err) {
    console.error('GPT route error:', err);
    res.status(500).json({ error: 'GPT analysis failed' });
  }
});

