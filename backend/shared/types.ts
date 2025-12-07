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

