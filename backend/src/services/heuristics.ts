import type { LinkMeta } from '../../shared/types.js';

// Known safe/trusted domains - skip AI analysis for these renowned sites
const KNOWN_SAFE_DOMAINS = new Set([
  // Google services
  'google.com', 'google.ro', 'google.co.uk', 'google.de', 'google.fr', 'google.it', 'google.es',
  'gmail.com', 'googlemail.com', 'googledrive.com', 'googleusercontent.com', 'googleapis.com',
  'youtube.com', 'youtu.be', 'gstatic.com', 'google-analytics.com', 'doubleclick.net',
  'googletagmanager.com', 'googleadservices.com', 'googleadsserving.cn',
  
  // Microsoft
  'microsoft.com', 'microsoftstore.com', 'office.com', 'office365.com', 'outlook.com',
  'live.com', 'hotmail.com', 'msn.com', 'bing.com', 'azure.com', 'github.com', 'github.io',
  'githubusercontent.com', 'npmjs.com', 'nuget.org',
  
  // Apple
  'apple.com', 'icloud.com', 'appleid.apple.com', 'appstore.com', 'itunes.com',
  
  // Social Media
  'facebook.com', 'fb.com', 'instagram.com', 'whatsapp.com', 'messenger.com',
  'twitter.com', 'x.com', 't.co', 'linkedin.com', 'pinterest.com', 'tumblr.com',
  'reddit.com', 'redd.it', 'discord.com', 'discord.gg', 'telegram.org', 't.me',
  'snapchat.com', 'tiktok.com',
  
  // E-commerce & Services
  'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.it', 'amazon.es',
  'ebay.com', 'paypal.com', 'stripe.com', 'shopify.com', 'etsy.com',
  
  // Streaming & Entertainment
  'netflix.com', 'spotify.com', 'youtube.com', 'twitch.tv', 'vimeo.com', 'dailymotion.com',
  'soundcloud.com', 'bandcamp.com',
  
  // News & Information
  'wikipedia.org', 'wikimedia.org', 'wikidata.org', 'bbc.com', 'bbc.co.uk',
  'cnn.com', 'reuters.com', 'theguardian.com', 'nytimes.com', 'washingtonpost.com',
  'wsj.com', 'bloomberg.com', 'forbes.com', 'techcrunch.com', 'theverge.com',
  
  // Developer & Tech
  'stackoverflow.com', 'stackexchange.com', 'github.com', 'gitlab.com', 'bitbucket.org',
  'npmjs.com', 'pypi.org', 'docker.com', 'kubernetes.io', 'nodejs.org', 'python.org',
  'mozilla.org', 'firefox.com', 'chromium.org', 'webkit.org',
  
  // Cloud Services
  'aws.amazon.com', 'cloud.google.com', 'azure.microsoft.com', 'digitalocean.com',
  'heroku.com', 'vercel.com', 'netlify.com', 'cloudflare.com',
  
  // Education
  'edu', 'harvard.edu', 'mit.edu', 'stanford.edu', 'coursera.org', 'edx.org',
  'khanacademy.org', 'udemy.com', 'udacity.com',
  
  // Government & Organizations
  'gov', 'gov.uk', 'europa.eu', 'un.org', 'who.int', 'w3.org', 'ietf.org',
  
  // Banking & Finance (major banks - be careful, but these are well-known)
  'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com', 'usbank.com',
  'visa.com', 'mastercard.com', 'americanexpress.com',
  
  // Other trusted services
  'dropbox.com', 'box.com', 'onedrive.com', 'icloud.com',
  'adobe.com', 'adobe.io', 'autodesk.com',
  'oracle.com', 'ibm.com', 'intel.com', 'nvidia.com', 'amd.com',
  'salesforce.com', 'servicenow.com', 'sap.com',
  'zoom.us', 'webex.com', 'gotomeeting.com',
  'slack.com', 'microsoft.com', 'teams.microsoft.com',
  'atlassian.com', 'jira.com', 'confluence.com', 'trello.com',
  'notion.so', 'evernote.com', 'onenote.com'
]);

/**
 * Check if a domain is in the trusted list (including subdomains)
 */
export function isTrustedDomain(domain: string): boolean {
  const domainLower = domain.toLowerCase();
  const domainParts = domainLower.split('.');
  
  // Check exact match
  if (KNOWN_SAFE_DOMAINS.has(domainLower)) {
    return true;
  }
  
  // Check base domain (e.g., 'mail.google.com' -> 'google.com')
  if (domainParts.length >= 2) {
    const baseDomain = domainParts.slice(-2).join('.');
    if (KNOWN_SAFE_DOMAINS.has(baseDomain)) {
      return true;
    }
  }
  
  // Check TLD-only entries (e.g., 'edu', 'gov')
  const tld = domainParts[domainParts.length - 1];
  if (KNOWN_SAFE_DOMAINS.has(tld)) {
    return true;
  }
  
  return false;
}

// Suspicious TLDs (free domains often used for phishing)
const SUSPICIOUS_TLDS = new Set([
  '.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.click', '.download', '.stream'
]);

// URL shorteners
const URL_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly',
  'short.link', 'cutt.ly', 'rebrand.ly', 'short.link', 'tiny.cc'
]);

// Suspicious keywords in domain
const SUSPICIOUS_KEYWORDS = [
  'secure-', 'verify-', 'update-', 'account-', 'login-', 'confirm-',
  'paypal-', 'bank-', 'amazon-', 'microsoft-', 'google-', 'apple-'
];

export function calculateHeuristics(link: LinkMeta): {
  issues: string[];
  flags: Record<string, boolean>;
} {
  const issues: string[] = [];
  const flags: Record<string, boolean> = {};
  
  try {
    const url = new URL(link.href);
    const domain = url.hostname.toLowerCase();
    const fullDomain = domain;
    const domainParts = domain.split('.');
    const baseDomain = domainParts.length >= 2 
      ? domainParts.slice(-2).join('.') 
      : domain;
    
    // Check HTTPS
    if (url.protocol !== 'https:') {
      issues.push('no_https');
    } else {
      flags.hasValidSSL = true;
    }
    
    // Check for URL shorteners
    if (URL_SHORTENERS.has(domain) || URL_SHORTENERS.has(baseDomain)) {
      issues.push('short_url');
    }
    
    // Check for punycode (homograph attacks)
    if (domain.includes('xn--')) {
      issues.push('punycode');
    }
    
    // Check for suspicious TLDs
    const tld = domain.split('.').pop() || '';
    if (SUSPICIOUS_TLDS.has(`.${tld}`)) {
      issues.push('suspicious_tld');
    }
    
    // Check for IP address instead of domain
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipRegex.test(domain)) {
      issues.push('ip_address');
    }
    
    // Check for suspicious keywords in subdomain
    const subdomain = domainParts.length > 2 ? domainParts[0] : '';
    if (subdomain && SUSPICIOUS_KEYWORDS.some(kw => subdomain.includes(kw))) {
      issues.push('suspicious_subdomain');
    }
    
    // Check for suspicious query parameters
    if (url.search.length > 200) {
      issues.push('suspicious_params');
    }
    
    // Check for encoded/obfuscated URLs
    try {
      const decoded = decodeURIComponent(url.href);
      if (url.href !== decoded && url.href.includes('%')) {
        issues.push('encoded_url');
      }
    } catch {
      // URL encoding is fine
    }
    
    // Check for excessive path depth (potential obfuscation)
    const pathDepth = url.pathname.split('/').filter(p => p.length > 0).length;
    if (pathDepth > 5) {
      issues.push('deep_path');
    }
    
    // Check for suspicious port numbers
    if (url.port && url.port !== '80' && url.port !== '443' && parseInt(url.port) < 1024) {
      issues.push('non_standard_port');
    }
    
    // Check domain age indicators (new domains are riskier)
    // This would require WHOIS lookup, but we can check for common new domain patterns
    if (domainParts.length === 2 && domainParts[0].length < 3) {
      issues.push('very_short_domain');
    }
    
    // Check for domain name similarity to known brands (typosquatting/phishing)
    const suspiciousSimilarity = checkDomainSimilarity(domain);
    if (suspiciousSimilarity) {
      // High severity issue - typosquatting is a major phishing indicator
      issues.push(`PHISHING_RISK: Possible typosquatting of "${suspiciousSimilarity}" (e.g., "${domain}" looks like "${suspiciousSimilarity}")`);
    }
    
    // Enhanced link analysis: Check <a> tag attributes and markers
    // Check for target="_blank" without rel="noopener" (security risk)
    const hasTargetBlank = link.target === '_blank' || link.target === 'blank';
    const hasNoopener = link.rel?.includes('noopener') || false;
    if (hasTargetBlank && !hasNoopener) {
      issues.push('target_blank_without_noopener');
    }
    
    // Check for download attribute (could be used for malicious downloads)
    if (link.download) {
      flags.hasDownload = true;
      // Only flag if combined with other suspicious indicators
      if (issues.length > 0) {
        issues.push('download_attribute');
      }
    }
    
    // Check for www.example.com patterns in link text or href
    const examplePatterns = [
      /www\.example\.com/i,
      /example\.com/i,
      /example\.org/i,
      /example\.net/i,
      /test\.com/i,
      /placeholder\.com/i,
      /lorem\.com/i,
      /demo\.com/i,
      /sample\.com/i
    ];
    
    const linkText = (link.text || '').toLowerCase();
    const linkHref = link.href.toLowerCase();
    
    for (const pattern of examplePatterns) {
      if (pattern.test(linkText) || pattern.test(linkHref)) {
        issues.push('example_placeholder_domain');
        break;
      }
    }
    
    // Check for suspicious markers in link text
    const suspiciousTextMarkers = [
      /click\s+here/i,
      /download\s+now/i,
      /free\s+download/i,
      /urgent/i,
      /verify\s+account/i,
      /update\s+now/i,
      /confirm\s+identity/i,
      /suspended\s+account/i,
      /limited\s+time/i,
      /act\s+now/i
    ];
    
    // Only flag if text markers are present AND domain is suspicious
    if (suspiciousTextMarkers.some(pattern => pattern.test(linkText))) {
      if (issues.length > 0 || !flags.isKnownSafe) {
        issues.push('suspicious_link_text');
      }
    }
    
    // Check for data: or javascript: protocols (already filtered in extractLinks, but double-check)
    if (link.href.startsWith('data:') || link.href.startsWith('javascript:')) {
      issues.push('dangerous_protocol');
    }
    
    // Check for mailto: links with suspicious patterns
    if (link.href.startsWith('mailto:')) {
      const emailPattern = /mailto:([^?]+)/i;
      const match = link.href.match(emailPattern);
      if (match) {
        const email = match[1].toLowerCase();
        // Check for suspicious email patterns
        if (email.includes('noreply') || email.includes('no-reply') || 
            email.includes('support') || email.includes('security') ||
            email.includes('verify') || email.includes('update')) {
          flags.hasMailto = true;
        }
      }
    }
    
    // Positive flags
    flags.hasNoopener = link.rel?.includes('noopener') || false;
    flags.hasNoreferrer = link.rel?.includes('noreferrer') || false;
    flags.isKnownSafe = KNOWN_SAFE_DOMAINS.has(domain) || KNOWN_SAFE_DOMAINS.has(baseDomain) || false;
    flags.hasValidDomain = domainParts.length >= 2 && domainParts.every(part => part.length > 0);
    
    // Check for valid domain structure
    if (flags.hasValidDomain && !issues.includes('ip_address') && !issues.includes('punycode')) {
      flags.hasValidDomain = true;
    }
    
  } catch (err) {
    issues.push('invalid_url');
  }
  
  return { issues, flags };
}

/**
 * Common character confusions used in typosquatting
 */
const CHARACTER_CONFUSIONS: Record<string, string[]> = {
  'm': ['rn', 'nn', 'w'],
  'n': ['m', 'h', 'u'],
  'r': ['n', 'p'],
  'g': ['q', '9', '6'],
  'o': ['0', 'q', 'd'],
  'i': ['l', '1', 'j'],
  'l': ['i', '1', 't'],
  't': ['f', 'l', 'y'],
  'y': ['v', 't'],
  'v': ['y', 'u'],
  'u': ['v', 'n'],
  'c': ['e', 'o', 'g'],
  'e': ['c', 'o'],
  'a': ['o', 'e'],
  's': ['5', 'z'],
  'z': ['s', '2'],
  '0': ['o', 'O'],
  '1': ['i', 'l'],
  '5': ['s', 'S'],
  '6': ['g', 'G'],
  '9': ['g', 'q']
};

/**
 * Check for common typosquatting patterns
 */
function checkTyposquattingPatterns(domainBase: string, brand: string): boolean {
  // Check for character confusion patterns (rn->m, ci->gi, etc.)
  const patterns = [
    { from: 'rn', to: 'm' }, // rnicrosoft -> microsoft
    { from: 'ci', to: 'gi' }, // cithub -> github
    { from: 'tu', to: 'you' }, // tube -> youtube (partial)
    { from: 'vv', to: 'w' },
    { from: 'cl', to: 'd' },
    { from: '0', to: 'o' },
    { from: '1', to: 'i' },
    { from: '5', to: 's' }
  ];
  
  let normalizedDomain = domainBase.toLowerCase();
  let normalizedBrand = brand.toLowerCase();
  
  // Special case: "toutube" -> "youtube" (t instead of you)
  if (normalizedDomain.startsWith('t') && normalizedBrand.startsWith('you')) {
    const domainRest = normalizedDomain.substring(1);
    const brandRest = normalizedBrand.substring(3); // Skip "you"
    if (domainRest === brandRest) {
      return true; // "toutube" matches "youtube"
    }
  }
  
  // Special case: domains ending in "tube" trying to mimic "youtube"
  if (normalizedDomain.endsWith('tube') && normalizedBrand === 'youtube') {
    // Check if it's a variation like "toutube", "youtub", "youtbe", etc.
    if (normalizedDomain.length >= 5 && normalizedDomain.length <= 8) {
      const similarity = calculateSimilarity(normalizedDomain, normalizedBrand);
      if (similarity > 0.7) {
        return true;
      }
    }
  }
  
  // Try pattern replacements
  for (const pattern of patterns) {
    if (normalizedDomain.includes(pattern.from) && normalizedBrand.includes(pattern.to)) {
      const testDomain = normalizedDomain.replace(pattern.from, pattern.to);
      if (testDomain === normalizedBrand || calculateSimilarity(testDomain, normalizedBrand) > 0.9) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Comprehensive list of known brands to check for typosquatting
 */
const KNOWN_BRANDS = [
  // Tech companies
  'google', 'microsoft', 'apple', 'amazon', 'facebook', 'meta',
  'twitter', 'x', 'instagram', 'linkedin', 'youtube', 'tiktok',
  'github', 'gitlab', 'bitbucket', 'stackoverflow', 'reddit',
  'netflix', 'spotify', 'twitch', 'discord', 'telegram',
  
  // E-commerce & Finance
  'paypal', 'stripe', 'shopify', 'ebay', 'etsy', 'alibaba',
  'visa', 'mastercard', 'americanexpress', 'chase', 'bankofamerica',
  
  // Cloud & Services
  'aws', 'azure', 'dropbox', 'onedrive', 'icloud', 'gmail',
  'outlook', 'hotmail', 'yahoo',
  
  // Software & Tools
  'adobe', 'autodesk', 'oracle', 'salesforce', 'zoom', 'slack',
  'microsoft', 'office', 'teams',
  
  // News & Media
  'bbc', 'cnn', 'reuters', 'nytimes', 'washingtonpost', 'theguardian',
  'wikipedia', 'wikimedia',
  
  // Education
  'coursera', 'edx', 'udemy', 'khanacademy',
  
  // Common words that phishers target
  'bank', 'secure', 'verify', 'update', 'account', 'login', 'confirm'
];

/**
 * Check if domain might be typosquatting a known brand
 * Enhanced detection for phishing domains like "rnicrosoft", "cithub", "toutube"
 */
function checkDomainSimilarity(domain: string): string | null {
  const domainBase = domain.split('.')[0].toLowerCase();
  
  for (const brand of KNOWN_BRANDS) {
    const brandLower = brand.toLowerCase();
    
    // Skip if exact match (it's the real brand)
    if (domainBase === brandLower) {
      continue;
    }
    
    // Check length similarity (typosquatting domains are usually similar length)
    const lengthDiff = Math.abs(domainBase.length - brandLower.length);
    if (lengthDiff > 3) {
      continue; // Too different in length
    }
    
    // Check for common typosquatting patterns first (rn->m, ci->gi, etc.)
    if (checkTyposquattingPatterns(domainBase, brandLower)) {
      return brand;
    }
    
    // Check character similarity using Levenshtein distance
    const similarity = calculateSimilarity(domainBase, brandLower);
    
    // More sensitive threshold for typosquatting (0.65 instead of 0.7)
    // This catches cases like "rnicrosoft" (similarity ~0.85) or "cithub" (similarity ~0.8)
    if (similarity > 0.65 && similarity < 1.0) {
      // Additional check: if it's very similar but not exact, it's likely typosquatting
      if (similarity > 0.75) {
        return brand; // High similarity = likely typosquatting
      }
      
      // For medium similarity, check if it's a common character confusion
      const hasCommonConfusion = checkCharacterConfusions(domainBase, brandLower);
      if (hasCommonConfusion) {
        return brand;
      }
    }
    
    // Check for homoglyph attacks (visually similar characters)
    if (checkHomoglyphs(domainBase, brandLower)) {
      return brand;
    }
  }
  
  return null;
}

/**
 * Check for common character confusions
 */
function checkCharacterConfusions(str1: string, str2: string): boolean {
  if (str1.length !== str2.length) return false;
  
  let confusionCount = 0;
  for (let i = 0; i < str1.length; i++) {
    const char1 = str1[i];
    const char2 = str2[i];
    
    if (char1 === char2) continue;
    
    // Check if characters are commonly confused
    const confusions1 = CHARACTER_CONFUSIONS[char1] || [];
    const confusions2 = CHARACTER_CONFUSIONS[char2] || [];
    
    if (confusions1.includes(char2) || confusions2.includes(char1)) {
      confusionCount++;
    }
  }
  
  // If more than 30% of characters are confusions, it's likely typosquatting
  return confusionCount > str1.length * 0.3;
}

/**
 * Check for homoglyph attacks (visually similar but different Unicode characters)
 */
function checkHomoglyphs(str1: string, str2: string): boolean {
  // Common homoglyph pairs
  const homoglyphs: Record<string, string[]> = {
    'a': ['а', 'а'], // Cyrillic 'a'
    'e': ['е', 'е'], // Cyrillic 'e'
    'o': ['о', 'о'], // Cyrillic 'o'
    'p': ['р', 'р'], // Cyrillic 'p'
    'c': ['с', 'с'], // Cyrillic 'c'
    'x': ['х', 'х'], // Cyrillic 'x'
    'y': ['у', 'у'], // Cyrillic 'y'
    'm': ['м', 'м'], // Cyrillic 'm'
    'h': ['н', 'н']  // Cyrillic 'h'
  };
  
  if (str1.length !== str2.length) return false;
  
  for (let i = 0; i < str1.length; i++) {
    const char1 = str1[i];
    const char2 = str2[i];
    
    if (char1 === char2) continue;
    
    // Check if one is a homoglyph of the other
    const homos1 = homoglyphs[char1.toLowerCase()] || [];
    const homos2 = homoglyphs[char2.toLowerCase()] || [];
    
    if (homos1.includes(char2) || homos2.includes(char1)) {
      return true; // Found a homoglyph
    }
  }
  
  return false;
}

/**
 * Simple Levenshtein-based similarity
 */
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

