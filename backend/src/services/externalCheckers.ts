import type { LinkMeta } from '../../shared/types.js';
import { isTrustedDomain } from './heuristics.js';

export interface ExternalCheckResult {
  source: string;
  safe: boolean;
  confidence: number;
  details?: string;
  error?: string;
}

export interface AggregatedCheckResult {
  safe: boolean;
  confidence: number;
  sources: ExternalCheckResult[];
  threatCount: number;
}

/**
 * Check URL with Google Safe Browsing API (free tier)
 */
async function checkGoogleSafeBrowsing(url: string): Promise<ExternalCheckResult> {
  const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (!apiKey || apiKey.includes('placeholder')) {
    return { source: 'Google Safe Browsing', safe: true, confidence: 0, error: 'API key not configured' };
  }

  try {
    const response = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: {
            clientId: 'smarttrust',
            clientVersion: '0.1.0'
          },
          threatInfo: {
            threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url }]
          }
        })
      }
    );

    if (!response.ok) {
      return { source: 'Google Safe Browsing', safe: true, confidence: 0, error: `API error: ${response.status}` };
    }

    const data = await response.json() as { matches?: Array<{ threatType: string }> };
    const hasThreats = data.matches && data.matches.length > 0;

    return {
      source: 'Google Safe Browsing',
      safe: !hasThreats,
      confidence: hasThreats ? 0.95 : 0.8,
      details: hasThreats ? `Threats detected: ${data.matches!.map((m) => m.threatType).join(', ')}` : 'No threats found'
    };
  } catch (err: any) {
    return { source: 'Google Safe Browsing', safe: true, confidence: 0, error: err.message };
  }
}

/**
 * Check URL with VirusTotal API
 */
async function checkVirusTotal(url: string): Promise<ExternalCheckResult> {
  const apiKey = process.env.VIRUSTOTAL_API_KEY;
  if (!apiKey || apiKey.includes('placeholder')) {
    return { source: 'VirusTotal', safe: true, confidence: 0, error: 'API key not configured' };
  }

  try {
    // First, submit URL for scanning
    const submitResponse = await fetch('https://www.virustotal.com/vtapi/v2/url/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        apikey: apiKey,
        url: url
      })
    });

    if (!submitResponse.ok) {
      // Try to get existing report
      const reportResponse = await fetch(
        `https://www.virustotal.com/vtapi/v2/url/report?apikey=${apiKey}&resource=${encodeURIComponent(url)}`
      );
      
      if (reportResponse.ok) {
        const report = await reportResponse.json() as { response_code?: number; positives?: number; total?: number };
        if (report.response_code === 1) {
          const positives = report.positives || 0;
          const total = report.total || 0;
          const safe = positives === 0;
          
          return {
            source: 'VirusTotal',
            safe,
            confidence: safe ? 0.9 : 0.95,
            details: safe ? 'No threats detected' : `${positives}/${total} engines flagged this URL`
          };
        }
      }
      
      return { source: 'VirusTotal', safe: true, confidence: 0, error: `API error: ${submitResponse.status}` };
    }

    // For new scans, return pending status
    return { source: 'VirusTotal', safe: true, confidence: 0.5, details: 'Scan submitted, results pending' };
  } catch (err: any) {
    return { source: 'VirusTotal', safe: true, confidence: 0, error: err.message };
  }
}

/**
 * Check URL with URLVoid API
 */
async function checkURLVoid(url: string): Promise<ExternalCheckResult> {
  const apiKey = process.env.URLVOID_API_KEY;
  if (!apiKey || apiKey.includes('placeholder')) {
    return { source: 'URLVoid', safe: true, confidence: 0, error: 'API key not configured' };
  }

  try {
    const domain = new URL(url).hostname;
    const response = await fetch(
      `https://api.urlvoid.com/v1/pay-as-you-go/?key=${apiKey}&host=${domain}&stats=1`
    );

    if (!response.ok) {
      return { source: 'URLVoid', safe: true, confidence: 0, error: `API error: ${response.status}` };
    }

    const data = await response.json() as { detections?: number; response?: { detections?: number; blacklists?: string } };
    const detections = (data.response?.detections || data.detections) || 0;
    const safe = detections === 0;

    return {
      source: 'URLVoid',
      safe,
      confidence: safe ? 0.85 : 0.9,
      details: safe ? 'No detections' : `${detections} detection(s) found`
    };
  } catch (err: any) {
    return { source: 'URLVoid', safe: true, confidence: 0, error: err.message };
  }
}

/**
 * Check URL with PhishTank (free, no API key needed)
 */
async function checkPhishTank(url: string): Promise<ExternalCheckResult> {
  try {
    const response = await fetch('https://checkurl.phishtank.com/checkurl/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        url: url,
        format: 'json',
        app_key: process.env.PHISHTANK_API_KEY || ''
      })
    });

    if (!response.ok) {
      return { source: 'PhishTank', safe: true, confidence: 0, error: `API error: ${response.status}` };
    }

    const data = await response.json() as { results?: { in_database?: boolean; valid?: boolean; verified?: boolean } };
    const isPhish = data.results?.in_database === true && data.results?.verified === true;

    return {
      source: 'PhishTank',
      safe: !isPhish,
      confidence: isPhish ? 0.95 : 0.8,
      details: isPhish ? 'Phishing URL detected' : 'Not in phishing database'
    };
  } catch (err: any) {
    return { source: 'PhishTank', safe: true, confidence: 0, error: err.message };
  }
}

/**
 * Check URL with multiple external services in parallel
 * Speed optimization: Skip external checks for trusted domains.
 */
export async function checkExternalServices(link: LinkMeta): Promise<AggregatedCheckResult> {
  // Speed optimization: Skip external checks for trusted domains
  if (isTrustedDomain(link.targetDomain)) {
    return {
      safe: true,
      confidence: 1.0,
      sources: [{
        source: 'Trusted Domain',
        safe: true,
        confidence: 1.0,
        details: 'Renowned, trusted website - no external checks needed'
      }],
      threatCount: 0
    };
  }
  
  const url = link.href;
  const checks = await Promise.allSettled([
    checkGoogleSafeBrowsing(url),
    checkVirusTotal(url),
    checkURLVoid(url),
    checkPhishTank(url)
  ]);

  const results: ExternalCheckResult[] = checks
    .filter((r): r is PromiseFulfilledResult<ExternalCheckResult> => r.status === 'fulfilled')
    .map(r => r.value);

  // Count threats
  const threatCount = results.filter(r => !r.safe && r.confidence > 0.5).length;
  const safeCount = results.filter(r => r.safe && r.confidence > 0.5).length;
  const totalConfident = results.filter(r => r.confidence > 0.5).length;

  // Determine overall safety
  const safe = threatCount === 0;
  const confidence = totalConfident > 0 
    ? (safeCount / totalConfident) * 0.9 + (threatCount > 0 ? 0 : 0.1)
    : 0.5;

  return {
    safe,
    confidence: Math.min(0.95, confidence),
    sources: results,
    threatCount
  };
}

