export type LinkMeta = {
    href: string;
    text: string;
    rel?: string;
    contextSnippet?: string;
    targetDomain: string;
    elementSelector?: string;
};
export type TrustVerdict = {
    trustScore: number;
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
//# sourceMappingURL=types.d.ts.map