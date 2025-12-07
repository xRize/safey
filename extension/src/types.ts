export type LinkMeta = {
  href: string;
  text: string;
  rel?: string;
  target?: string;
  download?: string;
  contextSnippet?: string;
  targetDomain: string;
  elementSelector?: string;
};

export type TrustVerdict = {
  trustScore: number; // 0..1
  category: 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS';
  issues: string[];
  gptSummary?: string;
  recommendation?: string;
  riskTags?: string[];
  confidence?: number;
};

export type LinkAnalysis = {
  link: LinkMeta;
  verdict: TrustVerdict;
};

export type MessageType =
  | { type: 'LINK_BATCH'; payload: LinkMeta[]; sourcePageContext?: string }
  | { type: 'VERDICT_BATCH'; payload: LinkAnalysis[] }
  | { type: 'GET_SITE_STATUS'; domain: string }
  | { type: 'SET_SITE_STATUS'; domain: string; enabled: boolean }
  | { type: 'SITE_STATUS_RESPONSE'; enabled: boolean }
  | { type: 'GET_LINK_VERDICT'; href: string }
  | { type: 'GET_PAGE_LINKS'; tabId?: number }
  | { type: 'PAGE_LINKS_RESPONSE'; analyses: LinkAnalysis[] }
  | { type: 'AI_ANALYZE_LINK'; link: LinkMeta; domain: string; priority?: boolean }
  | { type: 'AI_ANALYSIS_UPDATE'; payload: LinkAnalysis[] }
  | { type: 'TOGGLE_AD_BLOCKER'; enabled: boolean };

export type SiteSettings = {
  domain: string;
  enabled: boolean;
};

export type UserPlan = 'free' | 'trial' | 'premium';

