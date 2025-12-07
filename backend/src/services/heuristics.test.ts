import { describe, it, expect } from '@jest/globals';
import { calculateHeuristics } from './heuristics.js';
import type { LinkMeta } from '../../shared/types.js';

describe('Heuristics calculation', () => {
  it('should detect missing HTTPS', () => {
    const link: LinkMeta = {
      href: 'http://example.com',
      text: 'Example',
      targetDomain: 'example.com'
    };
    
    const result = calculateHeuristics(link);
    expect(result.issues).toContain('no_https');
  });
  
  it('should detect URL shorteners', () => {
    const link: LinkMeta = {
      href: 'https://bit.ly/abc123',
      text: 'Short link',
      targetDomain: 'bit.ly'
    };
    
    const result = calculateHeuristics(link);
    expect(result.issues).toContain('short_url');
  });
  
  it('should detect punycode', () => {
    const link: LinkMeta = {
      href: 'https://xn--example.com',
      text: 'Punycode',
      targetDomain: 'xn--example.com'
    };
    
    const result = calculateHeuristics(link);
    expect(result.issues).toContain('punycode');
  });
  
  it('should flag known safe domains', () => {
    const link: LinkMeta = {
      href: 'https://github.com',
      text: 'GitHub',
      targetDomain: 'github.com'
    };
    
    const result = calculateHeuristics(link);
    expect(result.flags.isKnownSafe).toBe(true);
  });
});

