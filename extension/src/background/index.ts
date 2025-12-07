import type { LinkMeta, LinkAnalysis, MessageType, SiteSettings, TrustVerdict } from '../types';

const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const DB_NAME = 'smarttrust_cache';
const DB_VERSION = 1;

interface CachedVerdict {
  domain: string;
  verdicts: LinkAnalysis[];
  timestamp: number;
}

interface LinkVerdictCache {
  href: string;
  verdict: TrustVerdict;
  timestamp: number;
}

let db: IDBDatabase | null = null;

/**
 * Initialize IndexedDB for caching
 */
async function initDB(): Promise<IDBDatabase> {
  if (db) return db;
  
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains('verdicts')) {
        const store = database.createObjectStore('verdicts', { keyPath: 'domain' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!database.objectStoreNames.contains('linkVerdicts')) {
        const store = database.createObjectStore('linkVerdicts', { keyPath: 'href' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

/**
 * Get cached verdict for a domain
 */
async function getCachedVerdict(domain: string): Promise<LinkAnalysis[] | null> {
  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['verdicts'], 'readonly');
      const store = transaction.objectStore('verdicts');
      const request = store.get(domain);
      
      request.onsuccess = () => {
        const cached = request.result as CachedVerdict | undefined;
        if (!cached) {
          resolve(null);
          return;
        }
        
        const age = Date.now() - cached.timestamp;
        if (age > CACHE_TTL) {
          // Expired, delete it
          const deleteTransaction = database.transaction(['verdicts'], 'readwrite');
          deleteTransaction.objectStore('verdicts').delete(domain);
          resolve(null);
          return;
        }
        
        resolve(cached.verdicts);
      };
      
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Error reading cache:', err);
    return null;
  }
}

/**
 * Cache verdict for a domain
 */
async function cacheVerdict(domain: string, verdicts: LinkAnalysis[]): Promise<void> {
  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['verdicts', 'linkVerdicts'], 'readwrite');
      const domainStore = transaction.objectStore('verdicts');
      const linkStore = transaction.objectStore('linkVerdicts');
      
      const cached: CachedVerdict = {
        domain,
        verdicts,
        timestamp: Date.now()
      };
      
      domainStore.put(cached);
      
      // Also cache individual link verdicts for quick lookup
      for (const analysis of verdicts) {
        const linkCache: LinkVerdictCache = {
          href: analysis.link.href,
          verdict: analysis.verdict,
          timestamp: Date.now()
        };
        linkStore.put(linkCache);
      }
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (err) {
    console.error('Error caching verdict:', err);
  }
}

/**
 * Get cached verdict for a specific link
 */
async function getLinkVerdict(href: string): Promise<TrustVerdict | null> {
  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['linkVerdicts'], 'readonly');
      const store = transaction.objectStore('linkVerdicts');
      const request = store.get(href);
      
      request.onsuccess = () => {
        const cached = request.result as LinkVerdictCache | undefined;
        if (!cached) {
          resolve(null);
          return;
        }
        
        const age = Date.now() - cached.timestamp;
        if (age > CACHE_TTL) {
          // Expired, delete it
          const deleteTransaction = database.transaction(['linkVerdicts'], 'readwrite');
          deleteTransaction.objectStore('linkVerdicts').delete(href);
          resolve(null);
          return;
        }
        
        resolve(cached.verdict);
      };
      
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Error reading link cache:', err);
    return null;
  }
}

/**
 * Get site settings (enabled/disabled per domain)
 */
async function getSiteSettings(domain: string): Promise<boolean> {
  const result = await chrome.storage.local.get([`site_${domain}`]);
  return result[`site_${domain}`] !== false; // Default to enabled
}

/**
 * Set site settings
 */
async function setSiteSettings(domain: string, enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [`site_${domain}`]: enabled });
}

/**
 * Call backend API to analyze links
 */
async function analyzeLinks(links: LinkMeta[], domain: string): Promise<LinkAnalysis[]> {
  // @ts-ignore - Injected by Vite define
  const backendUrl = typeof BACKEND_URL_INJECTED !== 'undefined' ? BACKEND_URL_INJECTED : 'http://localhost:3005';
  
  // Get auth token if available
  const storage = await chrome.storage.local.get(['auth_token']);
  const token = storage.auth_token;
  
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Get comprehensive page context from the tab if available
    let sourcePageContext = '';
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => {
            const title = document.title || '';
            const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
            const h1 = document.querySelector('h1')?.textContent || '';
            
            // Get more paragraphs
            const paragraphs = Array.from(document.querySelectorAll('p'))
              .map(p => p.textContent?.trim())
              .filter(Boolean)
              .slice(0, 5)
              .join(' ');
            
            // Get headings
            const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
              .map(h => h.textContent?.trim())
              .filter(Boolean)
              .slice(0, 5)
              .join(' | ');
            
            const pageUrl = window.location.href;
            const pageDomain = window.location.hostname;
            
            return `Page URL: ${pageUrl}
Page Domain: ${pageDomain}
Page Title: ${title}
Meta Description: ${metaDesc}
Main Heading: ${h1}
Section Headings: ${headings}
Content: ${paragraphs}`.trim().slice(0, 3000);
          }
        });
        if (results && results[0]?.result) {
          sourcePageContext = results[0].result;
        }
      }
    } catch (err) {
      console.debug('Could not extract page context:', err);
    }
    
    const response = await fetch(`${backendUrl}/api/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        links,
        domain,
        sourcePageContext
      })
    });
    
    if (!response.ok) {
      throw new Error(`Backend error: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.analyses || [];
  } catch (err) {
    console.error('Error calling backend:', err);
    // Fallback: return basic heuristics-based analysis
    return links.map(link => ({
      link,
      verdict: {
        trustScore: calculateBasicTrustScore(link),
        category: 'SAFE' as const,
        issues: []
      }
    }));
  }
}

/**
 * Basic trust score calculation (fallback when backend is unavailable)
 */
function calculateBasicTrustScore(link: LinkMeta): number {
  let score = 0.5; // Neutral starting point
  
  // Check for suspicious patterns
  if (link.href.includes('bit.ly') || link.href.includes('tinyurl.com')) {
    score -= 0.2; // URL shorteners
  }
  
  if (!link.href.startsWith('https://')) {
    score -= 0.3; // No HTTPS
  }
  
  if (link.targetDomain.includes('xn--')) {
    score -= 0.4; // Punycode (potential homograph)
  }
  
  if (link.rel?.includes('nofollow')) {
    score += 0.1; // Positive signal
  }
  
  return Math.max(0, Math.min(1, score));
}

/**
 * Polls the backend for AI analysis updates and sends them to content script
 */
// Track which links have been sent updates to avoid duplicates
const sentUpdates = new Map<string, Set<string>>(); // domain -> Set of link URLs

async function pollForAIUpdates(
  links: LinkMeta[],
  domain: string,
  tabId: number | undefined,
  attempt: number,
  maxAttempts: number = 60 // Poll for up to 60 attempts (60 seconds)
): Promise<void> {
  if (attempt >= maxAttempts || !tabId) {
    return;
  }

  // @ts-ignore - Injected by Vite define
  const backendUrl = typeof BACKEND_URL_INJECTED !== 'undefined' ? BACKEND_URL_INJECTED : 'http://localhost:3005';
  const storage = await chrome.storage.local.get(['auth_token', 'user']);
  const token = storage.auth_token;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Re-analyze to get updated results (backend will return cached AI results if available)
    const response = await fetch(`${backendUrl}/api/ai-analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        links,
        domain,
        sourcePageContext: ''
      })
    });

    if (response.ok) {
      const data = await response.json();
      const updatedAnalyses = data.analyses || [];

      // Initialize sent updates set for this domain
      if (!sentUpdates.has(domain)) {
        sentUpdates.set(domain, new Set());
      }
      const domainSentUpdates = sentUpdates.get(domain)!;

      // Send individual updates for links that have new AI summaries
      const newUpdates: LinkAnalysis[] = [];
      for (const analysis of updatedAnalyses) {
        const linkUrl = analysis.link.href;
        const hasAIUpdate = analysis.verdict.gptSummary && 
                           !analysis.verdict.gptSummary.includes('not available') &&
                           !analysis.verdict.gptSummary.includes('already processed');
        
        // Check if this is a new update we haven't sent yet
        const updateKey = `${linkUrl}:${analysis.verdict.gptSummary || ''}`;
        if (hasAIUpdate && !domainSentUpdates.has(updateKey)) {
          newUpdates.push(analysis);
          domainSentUpdates.add(updateKey);
        }
      }

      // Send individual link updates in real-time
      if (newUpdates.length > 0) {
        await cacheVerdict(domain, updatedAnalyses);
        console.log(`[Background] Sending ${newUpdates.length} real-time AI updates to content script (tab ${tabId})`);

        // Send each update individually for real-time UI updates
        for (const update of newUpdates) {
          chrome.tabs.sendMessage(tabId, {
            type: 'AI_ANALYSIS_UPDATE',
            payload: [update] // Send single link update
          } as MessageType).catch(err => {
            // Tab might be closed or content script not ready
            console.debug(`[Background] Could not send AI update to tab ${tabId}:`, err);
          });
        }
      }

      // Continue polling if there might be more updates
      if (attempt < maxAttempts - 1) {
        setTimeout(() => {
          pollForAIUpdates(links, domain, tabId, attempt + 1, maxAttempts);
        }, 1000); // Poll every second
      }
    }
  } catch (err) {
    console.error(`[Background] Error polling for AI updates (attempt ${attempt}):`, err);
    // Continue polling on error (might be transient)
    if (attempt < maxAttempts - 1) {
      setTimeout(() => {
        pollForAIUpdates(links, domain, tabId, attempt + 1, maxAttempts);
      }, 1000);
    }
  }
}

/**
 * Triggers AI analysis in the background and updates cache.
 * This is used when initial results are served from cache, but we want to refresh AI data.
 */
async function triggerAIAnalysis(links: LinkMeta[], domain: string, sourcePageContext: string, tabId?: number, priorityUrl?: string) {
  // @ts-ignore - Injected by Vite define
  const backendUrl = typeof BACKEND_URL_INJECTED !== 'undefined' ? BACKEND_URL_INJECTED : 'http://localhost:3005';
  const storage = await chrome.storage.local.get(['auth_token', 'user']);
  const token = storage.auth_token;
  const userId = storage.user?.id;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    console.log(`[Background] Triggering background AI analysis for ${links.length} links, priority: ${priorityUrl || 'none'}`);
    const response = await fetch(`${backendUrl}/api/ai-analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        links,
        domain,
        userId,
        sourcePageContext,
        priorityUrl // Pass priority URL
      })
    });

    if (!response.ok) {
      throw new Error(`Backend AI analysis error: ${response.statusText}`);
    }

    const data = await response.json();
    const initialAnalyses = data.analyses || [];

    if (initialAnalyses.length > 0) {
      await cacheVerdict(domain, initialAnalyses); // Cache initial results
      console.log(`[Background] Cached initial analysis for ${domain}`);

      // Start polling for AI updates (AI processing happens in background)
      if (tabId) {
        pollForAIUpdates(links, domain, tabId, 0);
      }
    }
  } catch (err) {
    console.error('Error triggering background AI analysis:', err);
  }
}

/**
 * Message handler
 */
chrome.runtime.onMessage.addListener(
  (message: MessageType, sender, sendResponse) => {
    (async () => {
      try {
        if (message.type === 'LINK_BATCH') {
          const links = message.payload;
          const sourcePageContext = message.sourcePageContext || '';
          
          if (links.length === 0) {
            sendResponse({ analyses: [] });
            return;
          }
          
          const tab = sender.tab;
          if (!tab?.url) {
            sendResponse({ analyses: [] });
            return;
          }
          
          const domain = new URL(tab.url).hostname;
          
          // Check cache first
          const cached = await getCachedVerdict(domain);
          if (cached && cached.length === links.length) {
            sendResponse({ analyses: cached });
            // Still trigger AI analysis in background for updates
            triggerAIAnalysis(links, domain, sourcePageContext, tab.id).catch(console.error);
            return;
          }
          
          // Analyze with AI (returns initial results, then processes AI in parallel)
          // @ts-ignore - Injected by Vite define
          const backendUrl = typeof BACKEND_URL_INJECTED !== 'undefined' ? BACKEND_URL_INJECTED : 'http://localhost:3005';
          const storage = await chrome.storage.local.get(['auth_token', 'user']);
          const token = storage.auth_token;
          const userId = storage.user?.id;
          
          try {
            const headers: Record<string, string> = {
              'Content-Type': 'application/json'
            };
            
            if (token) {
              headers['Authorization'] = `Bearer ${token}`;
            }
            
            // Get initial analysis with AI processing (returns immediately, AI happens in background)
            const response = await fetch(`${backendUrl}/api/ai-analyze`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                links,
                domain,
                userId,
                sourcePageContext
              })
            });
            
            if (!response.ok) {
              throw new Error(`Backend error: ${response.statusText}`);
            }
            
            const data = await response.json();
            const initialAnalyses = data.analyses || [];
            
            // Cache initial results
            await cacheVerdict(domain, initialAnalyses);
            
            // Update badge with suspicious count
            const suspiciousCount = initialAnalyses.filter(
              (a: LinkAnalysis) => a.verdict.category !== 'SAFE'
            ).length;
            
            if (suspiciousCount > 0) {
              chrome.action.setBadgeText({
                text: suspiciousCount.toString(),
                tabId: tab.id
              });
              chrome.action.setBadgeBackgroundColor({ color: '#ff4444' });
            }
            
            // Start polling for AI updates in the background
            pollForAIUpdates(links, domain, tab.id, 0);
            
            sendResponse({ analyses: initialAnalyses });
          } catch (err) {
            console.error('Error analyzing links:', err);
            // Fallback to basic analysis
            const analyses = await analyzeLinks(links, domain);
            sendResponse({ analyses });
          }
        } else if (message.type === 'GET_SITE_STATUS') {
          const enabled = await getSiteSettings(message.domain);
          sendResponse({ enabled });
        } else if (message.type === 'SET_SITE_STATUS') {
          await setSiteSettings(message.domain, message.enabled);
          sendResponse({ success: true });
        } else if (message.type === 'GET_LINK_VERDICT') {
          const verdict = await getLinkVerdict(message.href);
          sendResponse({ verdict });
        } else if (message.type === 'GET_PAGE_LINKS') {
          // Get cached verdicts for the current domain
          const tabId = message.tabId;
          if (tabId) {
            try {
              const tab = await chrome.tabs.get(tabId);
              if (tab.url) {
                const domain = new URL(tab.url).hostname;
                const cached = await getCachedVerdict(domain);
                sendResponse({ analyses: cached || [] });
              } else {
                sendResponse({ analyses: [] });
              }
            } catch (err) {
              console.error('Error getting page links:', err);
              sendResponse({ analyses: [] });
            }
          } else {
            sendResponse({ analyses: [] });
          }
        } else if (message.type === 'AI_ANALYZE_LINK') {
          // Handle priority AI analysis for hovered/clicked links
          const { link, domain, priority } = message;
          const tab = sender.tab;
          
          if (!tab?.url) {
            sendResponse({ success: false, error: 'No tab URL' });
            return;
          }
          
          const sourcePageContext = await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            func: () => {
              const title = document.title || '';
              const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
              const h1 = document.querySelector('h1')?.textContent || '';
              const h2s = Array.from(document.querySelectorAll('h2')).map(h => h.textContent?.trim()).filter(Boolean).slice(0, 3).join(' | ');
              const h3s = Array.from(document.querySelectorAll('h3')).map(h => h.textContent?.trim()).filter(Boolean).slice(0, 3).join(' | ');
              const paragraphs = Array.from(document.querySelectorAll('p'))
                .map(p => p.textContent?.trim())
                .filter(Boolean)
                .slice(0, 5)
                .join(' ');
              
              const pageUrl = window.location.href;
              const pageDomain = window.location.hostname;
              
              return `Page URL: ${pageUrl}
Page Domain: ${pageDomain}
Page Title: ${title}
Meta Description: ${metaDesc}
Main Heading: ${h1}
Section Headings: ${h2s ? `H2: ${h2s}` : ''} ${h3s ? `H3: ${h3s}` : ''}
Content: ${paragraphs}`.trim().slice(0, 3000);
            }
          }).then(results => results[0]?.result || '').catch(() => '');
          
          // Trigger priority AI analysis
          triggerAIAnalysis([link], domain || new URL(tab.url).hostname, sourcePageContext, tab.id, priority ? link.href : undefined).catch(console.error);
          
          // Start polling for updates
          pollForAIUpdates([link], domain || new URL(tab.url).hostname, tab.id, 0, 30);
          
          sendResponse({ success: true });
        } else {
          sendResponse({ error: 'Unknown message type' });
        }
      } catch (err) {
        console.error('Error handling message:', err);
        sendResponse({ error: String(err) });
      }
    })();
    
    return true; // Keep channel open for async response
  }
);

// Initialize DB on startup
initDB().catch(console.error);

