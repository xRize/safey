import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SiteSettings, UserPlan } from '../types';

interface ScanHistory {
  domain: string;
  url: string;
  trustScore: number;
  category: string;
  timestamp: number;
}

function Options() {
  const [sites, setSites] = useState<SiteSettings[]>([]);
  const [plan, setPlan] = useState<UserPlan>('free');
  const [history, setHistory] = useState<ScanHistory[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    // Load site settings
    const allData = await chrome.storage.local.get(null);
    const siteSettings: SiteSettings[] = [];
    
    for (const [key, value] of Object.entries(allData)) {
      if (key.startsWith('site_')) {
        const domain = key.replace('site_', '');
        siteSettings.push({
          domain,
          enabled: value !== false
        });
      }
    }
    
    setSites(siteSettings);
    setLoading(false);
  };

  const toggleSite = async (domain: string, enabled: boolean) => {
    await chrome.storage.local.set({ [`site_${domain}`]: enabled });
    loadData();
  };

  const clearHistory = async () => {
    // Clear scan history (stored separately)
    await chrome.storage.local.remove('scan_history');
    setHistory([]);
  };

  return (
    <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '24px' }}>Safey - Setări</h1>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', marginBottom: '16px' }}>Plan & Membru</h2>
        <div style={{ padding: '16px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
        <p style={{ margin: '0 0 8px 0' }}>
          <strong>Plan actual:</strong>{' '}
          {plan === 'free' && '🆓 Gratis'}
          {plan === 'trial' && '✨ Trial (30 zile)'}
          {plan === 'premium' && '⭐ Premium'}
        </p>
        {(plan === 'premium' || plan === 'trial') && (
          <p style={{ margin: '8px 0', fontSize: '12px', color: '#666' }}>
            ℹ️ Analiza AI: {process.env.OPENAI_API_KEY ? 'Disponibilă' : 'Neconfigurată (configurați OPENAI_API_KEY)'}
          </p>
        )}
          {plan === 'free' && (
            <button
              style={{
                marginTop: '12px',
                padding: '8px 16px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
              onClick={() => {
                // Open Stripe checkout
                window.open('https://checkout.stripe.com/...', '_blank');
              }}
            >
              Încearcă Premium (30 zile gratuite)
            </button>
          )}
        </div>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', marginBottom: '16px' }}>Setări per site</h2>
        {sites.length === 0 ? (
          <p style={{ color: '#666' }}>Nu există setări salvate încă.</p>
        ) : (
          <div style={{ border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden' }}>
            {sites.map((site) => (
              <div
                key={site.domain}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid #eee',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <span style={{ fontSize: '14px' }}>{site.domain}</span>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={site.enabled}
                    onChange={(e) => toggleSite(site.domain, e.target.checked)}
                    style={{ marginRight: '8px' }}
                  />
                  <span style={{ fontSize: '14px' }}>
                    {site.enabled ? 'Activat' : 'Dezactivat'}
                  </span>
                </label>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', margin: 0 }}>Istoric scanări</h2>
          {history.length > 0 && (
            <button
              onClick={clearHistory}
              style={{
                padding: '6px 12px',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              Șterge istoricul
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p style={{ color: '#666' }}>Nu există istoric de scanări.</p>
        ) : (
          <div style={{ border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden' }}>
            {history.map((item, idx) => (
              <div
                key={idx}
                style={{
                  padding: '12px 16px',
                  borderBottom: idx < history.length - 1 ? '1px solid #eee' : 'none'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '500' }}>{item.domain}</span>
                  <span style={{
                    fontSize: '12px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor: item.category === 'SAFE' ? '#d4edda' : item.category === 'SUSPICIOUS' ? '#fff3cd' : '#f8d7da',
                    color: item.category === 'SAFE' ? '#155724' : item.category === 'SUSPICIOUS' ? '#856404' : '#721c24'
                  }}>
                    {item.category}
                  </span>
                </div>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '12px', color: '#007bff', textDecoration: 'none' }}
                >
                  {item.url}
                </a>
                <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                  Trust Score: {(item.trustScore * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Options />);
}

