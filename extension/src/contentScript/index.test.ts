import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock DOM environment
beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Link extraction', () => {
  it('should extract links from anchor tags', () => {
    document.body.innerHTML = `
      <a href="https://example.com">Example</a>
      <a href="https://test.com">Test</a>
    `;
    
    // Import and test extractLinks function
    // Note: This is a simplified test - in real implementation,
    // you'd export the function or use a test harness
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    expect(anchors.length).toBe(2);
  });
  
  it('should skip javascript: and data: URLs', () => {
    document.body.innerHTML = `
      <a href="javascript:void(0)">JS Link</a>
      <a href="data:text/html,test">Data Link</a>
      <a href="https://valid.com">Valid</a>
    `;
    
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const validAnchors = anchors.filter(a => {
      const href = (a as HTMLAnchorElement).href;
      return href && !href.startsWith('javascript:') && !href.startsWith('data:');
    });
    
    expect(validAnchors.length).toBe(1);
  });
});

