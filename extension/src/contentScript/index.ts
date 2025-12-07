import type { LinkMeta, MessageType, LinkAnalysis, TrustVerdict } from '../types';

/**
 * Extract text snippet around an element (max chars)
 */
function snippetAround(element: Element, maxChars: number = 200): string {
  const parent = element.parentElement;
  if (!parent) return '';
  
  const text = parent.textContent || '';
  const elementIndex = Array.from(parent.childNodes).findIndex(
    (node) => node === element || node.contains?.(element)
  );
  
  if (elementIndex === -1) return text.slice(0, maxChars);
  
  const start = Math.max(0, elementIndex - maxChars / 2);
  return text.slice(start, start + maxChars).trim();
}

/**
 * Extract page context for AI analysis
 */
function extractPageContext(): string {
  const title = document.title || '';
  const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  const h1 = document.querySelector('h1')?.textContent || '';
  
  // Get more comprehensive page content
  const paragraphs = Array.from(document.querySelectorAll('p'))
    .map(p => p.textContent?.trim())
    .filter(Boolean)
    .slice(0, 5) // Get first 5 paragraphs
    .join(' ');
  
  // Get headings for structure
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .map(h => h.textContent?.trim())
    .filter(Boolean)
    .slice(0, 5)
    .join(' | ');
  
  // Get page URL and domain for context
  const pageUrl = window.location.href;
  const pageDomain = window.location.hostname;
  
  // Combine all context (increased to 3000 chars for better context)
  const context = `Page URL: ${pageUrl}
Page Domain: ${pageDomain}
Page Title: ${title}
Meta Description: ${metaDescription}
Main Heading: ${h1}
Section Headings: ${headings}
Content: ${paragraphs}`.trim();
  
  return context.slice(0, 3000); // Increased from 1000 to 3000
}

/**
 * Extension markers that indicate the link was already processed
 * Includes various combinations and patterns
 */
const EXTENSION_MARKERS = [
  '⚠', '⚠️', 'Caution', '⚠ Caution', '⚠️ Caution',
  '☠', 'Dangerous', 'Risk',
  '✓', '✅', 'Safe', '[SAFE]',
  '❌', 'Block', '[DANGEROUS]', '[SUSPICIOUS]',
  'Safey', 'safey',
  'Trust Score', 'trust score',
  'PHISHING', 'phishing', 'Typosquatting', 'typosquatting'
];

/**
 * Check if link text contains extension markers
 * More comprehensive detection including partial matches
 */
function hasExtensionMarker(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  
  const lowerText = text.toLowerCase();
  const normalizedText = text.replace(/\s+/g, ' '); // Normalize whitespace
  
  // Check for exact marker matches
  for (const marker of EXTENSION_MARKERS) {
    const lowerMarker = marker.toLowerCase();
    if (lowerText.includes(lowerMarker) || normalizedText.includes(marker)) {
      return true;
    }
  }
  
  // Check for pattern matches (e.g., "⚠ Caution", "⚠️ Caution", etc.)
  const markerPatterns = [
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
    /phishing\s*risk/i
  ];
  
  return markerPatterns.some(pattern => pattern.test(text) || pattern.test(normalizedText));
}

/**
 * Trusted domains list (matches backend list)
 */
const TRUSTED_DOMAINS = new Set([
  'google.com', 'youtube.com', 'gmail.com', 'github.com', 'microsoft.com',
  'apple.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
  'linkedin.com', 'amazon.com', 'netflix.com', 'spotify.com', 'reddit.com',
  'wikipedia.org', 'stackoverflow.com', 'mozilla.org', 'firefox.com',
  'office.com', 'outlook.com', 'live.com', 'hotmail.com', 'bing.com',
  'azure.com', 'aws.amazon.com', 'cloud.google.com', 'dropbox.com',
  'adobe.com', 'zoom.us', 'slack.com', 'discord.com', 'telegram.org',
  'paypal.com', 'stripe.com', 'shopify.com', 'ebay.com', 'etsy.com',
  'bbc.com', 'cnn.com', 'reuters.com', 'theguardian.com', 'nytimes.com',
  'coursera.org', 'edx.org', 'khanacademy.org', 'udemy.com',
  'docker.com', 'kubernetes.io', 'nodejs.org', 'python.org',
  'npmjs.com', 'pypi.org', 'gitlab.com', 'bitbucket.org'
]);

/**
 * Check if domain is trusted (including subdomains)
 */
function isTrustedDomain(domain: string): boolean {
  const domainLower = domain.toLowerCase();
  const domainParts = domainLower.split('.');
  
  // Check exact match
  if (TRUSTED_DOMAINS.has(domainLower)) {
    return true;
  }
  
  // Check base domain (e.g., 'mail.google.com' -> 'google.com')
  if (domainParts.length >= 2) {
    const baseDomain = domainParts.slice(-2).join('.');
    if (TRUSTED_DOMAINS.has(baseDomain)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Extract link metadata from DOM
 * Speed optimizations:
 * - Skip same-domain links (trusted)
 * - Skip trusted/renowned domains (google.com, youtube.com, etc.)
 * - Skip links with extension markers (already processed)
 * - Skip fragment-only links
 */
function extractLinks(): LinkMeta[] {
  const results: LinkMeta[] = [];
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  const currentDomain = window.location.hostname;
  
  for (const a of anchors) {
    try {
      const href = (a as HTMLAnchorElement).href;
      if (!href || href.startsWith('javascript:') || href.startsWith('data:')) {
        continue;
      }
      
      const url = new URL(href, location.href);
      const text = (a.textContent || '').trim().slice(0, 200);
      
      // Speed optimization: Skip same-domain links (trusted)
      if (url.hostname === currentDomain) {
        continue;
      }
      
      // Speed optimization: Skip trusted/renowned domains (no AI check needed)
      if (isTrustedDomain(url.hostname)) {
        continue;
      }
      
      // Speed optimization: Skip fragment-only links (same page)
      if (url.href.split('#')[0] === window.location.href.split('#')[0]) {
        continue;
      }
      
      // Speed optimization: Skip links with extension markers (already processed)
      if (hasExtensionMarker(text)) {
        continue;
      }
      
      // Speed optimization: Skip links that are already highlighted
      if (a.hasAttribute('data-smarttrust-highlight')) {
        continue;
      }
      
      results.push({
        href: url.href,
        text: text || url.href,
        rel: a.getAttribute('rel') || undefined,
        target: a.getAttribute('target') || undefined,
        download: a.getAttribute('download') || undefined,
        contextSnippet: snippetAround(a, 200),
        targetDomain: url.hostname,
        elementSelector: generateSelector(a)
      });
    } catch (e) {
      // Skip invalid URLs
      console.debug('Skipping invalid link:', e);
    }
  }
  
  return results;
}

/**
 * Generate a simple CSS selector for an element (for later highlighting)
 */
function generateSelector(element: Element): string {
  if (element.id) return `#${element.id}`;
  if (element.className) {
    const classes = element.className.split(/\s+/).filter(Boolean);
    if (classes.length > 0) {
      return `${element.tagName.toLowerCase()}.${classes[0]}`;
    }
  }
  return element.tagName.toLowerCase();
}

// Debounce for scan operations
let scanDebounceTimer: number | null = null;
let isScanning = false;

/**
 * Batch links and send to background script
 * Optimized for speed: smaller batches, faster processing, reduced overhead
 */
async function scanAndSendLinks() {
  // Prevent concurrent scans
  if (isScanning) return;
  isScanning = true;
  
  try {
    // Check if extension is enabled for this domain
    const domain = window.location.hostname;
    const response = await chrome.runtime.sendMessage({
      type: 'GET_SITE_STATUS',
      domain
    } as MessageType);
    
    if (!response?.enabled) {
      return; // Extension disabled for this site
    }
    
    // Extract links (already optimized with filtering)
    const allLinks = extractLinks();
    
    // Speed optimization: Reduce batch size for faster initial response
    const BATCH_SIZE = 20; // Reduced from 50 for faster processing
    
    // Process first batch immediately for instant feedback
    if (allLinks.length > 0) {
      const firstBatch = allLinks.slice(0, BATCH_SIZE);
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'LINK_BATCH',
          payload: firstBatch,
          sourcePageContext: extractPageContext()
        } as MessageType);
        
        if (response?.analyses) {
          highlightLinks(response.analyses);
        }
      } catch (err) {
        console.error('Error sending link batch:', err);
      }
    }
    
    // Process remaining batches asynchronously with minimal delay
    for (let i = BATCH_SIZE; i < allLinks.length; i += BATCH_SIZE) {
      const batch = allLinks.slice(i, i + BATCH_SIZE);
      
      // Use requestIdleCallback for non-blocking processing
      if ('requestIdleCallback' in window) {
        requestIdleCallback(async () => {
          try {
            const response = await chrome.runtime.sendMessage({
              type: 'LINK_BATCH',
              payload: batch,
              sourcePageContext: extractPageContext()
            } as MessageType);
            
            if (response?.analyses) {
              highlightLinks(response.analyses);
            }
          } catch (err) {
            console.error('Error sending link batch:', err);
          }
        }, { timeout: 100 });
      } else {
        setTimeout(async () => {
          try {
            const response = await chrome.runtime.sendMessage({
              type: 'LINK_BATCH',
              payload: batch,
              sourcePageContext: extractPageContext()
            } as MessageType);
            
            if (response?.analyses) {
              highlightLinks(response.analyses);
            }
          } catch (err) {
            console.error('Error sending link batch:', err);
          }
        }, 10); // Minimal delay
      }
    }
  } finally {
    isScanning = false;
  }
}

// Cache for link elements to avoid repeated DOM queries
const linkElementCache = new Map<string, HTMLElement>();
const highlightedLinks = new Map<string, string>(); // href -> category
const linkVerdicts = new Map<string, TrustVerdict>(); // href -> verdict (for hover modals)
const hoverTimeouts = new Map<string, number>(); // href -> timeout ID (for hover delay)
const hoverHandlers = new WeakMap<HTMLElement, { enter: (e: Event) => void; leave: (e: Event) => void }>(); // element -> handlers

/**
 * Highlight links on the page based on their trust verdicts
 * Optimized for speed: incremental updates, skips safe links, uses requestAnimationFrame
 */
function highlightLinks(analyses: LinkAnalysis[]) {
  // Use requestAnimationFrame for smooth, non-blocking updates
  requestAnimationFrame(() => {
    const updates: Array<{ element: HTMLElement; category: string; styles: any; verdict: TrustVerdict; href: string }> = [];
    
    // Speed optimization: Only process non-safe links (skip highlighting safe links)
    const nonSafeAnalyses = analyses.filter(({ verdict }) => {
      const hasPhishingRisk = verdict.issues.some((issue: string) => issue.includes('PHISHING_RISK') || issue.includes('typosquatting'));
      return verdict.category !== 'SAFE' || hasPhishingRisk;
    });
    
    // Incremental update: only process changed links
    for (const { link, verdict } of nonSafeAnalyses) {
      try {
        const category = verdict.category;
        const hasPhishingRisk = verdict.issues.some((issue: string) => issue.includes('PHISHING_RISK') || issue.includes('typosquatting'));
        
        // Check if already highlighted with same category (skip if unchanged)
        const currentCategory = highlightedLinks.get(link.href);
        if (currentCategory === category && !hasPhishingRisk) {
          continue; // Skip unchanged links
        }
        
        // Get cached element or find it
        let linkElement = linkElementCache.get(link.href);
        if (!linkElement) {
          // Try multiple selectors to find the link
          linkElement = document.querySelector(`a[href="${CSS.escape(link.href)}"]`) as HTMLElement;
          if (!linkElement) {
            // Try finding by exact href match (handles URL encoding differences)
            const allLinks = document.querySelectorAll('a[href]');
            for (const a of Array.from(allLinks)) {
              const anchor = a as HTMLAnchorElement;
              try {
                if (anchor.href === link.href || decodeURIComponent(anchor.href) === decodeURIComponent(link.href)) {
                  linkElement = anchor;
                  break;
                }
              } catch (e) {
                // Continue if URL parsing fails
              }
            }
          }
          if (!linkElement) {
            console.debug(`[Hover] Could not find element for link: ${link.href}`);
            continue;
          }
          linkElementCache.set(link.href, linkElement);
        }
        
        // Determine styles
        let styles: {
          borderColor: string;
          bgColor: string;
          badgeColor: string;
          badgeText: string;
          badgeIcon: string;
        };

        if (hasPhishingRisk) {
          styles = {
            borderColor: '#dc2626',
            bgColor: 'rgba(220, 38, 38, 0.15)',
            badgeColor: '#dc2626',
            badgeText: 'PHISHING',
            badgeIcon: '🚨'
          };
        } else if (category === 'SUSPICIOUS') {
          styles = {
            borderColor: '#f59e0b',
            bgColor: 'rgba(245, 158, 11, 0.08)',
            badgeColor: '#f59e0b',
            badgeText: 'Caution',
            badgeIcon: '⚠'
          };
        } else {
          styles = {
            borderColor: '#ef4444',
            bgColor: 'rgba(239, 68, 68, 0.08)',
            badgeColor: '#ef4444',
            badgeText: 'Risk',
            badgeIcon: '⚠'
          };
        }
        
        updates.push({ element: linkElement, category, styles, verdict, href: link.href });
        highlightedLinks.set(link.href, category);
        linkVerdicts.set(link.href, verdict); // Store verdict for hover modal
      } catch (err) {
        console.debug('Error preparing link highlight:', err);
      }
    }
    
    // Batch DOM updates
    updates.forEach(({ element, category, styles, verdict, href }) => {
      try {
        const score = verdict.trustScore;
        const hasPhishingRisk = verdict.issues.some((issue: string) => issue.includes('PHISHING_RISK') || issue.includes('typosquatting'));
        
        // Update styles efficiently
        element.style.position = 'relative';
        element.style.borderBottom = `2px solid ${styles.borderColor}`;
        element.style.backgroundColor = styles.bgColor;
        element.style.transition = 'all 0.2s ease';
        element.style.padding = '1px 2px';
        element.style.borderRadius = '2px';
        element.setAttribute('data-smarttrust-highlight', category);
        
        // Update tooltip
        let tooltipText = `SmartTrust: ${(score * 100).toFixed(0)}% Trust Score`;
        if (hasPhishingRisk) {
          const phishingIssue = verdict.issues.find((issue: string) => issue.includes('PHISHING_RISK') || issue.includes('typosquatting'));
          tooltipText = `🚨 PHISHING RISK!\n${phishingIssue || 'Possible typosquatting detected'}\n\n${tooltipText}`;
        } else if (verdict.issues.length > 0) {
          tooltipText += `\n${verdict.issues.slice(0, 3).join(', ')}`;
        }
        element.setAttribute('title', tooltipText);

        // Update badge (only for suspicious/dangerous)
        let badge = element.querySelector('[data-smarttrust-badge]') as HTMLElement;
        if (!badge) {
          badge = document.createElement('span');
          badge.setAttribute('data-smarttrust-badge', 'true');
          badge.style.cssText = `
            position: absolute;
            top: -8px;
            right: -8px;
            background: ${styles.badgeColor};
            color: white;
            font-size: 10px;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            z-index: 1000;
            white-space: nowrap;
            font-family: system-ui, -apple-system, sans-serif;
            pointer-events: none;
            line-height: 1.2;
          `;
          element.appendChild(badge);
        }
        badge.style.background = styles.badgeColor;
        badge.textContent = `${styles.badgeIcon} ${styles.badgeText}`;
        
        // Add hover handler for caution/risk links (SUSPICIOUS or DANGEROUS)
        if (category === 'SUSPICIOUS' || category === 'DANGEROUS' || hasPhishingRisk) {
          // Use the actual element href, not the passed href
          const elementHref = (element as HTMLAnchorElement).href || href;
          console.debug(`[Hover] Setting up hover modal for: ${elementHref}, category: ${category}`);
          setupHoverModal(element, elementHref, verdict);
        }
      } catch (err) {
        console.debug('Error highlighting link:', err);
      }
    });
    
    // Clean up removed links from cache
    const currentHrefs = new Set(analyses.map(a => a.link.href));
    for (const [href, category] of highlightedLinks.entries()) {
      if (!currentHrefs.has(href)) {
        const element = linkElementCache.get(href);
        if (element) {
          element.removeAttribute('data-smarttrust-highlight');
          const badge = element.querySelector('[data-smarttrust-badge]');
          if (badge) badge.remove();
          element.style.borderBottom = '';
          element.style.backgroundColor = '';
          // Remove hover handlers
          const handlers = hoverHandlers.get(element);
          if (handlers) {
            element.removeEventListener('mouseenter', handlers.enter);
            element.removeEventListener('mouseleave', handlers.leave);
            hoverHandlers.delete(element);
          }
          // Close any open modals
          const existingModal = document.querySelector('[data-smarttrust-hover-modal]');
          if (existingModal) {
            existingModal.remove();
          }
        }
        highlightedLinks.delete(href);
        linkElementCache.delete(href);
        linkVerdicts.delete(href); // Clean up verdict cache
        // Clean up hover timeout if exists
        const timeoutId = hoverTimeouts.get(href);
        if (timeoutId) {
          clearTimeout(timeoutId);
          hoverTimeouts.delete(href);
        }
      }
    }
  });
}

/**
 * Show loading spinner on a link element
 */
function showLoadingSpinner(element: HTMLElement): void {
  // Remove any existing spinner
  const existingSpinner = element.querySelector('[data-smarttrust-loading]');
  if (existingSpinner) {
    existingSpinner.remove();
  }
  
  // Create spinner element
  const spinner = document.createElement('div');
  spinner.setAttribute('data-smarttrust-loading', 'true');
  spinner.style.cssText = `
    position: absolute;
    top: -2px;
    right: -2px;
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: smarttrust-spin 0.8s linear infinite;
    z-index: 1001;
    pointer-events: none;
  `;
  
  // Add animation if not already added
  if (!document.querySelector('#smarttrust-spinner-style')) {
    const style = document.createElement('style');
    style.id = 'smarttrust-spinner-style';
    style.textContent = `
      @keyframes smarttrust-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
  
  // Ensure parent has position relative
  const computedStyle = window.getComputedStyle(element);
  if (computedStyle.position === 'static') {
    element.style.position = 'relative';
  }
  
  element.appendChild(spinner);
}

/**
 * Hide loading spinner from a link element
 */
function hideLoadingSpinner(element: HTMLElement): void {
  const spinner = element.querySelector('[data-smarttrust-loading]');
  if (spinner) {
    spinner.remove();
  }
}

/**
 * Setup hover modal for caution/risk links
 * Shows modal after 1 second of hovering
 */
function setupHoverModal(element: HTMLElement, href: string, verdict: TrustVerdict): void {
  // Verify element is valid
  if (!element || !element.isConnected) {
    console.debug('[Hover] Element not connected to DOM, skipping hover setup');
    return;
  }
  
  // Get the actual href from the element (anchor tag)
  const anchor = element as HTMLAnchorElement;
  const linkHref = anchor.href || href || element.getAttribute('href') || '';
  
  if (!linkHref) {
    console.debug('[Hover] No href found for element, skipping hover setup');
    return;
  }
  
  // Remove existing hover handlers to avoid duplicates
  const existingHandlers = hoverHandlers.get(element);
  if (existingHandlers) {
    element.removeEventListener('mouseenter', existingHandlers.enter, true);
    element.removeEventListener('mouseleave', existingHandlers.leave, true);
  }
  
  const handleMouseEnter = (e: Event) => {
    e.stopPropagation();
    
    // Mark element as being hovered
    element.setAttribute('data-smarttrust-hovering', 'true');
    
    // Trigger priority AI analysis on hover
    const storedVerdict = linkVerdicts.get(linkHref);
    const hasAIAnalysis = storedVerdict?.gptSummary && !storedVerdict.gptSummary.includes('not available');
    
    if (!hasAIAnalysis) {
      // Show loading spinner
      showLoadingSpinner(element);
      
      // Trigger priority AI analysis
      chrome.runtime.sendMessage({
        type: 'AI_ANALYZE_LINK',
        link: {
          href: linkHref,
          text: (element.textContent || '').trim() || linkHref,
          targetDomain: new URL(linkHref).hostname
        },
        domain: window.location.hostname,
        priority: true
      } as MessageType).catch(err => {
        console.debug('[Hover] Could not trigger priority AI analysis:', err);
        hideLoadingSpinner(element);
      });
    }
    
    // Clear any existing timeout for this link
    const existingTimeout = hoverTimeouts.get(linkHref);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    // Set timeout to show modal after 1 second
    const timeoutId = window.setTimeout(() => {
      // Double-check element is still being hovered
      if (element.getAttribute('data-smarttrust-hovering') === 'true') {
        const currentVerdict = linkVerdicts.get(linkHref) || verdict;
        const linkText = (element.textContent || '').trim() || linkHref;
        console.debug(`[Hover] Showing modal for: ${linkHref}`);
        showHoverModal(linkHref, linkText, currentVerdict, element);
      }
      hoverTimeouts.delete(linkHref);
    }, 1000); // 1 second delay
    
    hoverTimeouts.set(linkHref, timeoutId);
  };
  
  const handleMouseLeave = (e: Event) => {
    e.stopPropagation();
    
    // Remove hover marker
    element.removeAttribute('data-smarttrust-hovering');
    
    const relatedTarget = (e as MouseEvent).relatedTarget as HTMLElement;
    
    // Don't close if mouse is moving to the modal
    if (relatedTarget && relatedTarget.closest('[data-smarttrust-hover-modal]')) {
      return; // Mouse is moving to modal, don't close
    }
    
    // Clear timeout if mouse leaves before 1 second
    const timeoutId = hoverTimeouts.get(linkHref);
    if (timeoutId) {
      clearTimeout(timeoutId);
      hoverTimeouts.delete(linkHref);
    }
    
    // Close modal with a delay to allow mouse to move to modal
    setTimeout(() => {
      const modal = document.querySelector('[data-smarttrust-hover-modal]');
      if (modal) {
        // Check if mouse is over modal or link using elementFromPoint for accuracy
        const mouseX = (e as MouseEvent).clientX;
        const mouseY = (e as MouseEvent).clientY;
        const elementUnderMouse = document.elementFromPoint(mouseX, mouseY);
        const isOverModal = elementUnderMouse?.closest('[data-smarttrust-hover-modal]');
        const isOverLink = elementUnderMouse === element || element.contains(elementUnderMouse as Node);
        
        if (!isOverLink && !isOverModal) {
          modal.remove();
        }
      }
    }, 200); // Delay to allow mouse to move to modal
  };
  
  // Store handlers for cleanup
  hoverHandlers.set(element, { enter: handleMouseEnter, leave: handleMouseLeave });
  
  // Add new hover handlers with capture phase to catch events early
  element.addEventListener('mouseenter', handleMouseEnter, true);
  element.addEventListener('mouseleave', handleMouseLeave, true);
}

/**
 * Show hover modal with safety information
 */
function showHoverModal(href: string, linkText: string, verdict: TrustVerdict, linkElement: HTMLElement): void {
  // Remove any existing hover modals
  document.querySelectorAll('[data-smarttrust-hover-modal]').forEach(modal => modal.remove());
  
  const category = verdict.category;
  const trustScore = verdict.trustScore;
  const hasPhishingRisk = verdict.issues.some((issue: string) => issue.includes('PHISHING_RISK') || issue.includes('typosquatting'));
  
  // Create modal overlay
  const modal = document.createElement('div');
  modal.setAttribute('data-smarttrust-hover-modal', 'true');
  
  // Position modal near the link
  const rect = linkElement.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
  
  modal.style.cssText = `
    position: fixed;
    top: ${rect.bottom + scrollTop + 10}px;
    left: ${rect.left + scrollLeft}px;
    background: white;
    padding: 16px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 2147483646;
    max-width: 400px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    border: 2px solid ${category === 'DANGEROUS' || hasPhishingRisk ? '#dc2626' : '#f59e0b'};
    pointer-events: auto;
  `;
  
  // Title
  const title = document.createElement('div');
  title.style.cssText = `font-weight: 600; font-size: 14px; margin-bottom: 8px; color: ${category === 'DANGEROUS' || hasPhishingRisk ? '#dc2626' : '#f59e0b'};`;
  title.textContent = hasPhishingRisk ? '🚨 Phishing Risk!' : category === 'DANGEROUS' ? '⚠️ Dangerous Link' : '⚠️ Caution';
  modal.appendChild(title);
  
  // Trust score
  const score = document.createElement('div');
  score.style.cssText = 'margin-bottom: 8px; color: #666;';
  score.textContent = `Trust Score: ${(trustScore * 100).toFixed(0)}%`;
  modal.appendChild(score);
  
  // Issues/Reasons
  if (verdict.issues && verdict.issues.length > 0) {
    const issuesDiv = document.createElement('div');
    issuesDiv.style.cssText = 'margin-bottom: 8px;';
    const issuesTitle = document.createElement('div');
    issuesTitle.style.cssText = 'font-weight: 600; margin-bottom: 4px; color: #333;';
    issuesTitle.textContent = 'Security Issues:';
    issuesDiv.appendChild(issuesTitle);
    
    const issuesList = document.createElement('ul');
    issuesList.style.cssText = 'margin: 0; padding-left: 20px; color: #666;';
    verdict.issues.slice(0, 5).forEach((issue: string) => {
      const li = document.createElement('li');
      li.textContent = issue;
      issuesList.appendChild(li);
    });
    issuesDiv.appendChild(issuesList);
    modal.appendChild(issuesDiv);
  }
  
  // AI Summary if available
  if (verdict.gptSummary) {
    const summaryDiv = document.createElement('div');
    summaryDiv.style.cssText = 'margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb; color: #333;';
    const summaryTitle = document.createElement('div');
    summaryTitle.style.cssText = 'font-weight: 600; margin-bottom: 4px;';
    summaryTitle.textContent = '🤖 AI Analysis:';
    summaryDiv.appendChild(summaryTitle);
    const summaryText = document.createElement('div');
    summaryText.style.cssText = 'color: #666; font-size: 12px;';
    summaryText.textContent = verdict.gptSummary.slice(0, 300) + (verdict.gptSummary.length > 300 ? '...' : '');
    summaryDiv.appendChild(summaryText);
    modal.appendChild(summaryDiv);
  }
  
  // URL
  const urlDiv = document.createElement('div');
  urlDiv.style.cssText = 'margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #999; word-break: break-all;';
  urlDiv.textContent = href;
  modal.appendChild(urlDiv);
  
  document.body.appendChild(modal);
  
  // Keep modal open when hovering over it
  let modalHoverTimeout: number | null = null;
  let isModalHovered = false;
  
  modal.addEventListener('mouseenter', () => {
    isModalHovered = true;
    // Clear any close timeout when mouse enters modal
    if (modalHoverTimeout) {
      clearTimeout(modalHoverTimeout);
      modalHoverTimeout = null;
    }
  });
  
  modal.addEventListener('mouseleave', () => {
    isModalHovered = false;
    // Close modal when mouse leaves it (with small delay)
    modalHoverTimeout = window.setTimeout(() => {
      if (!isModalHovered && !linkElement.matches(':hover')) {
        modal.remove();
      }
      modalHoverTimeout = null;
    }, 300);
  });
  
  // Adjust position if modal goes off screen
  setTimeout(() => {
    const modalRect = modal.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    if (modalRect.right > viewportWidth) {
      modal.style.left = `${viewportWidth - modalRect.width - 10}px`;
    }
    if (modalRect.bottom > viewportHeight) {
      modal.style.top = `${rect.top + scrollTop - modalRect.height - 10}px`;
    }
    if (modalRect.left < 0) {
      modal.style.left = '10px';
    }
    if (modalRect.top < 0) {
      modal.style.top = '10px';
    }
  }, 0);
  
  console.debug(`[Hover] Modal displayed for: ${href}`);
}

/**
 * Check if a link is safe and should bypass confirmation modal
 */
function isSafeLink(href: string, verdict: TrustVerdict | null): boolean {
  try {
    const url = new URL(href, window.location.href);
    const currentDomain = window.location.hostname;
    
    // Same-domain links are safe
    if (url.hostname === currentDomain) {
      return true;
    }
    
    // Trusted domains are safe
    if (isTrustedDomain(url.hostname)) {
      return true;
    }
    
    // Links marked as SAFE are safe
    if (verdict?.category === 'SAFE') {
      return true;
    }
    
    // Links in cache marked as SAFE are safe
    const cachedCategory = highlightedLinks.get(href);
    if (cachedCategory === 'SAFE') {
      return true;
    }
    
    return false;
  } catch (err) {
    // Invalid URL, treat as unsafe to be cautious
    return false;
  }
}

/**
 * Intercept link clicks and show confirmation modal only for unsafe links
 * Safe links (trusted domains, same-domain, marked safe) bypass the modal
 */
function setupClickInterception() {
  document.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a[href]') as HTMLAnchorElement;
    
    if (!link) return;
    
    // Don't intercept if clicking on modal buttons
    if (target.closest('[data-smarttrust-modal]')) {
      return;
    }
    
    // Don't intercept if it's a same-page anchor link
    try {
      const url = new URL(link.href, window.location.href);
      if (url.href.split('#')[0] === window.location.href.split('#')[0] && url.hash) {
        return; // Allow same-page anchor links
      }
    } catch (err) {
      // Invalid URL, allow default behavior
      return;
    }
    
    try {
      const href = link.href;
      const linkText = link.textContent || href;
      
      // Get verdict for this link (if available) - do this before preventing default
      let verdict: TrustVerdict | null = null;
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_LINK_VERDICT',
          href
        } as MessageType);
        
        if (response && 'verdict' in response && response.verdict) {
          verdict = response.verdict;
        }
      } catch (err) {
        console.debug('Could not get link verdict:', err);
      }
      
      // Check if link is safe - if so, allow normal navigation
      if (isSafeLink(href, verdict)) {
        // Safe link - allow normal navigation, don't intercept
        return;
      }
      
      // Unsafe link - intercept and show confirmation modal
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      // Trigger priority AI analysis for clicked link (non-blocking)
      try {
        chrome.runtime.sendMessage({
          type: 'AI_ANALYZE_LINK',
          link: {
            href,
            text: linkText,
            targetDomain: new URL(href).hostname
          },
          domain: window.location.hostname,
          priority: true
        } as MessageType).catch(() => {});
      } catch (err) {
        console.debug('Could not trigger priority AI analysis:', err);
      }
      
      // Show confirmation modal for unsafe links only
      const proceed = await showConfirmationModal(href, linkText, verdict);
      
      // Only navigate if user explicitly confirms
      if (proceed) {
        window.location.href = href;
      }
    } catch (err) {
      console.error('Error intercepting click:', err);
      // On error, allow navigation (fail open)
      // Don't prevent default if we can't determine safety
    }
  }, true); // Use capture phase - intercept early
}

/**
 * Show confirmation modal for ALL links and return promise that resolves when user makes a choice
 */
function showConfirmationModal(href: string, linkText: string, verdict: TrustVerdict | null): Promise<boolean> {
  return new Promise((resolve) => {
    // Remove any existing modals
    document.querySelectorAll('[data-smarttrust-modal]').forEach(modal => modal.remove());

    // Create modal overlay
    const modal = document.createElement('div');
    modal.setAttribute('data-smarttrust-modal', 'true');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.8);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, sans-serif;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
      background: white;
      padding: 24px;
      border-radius: 12px;
      max-width: 500px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      margin: 20px;
      position: relative;
    `;
    
    // Determine modal style based on verdict
    const category = verdict?.category || 'UNKNOWN';
    const trustScore = verdict?.trustScore ?? 0.5;
    const hasPhishingRisk = verdict?.issues.some((issue: string) => issue.includes('PHISHING_RISK') || issue.includes('typosquatting')) || false;
    
    let titleText = '🔗 Confirm Navigation';
    let titleColor = '#1e293b';
    let borderColor = '#667eea';
    
    if (hasPhishingRisk) {
      titleText = '🚨 PHISHING RISK DETECTED!';
      titleColor = '#dc2626';
      borderColor = '#dc2626';
    } else if (category === 'DANGEROUS') {
      titleText = '⚠️ Dangerous Link Detected';
      titleColor = '#ef4444';
      borderColor = '#ef4444';
    } else if (category === 'SUSPICIOUS') {
      titleText = '⚠️ Suspicious Link Detected';
      titleColor = '#f59e0b';
      borderColor = '#f59e0b';
    } else if (category === 'SAFE') {
      titleText = '✅ Safe Link';
      titleColor = '#10b981';
      borderColor = '#10b981';
    }
    
    content.style.borderLeft = `4px solid ${borderColor}`;
    
    const title = document.createElement('h2');
    title.textContent = titleText;
    title.style.cssText = `margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: ${titleColor}; text-align: center;`;
    
    const urlDisplay = document.createElement('p');
    urlDisplay.textContent = href;
    urlDisplay.style.cssText = 'margin: 0 0 12px 0; color: #64748b; font-size: 13px; word-break: break-all; text-align: center; padding: 10px; background: #f8fafc; border-radius: 6px;';
    
    // Show trust score if available
    if (verdict) {
      const score = document.createElement('p');
      const scoreColor = category === 'DANGEROUS' || hasPhishingRisk ? '#ef4444' : category === 'SUSPICIOUS' ? '#f59e0b' : '#10b981';
      score.textContent = `Trust Score: ${(trustScore * 100).toFixed(0)}% (${category})`;
      score.style.cssText = `margin: 0 0 16px 0; color: ${scoreColor}; font-weight: bold; font-size: 16px; text-align: center;`;
      content.appendChild(score);
    }
    
    const summarySection = document.createElement('div');
    summarySection.style.cssText = 'margin-bottom: 20px; padding: 15px; background-color: #f8fafc; border-radius: 8px;';
    
    // Phishing warning (highest priority)
    if (hasPhishingRisk) {
      const phishingWarning = document.createElement('div');
      phishingWarning.style.cssText = 'padding: 12px; background-color: #fee2e2; border-left: 4px solid #dc2626; border-radius: 6px; margin-bottom: 12px;';
      const phishingText = document.createElement('p');
      phishingText.style.cssText = 'margin: 0; font-size: 13px; font-weight: 600; color: #991b1b; line-height: 1.5;';
      phishingText.textContent = '🚨 This domain may be trying to impersonate a legitimate website. Do not enter personal information.';
      phishingWarning.appendChild(phishingText);
      summarySection.appendChild(phishingWarning);
      
      const phishingIssue = verdict?.issues.find((issue: string) => issue.includes('PHISHING_RISK') || issue.includes('typosquatting'));
      if (phishingIssue) {
        const issueText = document.createElement('p');
        issueText.style.cssText = 'margin: 8px 0 0 0; font-size: 12px; color: #991b1b; line-height: 1.5;';
        issueText.textContent = phishingIssue;
        phishingWarning.appendChild(issueText);
      }
    }
    
    // AI Analysis
    if (verdict?.gptSummary) {
      const aiTitle = document.createElement('h3');
      aiTitle.textContent = '🤖 AI Analysis:';
      aiTitle.style.cssText = 'margin: 0 0 10px 0; font-size: 14px; font-weight: 600; color: #1e293b;';
      summarySection.appendChild(aiTitle);
      
      const gptText = document.createElement('div');
      gptText.innerHTML = verdict.gptSummary.replace(/\n/g, '<br/>');
      gptText.style.cssText = 'margin: 0 0 12px 0; font-size: 12px; color: #334155; line-height: 1.6;';
      summarySection.appendChild(gptText);
    }
    
    // Issues list
    if (verdict?.issues && verdict.issues.length > 0) {
      const issuesTitle = document.createElement('h3');
      issuesTitle.textContent = 'Detected Issues:';
      issuesTitle.style.cssText = 'margin: 12px 0 8px 0; font-size: 14px; font-weight: 600; color: #1e293b;';
      summarySection.appendChild(issuesTitle);
      
      const issuesList = document.createElement('ul');
      issuesList.style.cssText = 'margin: 0; padding-left: 20px; font-size: 12px; color: #475569; line-height: 1.6;';
      verdict.issues.slice(0, 5).forEach((issue: string) => {
        const li = document.createElement('li');
        li.textContent = issue;
        li.style.cssText = 'margin-bottom: 4px;';
        issuesList.appendChild(li);
      });
      summarySection.appendChild(issuesList);
    }
    
    // If no verdict available, show loading message
    if (!verdict) {
      const loadingText = document.createElement('p');
      loadingText.style.cssText = 'margin: 0; font-size: 13px; color: #64748b; text-align: center; font-style: italic;';
      loadingText.textContent = 'Analyzing link security...';
      summarySection.appendChild(loadingText);
    }
    
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display: flex; gap: 12px; justify-content: center; margin-top: 20px;';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '❌ Cancel';
    cancelBtn.setAttribute('data-smarttrust-modal', 'true');
    cancelBtn.style.cssText = `
      padding: 12px 24px;
      border: 2px solid #cbd5e1;
      background: white;
      color: #475569;
      cursor: pointer;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      transition: all 0.2s;
    `;
    cancelBtn.onmouseenter = () => {
      cancelBtn.style.backgroundColor = '#f1f5f9';
      cancelBtn.style.borderColor = '#94a3b8';
    };
    cancelBtn.onmouseleave = () => {
      cancelBtn.style.backgroundColor = 'white';
      cancelBtn.style.borderColor = '#cbd5e1';
    };
    cancelBtn.onclick = () => {
      document.body.removeChild(modal);
      resolve(false);
    };
    
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = hasPhishingRisk || category === 'DANGEROUS' ? '⚠️ Proceed Anyway' : '✅ Confirm';
    confirmBtn.setAttribute('data-smarttrust-modal', 'true');
    const confirmBtnColor = hasPhishingRisk || category === 'DANGEROUS' ? '#ef4444' : category === 'SUSPICIOUS' ? '#f59e0b' : '#10b981';
    confirmBtn.style.cssText = `
      padding: 12px 24px;
      background: ${hasPhishingRisk || category === 'DANGEROUS' ? `linear-gradient(135deg, ${confirmBtnColor} 0%, #dc2626 100%)` : confirmBtnColor};
      color: white;
      border: none;
      cursor: pointer;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      transition: all 0.2s;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;
    confirmBtn.onmouseenter = () => {
      confirmBtn.style.transform = 'translateY(-1px)';
      confirmBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    };
    confirmBtn.onmouseleave = () => {
      confirmBtn.style.transform = '';
      confirmBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    };
    confirmBtn.onclick = () => {
      document.body.removeChild(modal);
      resolve(true);
    };
    
    buttons.appendChild(cancelBtn);
    buttons.appendChild(confirmBtn);
    
    content.appendChild(title);
    content.appendChild(urlDisplay);
    content.appendChild(summarySection);
    content.appendChild(buttons);
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    // Close on escape key
    const escapeHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        document.body.removeChild(modal);
        document.removeEventListener('keydown', escapeHandler);
        resolve(false);
      }
    };
    document.addEventListener('keydown', escapeHandler);
  });
}

/**
 * Show warning modal for suspicious links (kept for backward compatibility)
 */
function showWarningModal(href: string, verdict: any): Promise<boolean> {
  return showConfirmationModal(href, href, verdict);
  return new Promise((resolve) => {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.setAttribute('data-smarttrust-modal', 'true');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.8);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, sans-serif;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
      background: white;
      padding: 24px;
      border-radius: 8px;
      max-width: 500px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      margin: 20px;
    `;
    
    const title = document.createElement('h2');
    title.textContent = '⚠️ Suspicious Link Detected';
    title.style.cssText = 'margin: 0 0 16px 0; font-size: 18px; color: #dc3545;';
    
    const url = document.createElement('p');
    url.textContent = href;
    url.style.cssText = 'margin: 0 0 12px 0; color: #666; font-size: 12px; word-break: break-all;';
    
    const score = document.createElement('p');
    const scoreColor = verdict.category === 'DANGEROUS' ? '#dc3545' : '#ffc107';
    score.textContent = `Trust Score: ${(verdict.trustScore * 100).toFixed(0)}% (${verdict.category})`;
    score.style.cssText = `margin: 0 0 12px 0; color: ${scoreColor}; font-weight: bold;`;
    
    const summary = document.createElement('div');
    summary.style.cssText = 'margin: 0 0 20px 0; line-height: 1.5;';
    
    if (verdict.gptSummary) {
      const aiTitle = document.createElement('strong');
      aiTitle.textContent = '🤖 AI Analysis:';
      aiTitle.style.cssText = 'display: block; margin-bottom: 8px; font-size: 13px; color: #1e293b;';
      summary.appendChild(aiTitle);
      
      const gptText = document.createElement('div');
      gptText.textContent = verdict.gptSummary;
      gptText.style.cssText = 'margin: 0 0 12px 0; padding: 10px; background: #f8fafc; border-radius: 6px; font-size: 12px; line-height: 1.6; white-space: pre-wrap; color: #475569;';
      summary.appendChild(gptText);
    }
    
    if (verdict.issues && verdict.issues.length > 0) {
      const issuesTitle = document.createElement('strong');
      issuesTitle.textContent = 'Detected Issues:';
      issuesTitle.style.cssText = 'display: block; margin-bottom: 8px;';
      summary.appendChild(issuesTitle);
      
      const issuesList = document.createElement('ul');
      issuesList.style.cssText = 'margin: 0; padding-left: 20px;';
      verdict.issues.slice(0, 5).forEach((issue: string) => {
        const li = document.createElement('li');
        li.textContent = issue;
        li.style.cssText = 'margin-bottom: 4px;';
        issuesList.appendChild(li);
      });
      summary.appendChild(issuesList);
    }
    
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display: flex; gap: 12px; justify-content: flex-end;';
    
    const blockBtn = document.createElement('button');
    blockBtn.textContent = '❌ Block';
    blockBtn.setAttribute('data-smarttrust-modal', 'true');
    blockBtn.style.cssText = 'padding: 10px 20px; border: 1px solid #ccc; background: white; cursor: pointer; border-radius: 4px; font-weight: 500;';
    blockBtn.onclick = () => {
      document.body.removeChild(modal);
      resolve(false);
    };
    
    const proceedBtn = document.createElement('button');
    proceedBtn.textContent = '⚠️ Proceed Anyway';
    proceedBtn.setAttribute('data-smarttrust-modal', 'true');
    proceedBtn.style.cssText = 'padding: 10px 20px; background: #ffc107; color: #000; border: none; cursor: pointer; border-radius: 4px; font-weight: 500;';
    proceedBtn.onclick = () => {
      document.body.removeChild(modal);
      resolve(true);
    };
    
    buttons.appendChild(blockBtn);
    buttons.appendChild(proceedBtn);
    
    content.appendChild(title);
    content.appendChild(url);
    content.appendChild(score);
    content.appendChild(summary);
    content.appendChild(buttons);
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    // Close on escape key
    const escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.body.removeChild(modal);
        document.removeEventListener('keydown', escapeHandler);
        resolve(false);
      }
    };
    document.addEventListener('keydown', escapeHandler);
  });
}

// Listen for AI analysis updates and ad blocker toggles from background script
chrome.runtime.onMessage.addListener((message: MessageType) => {
  if (message.type === 'AI_ANALYSIS_UPDATE') {
    console.log('[ContentScript] Received AI analysis update, refreshing highlights');
    // Update highlights with new AI analysis results
    highlightLinks(message.payload);
    
    // Hide loading spinners for updated links
    message.payload.forEach((analysis: LinkAnalysis) => {
      const linkElement = linkElementCache.get(analysis.link.href);
      if (linkElement) {
        hideLoadingSpinner(linkElement);
        // Update stored verdict
        linkVerdicts.set(analysis.link.href, analysis.verdict);
      }
    });
  } else if (message.type === 'TOGGLE_AD_BLOCKER') {
    adBlockerEnabled = message.enabled;
    if (adBlockerEnabled) {
      blockDangerousContentOnPage();
    } else {
      // Re-enable blocked content (though removed elements can't be restored)
      document.querySelectorAll('[data-smarttrust-blocked]').forEach((element) => {
        element.removeAttribute('data-smarttrust-blocked');
        (element as HTMLElement).style.cssText = '';
      });
      blockedDangerousCount = 0;
    }
  }
  return false; // Don't send response
});

/**
 * Dangerous content blocker functionality
 * Detects and hides dangerous pop-ups, overlays, and sections that pose security risks
 */

// Dangerous content patterns (phishing, malware, scams)
const DANGEROUS_PATTERNS = [
  // Phishing and fake security alerts
  /your\s+computer\s+is\s+infected/i,
  /virus\s+detected/i,
  /malware\s+found/i,
  /security\s+alert/i,
  /critical\s+warning/i,
  /immediate\s+action\s+required/i,
  /your\s+account\s+will\s+be\s+closed/i,
  /suspended\s+account/i,
  /verify\s+your\s+identity/i,
  /update\s+your\s+payment\s+information/i,
  /click\s+here\s+to\s+claim/i,
  /you\s+have\s+won/i,
  /congratulations.*prize/i,
  /free\s+iphone/i,
  /free\s+ipad/i,
  /click\s+now\s+to\s+win/i,
  // Tech support scams
  /microsoft\s+support/i,
  /apple\s+support/i,
  /call\s+this\s+number/i,
  /tech\s+support\s+scam/i,
  /your\s+computer\s+has\s+a\s+problem/i,
  // Fake antivirus
  /antivirus\s+expired/i,
  /renew\s+your\s+protection/i,
  /scan\s+now/i,
  /remove\s+threats/i,
  // Social engineering
  /urgent.*action/i,
  /limited\s+time\s+offer/i,
  /act\s+now/i,
  /don.*miss\s+out/i,
  /exclusive\s+offer/i,
  // Suspicious pop-up indicators
  /click\s+allow/i,
  /enable\s+notifications/i,
  /show\s+notifications/i
];

// Dangerous keywords in text content
const DANGEROUS_KEYWORDS = [
  'phishing', 'malware', 'virus detected', 'security threat',
  'account suspended', 'verify now', 'urgent action',
  'tech support', 'call now', 'free prize', 'you won',
  'click to claim', 'limited offer', 'act immediately'
];

// Pop-up/overlay selectors (to check content)
const POPUP_SELECTORS = [
  '[class*="popup"]', '[id*="popup"]', '[class*="pop-up"]', '[id*="pop-up"]',
  '[class*="overlay"]', '[id*="overlay"]', '[class*="modal"]', '[id*="modal"]',
  '[class*="dialog"]', '[id*="dialog"]', '[class*="lightbox"]', '[id*="lightbox"]',
  '[class*="alert"]', '[id*="alert"]', '[class*="warning"]', '[id*="warning"]',
  '[class*="notification"]', '[id*="notification"]', '[class*="banner"]', '[id*="banner"]',
  '[class*="interstitial"]', '[id*="interstitial"]', '[class*="promo"]', '[id*="promo"]'
];

let adBlockerEnabled = true;
let blockedDangerousCount = 0;

/**
 * Check if an element contains dangerous content
 * IMPORTANT: Does NOT block links - only blocks dangerous sections/pop-ups
 * Also ensures elements containing safe links are never blocked
 */
function isDangerousContent(element: HTMLElement): boolean {
  // Speed optimization: Skip if it's a link element (we don't block links, only dangerous sections)
  if (element.tagName === 'A' || element.closest('a')) {
    return false; // Never block links, even if they contain dangerous text
  }
  
  // CRITICAL: Never block elements that contain safe links
  const safeLinks = element.querySelectorAll('a[href]');
  for (const link of Array.from(safeLinks)) {
    const anchor = link as HTMLAnchorElement;
    try {
      const href = anchor.href;
      
      // Check if link is safe
      if (isTrustedDomain(new URL(href).hostname)) {
        return false; // Contains trusted domain link - don't block
      }
      
      // Check if link is same-domain
      if (new URL(href).hostname === window.location.hostname) {
        return false; // Contains same-domain link - don't block
      }
      
      // Check if link is marked as SAFE in cache
      const cachedCategory = highlightedLinks.get(href);
      if (cachedCategory === 'SAFE') {
        return false; // Contains safe link - don't block
      }
      
      // Check if link has data-smarttrust-highlight="SAFE" attribute
      if (anchor.getAttribute('data-smarttrust-highlight') === 'SAFE') {
        return false; // Contains marked safe link - don't block
      }
    } catch (err) {
      // Invalid URL, continue checking
    }
  }
  
  // Speed optimization: Quick check for pop-up/overlay characteristics first
  const style = window.getComputedStyle(element);
  const isPopupLike = (style.position === 'fixed' || style.position === 'sticky') && 
                     (style.zIndex && parseInt(style.zIndex) > 100);
  
  // If not a pop-up/overlay, skip expensive text checks
  if (!isPopupLike) {
    // Only check if it's clearly a dangerous section (not a link)
    const rect = element.getBoundingClientRect();
    const viewportArea = window.innerWidth * window.innerHeight;
    const elementArea = rect.width * rect.height;
    
    // Must be a significant section (not just a small element)
    if (elementArea < viewportArea * 0.1) {
      return false; // Too small to be a dangerous section
    }
  }
  
  // Get text content (optimized: only if needed)
  const textContent = (element.textContent || '').toLowerCase();
  if (textContent.length < 10) {
    return false; // Too short to be dangerous content
  }
  
  // Quick pattern check (optimized: break early)
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(textContent)) {
      return true;
    }
  }
  
  // Check for dangerous keywords (only in pop-up context for speed)
  if (isPopupLike) {
    for (const keyword of DANGEROUS_KEYWORDS) {
      if (textContent.includes(keyword.toLowerCase())) {
        return true;
      }
    }
  }
  
  // Check if it's a pop-up/overlay with suspicious characteristics
  const className = (element.className || '').toLowerCase();
  const id = (element.id || '').toLowerCase();
  
  // Check if element matches pop-up selectors (optimized: only if not already identified)
  if (!isPopupLike) {
    let isPopupElement = false;
    for (const selector of POPUP_SELECTORS) {
      try {
        if (element.matches(selector)) {
          isPopupElement = true;
          break;
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }
    
    if (!isPopupElement) {
      return false; // Not a pop-up element
    }
  }
  
  // Check if it's positioned to cover content (dangerous pop-up)
  if (isPopupLike) {
    const rect = element.getBoundingClientRect();
    
    // If it covers a significant portion of the viewport, it's dangerous
    const viewportArea = window.innerWidth * window.innerHeight;
    const elementArea = rect.width * rect.height;
    
    if (elementArea > viewportArea * 0.3) {
      // Large overlay - check for suspicious content
      if (textContent.length > 0) {
        // Has text content - check for dangerous patterns
        const suspiciousWords = ['click', 'allow', 'enable', 'verify', 'update', 'claim', 'win', 'prize'];
        const suspiciousCount = suspiciousWords.filter(word => textContent.includes(word)).length;
        
        if (suspiciousCount >= 2) {
          return true; // Multiple suspicious words in a large overlay
        }
      } else {
        // Large overlay with no meaningful content - likely dangerous
        return true;
      }
    }
    
    // Check for fake login forms in pop-ups
    const hasInputFields = element.querySelectorAll('input[type="password"], input[type="email"], input[type="text"]').length > 0;
    const hasSubmitButton = element.querySelectorAll('button[type="submit"], input[type="submit"], button').length > 0;
    
    if (hasInputFields && hasSubmitButton && (style.position === 'fixed' || style.position === 'sticky')) {
      // Pop-up with form - check if it's asking for sensitive info
      if (textContent.includes('password') || textContent.includes('login') || 
          textContent.includes('account') || textContent.includes('verify')) {
        // Check if it's from a different domain (phishing attempt)
        const currentDomain = window.location.hostname;
        const iframes = element.querySelectorAll('iframe');
        for (const iframe of Array.from(iframes)) {
          try {
            const iframeSrc = (iframe as HTMLIFrameElement).src;
            if (iframeSrc) {
              const iframeDomain = new URL(iframeSrc).hostname;
              if (iframeDomain !== currentDomain && !iframeDomain.includes(currentDomain)) {
                return true; // Different domain = likely phishing
              }
            }
          } catch (e) {
            // Invalid URL, skip
          }
        }
      }
    }
  }
  
  // Check for suspicious iframes from unknown domains
  if (element.tagName === 'IFRAME') {
    const iframe = element as HTMLIFrameElement;
    const src = iframe.src || '';
    if (src) {
      try {
        const iframeDomain = new URL(src).hostname;
        const currentDomain = window.location.hostname;
        
        // If iframe is from different domain and is in a pop-up context
        if (iframeDomain !== currentDomain && !iframeDomain.includes(currentDomain)) {
          const parent = iframe.parentElement;
          if (parent) {
            const parentStyle = window.getComputedStyle(parent);
            if ((parentStyle.position === 'fixed' || parentStyle.position === 'sticky') &&
                (parentStyle.zIndex && parseInt(parentStyle.zIndex) > 100)) {
              return true; // Suspicious iframe in pop-up from different domain
            }
          }
        }
      } catch (e) {
        // Invalid URL, skip
      }
    }
  }
  
  return false;
}

/**
 * Block/hide dangerous content element
 * IMPORTANT: Never blocks elements containing safe links
 */
function blockDangerousContent(element: HTMLElement): void {
  if (element.hasAttribute('data-smarttrust-blocked')) {
    return; // Already blocked
  }
  
  // Final safety check: don't block if element contains safe links
  // This check is already done in isDangerousContent, but double-check here for safety
  const safeLinks = element.querySelectorAll('a[href]');
  for (const link of Array.from(safeLinks)) {
    const anchor = link as HTMLAnchorElement;
    try {
      const href = anchor.href;
      
      // If contains safe link, don't block
      if (isTrustedDomain(new URL(href).hostname) ||
          new URL(href).hostname === window.location.hostname ||
          highlightedLinks.get(href) === 'SAFE' ||
          anchor.getAttribute('data-smarttrust-highlight') === 'SAFE') {
        return; // Contains safe link - don't block this element
      }
    } catch (err) {
      // Invalid URL, continue
    }
  }
  
  element.setAttribute('data-smarttrust-blocked', 'true');
  
  // Completely remove dangerous pop-ups/overlays from DOM
  const style = window.getComputedStyle(element);
  const isPopup = (style.position === 'fixed' || style.position === 'sticky') && 
                  (style.zIndex && parseInt(style.zIndex) > 100);
  
  if (isPopup) {
    // Remove dangerous pop-ups completely
    try {
      element.remove();
      blockedDangerousCount++;
      console.log('[DangerousContentBlocker] Removed dangerous pop-up/overlay');
      return;
    } catch (e) {
      // Element might be in use, fall back to hiding
    }
  }
  
  // Hide other dangerous content
  element.style.display = 'none !important';
  element.style.visibility = 'hidden !important';
  element.style.opacity = '0 !important';
  element.style.pointerEvents = 'none !important';
  element.style.position = 'absolute !important';
  element.style.left = '-9999px !important';
  element.style.top = '-9999px !important';
  
  blockedDangerousCount++;
}

/**
 * Scan and block dangerous content on the page
 */
function blockDangerousContentOnPage(): void {
  if (!adBlockerEnabled) return;
  
  let foundDangerous = 0;
  
  // First, check all pop-up/overlay elements (most likely to be dangerous)
  for (const selector of POPUP_SELECTORS) {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach((element) => {
        if (element instanceof HTMLElement && isDangerousContent(element)) {
          blockDangerousContent(element);
          foundDangerous++;
        }
      });
    } catch (e) {
      // Invalid selector, skip
    }
  }
  
  // Also scan fixed/sticky positioned elements (likely overlays)
  const allElements = document.querySelectorAll('*');
  allElements.forEach((element) => {
    if (element instanceof HTMLElement && !element.hasAttribute('data-smarttrust-blocked')) {
      const style = window.getComputedStyle(element);
      // Check fixed/sticky elements with high z-index
      if ((style.position === 'fixed' || style.position === 'sticky') && 
          (style.zIndex && parseInt(style.zIndex) > 100)) {
        if (isDangerousContent(element)) {
          blockDangerousContent(element);
          foundDangerous++;
        }
      }
    }
  });
  
  if (foundDangerous > 0) {
    console.log(`[DangerousContentBlocker] Blocked ${foundDangerous} dangerous element(s) on this page`);
  }
}

/**
 * Initialize ad blocker
 */
async function initAdBlocker(): Promise<void> {
  // Check if ad blocker is enabled
  const result = await chrome.storage.local.get(['adBlockerEnabled']);
  adBlockerEnabled = result.adBlockerEnabled !== false; // Default to enabled
  
  if (adBlockerEnabled) {
    // Initial scan
    blockDangerousContentOnPage();
    
    // Watch for dynamically added content
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            if (isDangerousContent(node)) {
              blockDangerousContent(node);
            }
            // Also check children for dangerous content
            node.querySelectorAll('*').forEach((child) => {
              if (child instanceof HTMLElement && isDangerousContent(child)) {
                blockDangerousContent(child);
              }
            });
          }
        });
      });
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Re-scan periodically for dangerous content (optimized: less frequent)
    setInterval(blockDangerousContentOnPage, 5000); // Reduced frequency from 2s to 5s
  }
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    scanAndSendLinks();
    setupClickInterception();
    initAdBlocker();
  });
} else {
  scanAndSendLinks();
  setupClickInterception();
  initAdBlocker();
}

// Re-scan on dynamic content changes (optimized: longer debounce, less frequent)
let scanTimeout: number | null = null;
const observer = new MutationObserver(() => {
  if (scanTimeout) clearTimeout(scanTimeout);
  // Increased debounce for better performance (3 seconds instead of 1)
  scanTimeout = window.setTimeout(() => {
    if (!isScanning) {
      scanAndSendLinks();
    }
  }, 3000);
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  // Optimize: only observe significant changes
  attributes: false,
  characterData: false
});

