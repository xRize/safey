import OpenAI from 'openai';
import { sanitizeForGpt } from '../utils/sanitize.js';
import type { LinkMeta } from '../../shared/types.js';

// Lazy initialization - only create client when needed and key is valid
function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey || 
      apiKey.includes('placeholder') ||
      apiKey === 'your_openai_api_key_here' ||
      apiKey.startsWith('sk-placeholder') ||
      apiKey.trim() === '') {
    return null;
  }
  
  try {
    return new OpenAI({ apiKey });
  } catch (err) {
    console.error('Failed to initialize OpenAI client:', err);
    return null;
  }
}

interface HeuristicsResult {
  issues: string[];
  flags: Record<string, boolean>;
}

interface GptAnalysisResult {
  summary: string;
  recommendation: string;
  concise_risk_tags: string[];
  confidence: number;
}

const GPT_PROMPT_TEMPLATE = `You are a cybersecurity assistant. The user wants a short, clear, non-alarmist explanation (2-4 short sentences) of why the following link or page might be risky for an average user. Use plain language, mention concrete potential risks (e.g., phishing, malware, data collection, credential theft, suspicious redirects). Limit to 120 words. Include recommended user actions.

USER:
- page_url: {url}
- page_context_snippet: "{context_snippet}"
- heuristics: {heuristics_json}
- trust_score: {score}

Return JSON:
{
  "summary": "...",
  "recommendation": "...",
  "concise_risk_tags": ["phishing", "malware", "data_collection"],
  "confidence": 0.86
}`;

// Cache for GPT responses (in-memory, could use Redis)
const gptCache = new Map<string, { result: GptAnalysisResult; timestamp: number }>();
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

export async function getGptAnalysis(
  link: LinkMeta,
  heuristics: HeuristicsResult,
  trustScore: number,
  externalResult?: { safe: boolean; threatCount: number; sources: Array<{ source: string; safe?: boolean; details?: string }> }
): Promise<GptAnalysisResult | null> {
  // Get OpenAI client (lazy initialization)
  const openai = getOpenAIClient();
  if (!openai) {
    console.debug('OpenAI API key not configured or is placeholder - GPT analysis unavailable');
    return null;
  }
  
  // Check cache
  const cacheKey = `${link.href}_${trustScore}`;
  const cached = gptCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }
  
  try {
    // Sanitize inputs
    const sanitizedUrl = sanitizeForGpt(link.href);
    const sanitizedContext = sanitizeForGpt(link.contextSnippet || '').slice(0, 200);
    
    // Build external check summary
    let externalSummary = '';
    if (externalResult) {
      const threatSources = externalResult.sources.filter(s => !s.safe && s.details);
      if (threatSources.length > 0) {
        externalSummary = `\n- external_checks: ${externalResult.threatCount} security service(s) flagged this URL\n  Details: ${threatSources.map(s => `${s.source}: ${s.details || 'threat detected'}`).join('; ')}`;
      } else if (externalResult.safe && externalResult.sources.length > 0) {
        externalSummary = `\n- external_checks: Checked with ${externalResult.sources.length} service(s): No threats detected`;
      }
    }
    
    const prompt = GPT_PROMPT_TEMPLATE
      .replace('{url}', sanitizedUrl)
      .replace('{context_snippet}', sanitizedContext)
      .replace('{heuristics_json}', JSON.stringify(heuristics) + externalSummary)
      .replace('{score}', trustScore.toFixed(2));
    
    const completion = await openai!.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a cybersecurity assistant. Always return valid JSON in the exact format requested.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3, // Low temperature for consistent results
      max_tokens: 300
    });
    
    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty GPT response');
    }
    
    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in GPT response');
    }
    
    const result: GptAnalysisResult = JSON.parse(jsonMatch[0]);
    
    // Validate result structure
    if (!result.summary || !result.recommendation) {
      throw new Error('Invalid GPT response structure');
    }
    
    // Cache result
    gptCache.set(cacheKey, { result, timestamp: Date.now() });
    
    return result;
  } catch (err) {
    console.error('GPT analysis error:', err);
    return null;
  }
}

