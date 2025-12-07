/**
 * Sanitize text for GPT input - remove PII and limit length
 */
/**
 * Extension marker patterns that indicate a link was already processed
 */
const EXTENSION_MARKER_PATTERNS = [
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
  /phishing\s*risk/i,
  /SmartTrust/i,
  /smarttrust/i
];

/**
 * Check if text contains extension markers (link already processed)
 */
export function hasExtensionMarker(text: string | undefined | null): boolean {
  if (!text || text.trim().length === 0) return false;
  
  const normalizedText = text.replace(/\s+/g, ' ');
  return EXTENSION_MARKER_PATTERNS.some(pattern => 
    pattern.test(text) || pattern.test(normalizedText)
  );
}

export function sanitizeForGpt(text: string): string {
  if (!text) return '';
  
  // Remove email-like patterns
  let sanitized = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[email]');
  
  // Remove phone numbers
  sanitized = sanitized.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[phone]');
  
  // Remove credit card patterns
  sanitized = sanitized.replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, '[card]');
  
  // Limit length
  return sanitized.slice(0, 1000);
}

