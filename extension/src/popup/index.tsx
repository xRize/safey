import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { LinkAnalysis, MessageType } from '../types';

interface User {
  id: string;
  email: string;
  plan: 'free' | 'trial' | 'premium';
}

function Popup() {
  const [currentDomain, setCurrentDomain] = useState<string>('');
  const [currentTabId, setCurrentTabId] = useState<number | undefined>();
  const [enabled, setEnabled] = useState<boolean>(true);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>('');
  const [showLogin, setShowLogin] = useState<boolean>(false);
  const [showRegister, setShowRegister] = useState<boolean>(false);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [suspiciousCount, setSuspiciousCount] = useState<number>(0);
  const [linkAnalyses, setLinkAnalyses] = useState<LinkAnalysis[]>([]);
  const [loadingLinks, setLoadingLinks] = useState<boolean>(false);
  const [showLinks, setShowLinks] = useState<boolean>(false);
  const [adBlockerEnabled, setAdBlockerEnabled] = useState<boolean>(true);

  // @ts-ignore - Injected by Vite define
  const BACKEND_URL = typeof BACKEND_URL_INJECTED !== 'undefined' ? BACKEND_URL_INJECTED : 'http://localhost:3005';

  useEffect(() => {
    loadAuthState();
    loadDomainInfo();
    loadPageLinks();
    loadAdBlockerSetting();
  }, []);

  const loadAdBlockerSetting = async () => {
    const result = await chrome.storage.local.get(['adBlockerEnabled']);
    setAdBlockerEnabled(result.adBlockerEnabled !== false); // Default to enabled
  };

  const loadAuthState = async () => {
    try {
      const result = await chrome.storage.local.get(['auth_token', 'user']);
      const storedToken = result.auth_token;
      const storedUser = result.user;

      if (storedToken && storedUser) {
        // Verify token is still valid
        try {
          const response = await fetch(`${BACKEND_URL}/api/auth/verify`, {
            headers: {
              'Authorization': `Bearer ${storedToken}`
            }
          });

          if (response.ok) {
            const data = await response.json();
            setToken(storedToken);
            setUser(data.user);
          } else {
            // Token invalid, clear storage
            await chrome.storage.local.remove(['auth_token', 'user']);
          }
        } catch (err) {
          console.error('Token verification failed:', err);
          await chrome.storage.local.remove(['auth_token', 'user']);
        }
      }
    } catch (err) {
      console.error('Error loading auth state:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadDomainInfo = async () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        try {
          const domain = new URL(tabs[0].url).hostname;
          setCurrentDomain(domain);
          setCurrentTabId(tabs[0].id);
          
          chrome.runtime.sendMessage(
            { type: 'GET_SITE_STATUS', domain },
            (response) => {
              if (response?.enabled !== undefined) {
                setEnabled(response.enabled);
              }
            }
          );
        } catch (err) {
          console.error('Error getting domain:', err);
        }
      }
    });

    chrome.action.getBadgeText({}, (text) => {
      if (text) {
        setSuspiciousCount(parseInt(text, 10) || 0);
      }
    });
  };

  const loadPageLinks = async () => {
    setLoadingLinks(true);
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (tabs[0]?.id) {
          const response = await chrome.runtime.sendMessage({
            type: 'GET_PAGE_LINKS',
            tabId: tabs[0].id
          });
          
          if (response?.analyses) {
            setLinkAnalyses(response.analyses);
            const suspicious = (response.analyses || []).filter(
              (a: LinkAnalysis) => a.verdict.category !== 'SAFE'
            ).length;
            setSuspiciousCount(suspicious);
          }
        }
      });
    } catch (err) {
      console.error('Error loading page links:', err);
    } finally {
      setLoadingLinks(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');

    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok) {
        await chrome.storage.local.set({
          auth_token: data.token,
          user: data.user
        });
        setToken(data.token);
        setUser(data.user);
        setShowLogin(false);
        setEmail('');
        setPassword('');
        loadPageLinks(); // Reload links after login
      } else {
        setAuthError(data.error || 'Login failed');
      }
    } catch (err) {
      setAuthError('Network error. Make sure backend is running.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');

    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok) {
        await chrome.storage.local.set({
          auth_token: data.token,
          user: data.user
        });
        setToken(data.token);
        setUser(data.user);
        setShowRegister(false);
        setEmail('');
        setPassword('');
        loadPageLinks(); // Reload links after registration
      } else {
        setAuthError(data.error || 'Registration failed');
      }
    } catch (err) {
      setAuthError('Network error. Make sure backend is running.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await chrome.storage.local.remove(['auth_token', 'user']);
    setToken(null);
    setUser(null);
    setShowLogin(false);
    setShowRegister(false);
  };

  const handleToggle = async () => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);
    
    chrome.runtime.sendMessage(
      {
        type: 'SET_SITE_STATUS',
        domain: currentDomain,
        enabled: newEnabled
      },
      () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.reload(tabs[0].id);
          }
        });
      }
    );
  };

  const handleAdBlockerToggle = async () => {
    const newEnabled = !adBlockerEnabled;
    setAdBlockerEnabled(newEnabled);
    
    await chrome.storage.local.set({ adBlockerEnabled: newEnabled });
    
    // Notify content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        const tabId = tabs[0].id;
        chrome.tabs.sendMessage(tabId, {
          type: 'TOGGLE_AD_BLOCKER',
          enabled: newEnabled
        } as MessageType).catch(() => {
          // Content script might not be ready, reload tab
          chrome.tabs.reload(tabId);
        });
      }
    });
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'SAFE': return '#10b981'; // Emerald green
      case 'SUSPICIOUS': return '#f59e0b'; // Amber
      case 'DANGEROUS': return '#ef4444'; // Red
      default: return '#64748b'; // Slate gray
    }
  };

      const getCategoryLabel = (category: string) => {
        switch (category) {
          case 'SAFE': return 'Safe';
          case 'SUSPICIOUS': return 'Suspicious';
          case 'DANGEROUS': return 'Dangerous';
          default: return 'Unknown';
        }
      };

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <p>Loading...</p>
      </div>
    );
  }

  // Auth UI
  if (!user) {
    return (
      <div style={{ 
        padding: '0', 
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', 
        width: '400px',
        backgroundColor: '#f8fafc'
      }}>
        {/* Header with gradient */}
        <div style={{ 
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          padding: '32px 24px',
          textAlign: 'center',
          color: 'white'
        }}>
          <h2 style={{ margin: '0 0 8px 0', fontSize: '24px', fontWeight: '700', letterSpacing: '-0.5px' }}>
            Safey
          </h2>
          <p style={{ margin: 0, fontSize: '13px', opacity: 0.9 }}>
            Intelligent link protection
          </p>
        </div>
        
        <div style={{ padding: '24px' }}>
          {!showLogin && !showRegister && (
            <div>
              <p style={{ textAlign: 'center', color: '#64748b', marginBottom: '24px', fontSize: '14px', lineHeight: '1.6' }}>
                Sign in to access premium features and advanced AI analysis
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <button
                  onClick={() => { setShowLogin(true); setAuthError(''); }}
                  style={{
                    width: '100%',
                    padding: '14px',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '15px',
                    fontWeight: '600',
                    boxShadow: '0 2px 8px rgba(102, 126, 234, 0.3)',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = '';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.3)';
                  }}
                >
                  🔐 Sign In
                </button>
                <button
                  onClick={() => { setShowRegister(true); setAuthError(''); }}
                  style={{
                    width: '100%',
                    padding: '14px',
                    backgroundColor: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '15px',
                    fontWeight: '600',
                    boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.4)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = '';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.3)';
                  }}
                >
                  ✨ Sign Up
                </button>
              </div>
              <p style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center', marginTop: '20px' }}>
                Or continue without an account (limited features)
              </p>
            </div>
          )}

          {showLogin && (
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#1e293b' }}>Sign In</h3>
                <button
                  onClick={() => { setShowLogin(false); setAuthError(''); setEmail(''); setPassword(''); }}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    cursor: 'pointer', 
                    fontSize: '24px',
                    color: '#64748b',
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '6px',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f1f5f9'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  ×
                </button>
              </div>
              <form onSubmit={handleLogin}>
                {authError && (
                  <div style={{ 
                    padding: '12px', 
                    backgroundColor: '#fee2e2', 
                    color: '#991b1b', 
                    borderRadius: '8px', 
                    marginBottom: '16px', 
                    fontSize: '13px',
                    borderLeft: '4px solid #ef4444'
                  }}>
                    ⚠️ {authError}
                  </div>
                )}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '600', color: '#475569' }}>
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '2px solid #e2e8f0',
                      borderRadius: '8px',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                      transition: 'all 0.2s',
                      outline: 'none'
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#667eea'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; }}
                  />
                </div>
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '600', color: '#475569' }}>
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '2px solid #e2e8f0',
                      borderRadius: '8px',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                      transition: 'all 0.2s',
                      outline: 'none'
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#667eea'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={authLoading}
                  style={{
                    width: '100%',
                    padding: '14px',
                    background: authLoading ? '#94a3b8' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: authLoading ? 'not-allowed' : 'pointer',
                    fontSize: '15px',
                    fontWeight: '600',
                    opacity: authLoading ? 0.7 : 1,
                    boxShadow: authLoading ? 'none' : '0 2px 8px rgba(102, 126, 234, 0.3)',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => { if (!authLoading) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)'; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = authLoading ? 'none' : '0 2px 8px rgba(102, 126, 234, 0.3)'; }}
                >
                  {authLoading ? '⏳ Signing in...' : '🔐 Sign In'}
                </button>
              </form>
              <p style={{ fontSize: '12px', textAlign: 'center', marginTop: '16px', color: '#64748b' }}>
                Don't have an account?{' '}
                <button
                  onClick={() => { setShowLogin(false); setShowRegister(true); setAuthError(''); }}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    color: '#667eea', 
                    cursor: 'pointer', 
                    textDecoration: 'underline',
                    fontWeight: '600'
                  }}
                >
                  Înregistrează-te
                </button>
              </p>
            </div>
          )}

          {showRegister && (
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#1e293b' }}>Sign Up</h3>
                <button
                  onClick={() => { setShowRegister(false); setAuthError(''); setEmail(''); setPassword(''); }}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    cursor: 'pointer', 
                    fontSize: '24px',
                    color: '#64748b',
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '6px',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f1f5f9'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  ×
                </button>
              </div>
              <form onSubmit={handleRegister}>
                {authError && (
                  <div style={{ 
                    padding: '12px', 
                    backgroundColor: '#fee2e2', 
                    color: '#991b1b', 
                    borderRadius: '8px', 
                    marginBottom: '16px', 
                    fontSize: '13px',
                    borderLeft: '4px solid #ef4444'
                  }}>
                    ⚠️ {authError}
                  </div>
                )}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '600', color: '#475569' }}>
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '2px solid #e2e8f0',
                      borderRadius: '8px',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                      transition: 'all 0.2s',
                      outline: 'none'
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#10b981'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; }}
                  />
                </div>
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '600', color: '#475569' }}>
                    Password (min. 6 caractere)
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '2px solid #e2e8f0',
                      borderRadius: '8px',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                      transition: 'all 0.2s',
                      outline: 'none'
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#10b981'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={authLoading}
                  style={{
                    width: '100%',
                    padding: '14px',
                    backgroundColor: authLoading ? '#94a3b8' : '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: authLoading ? 'not-allowed' : 'pointer',
                    fontSize: '15px',
                    fontWeight: '600',
                    opacity: authLoading ? 0.7 : 1,
                    boxShadow: authLoading ? 'none' : '0 2px 8px rgba(16, 185, 129, 0.3)',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => { if (!authLoading) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.4)'; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = authLoading ? 'none' : '0 2px 8px rgba(16, 185, 129, 0.3)'; }}
                >
                  {authLoading ? '⏳ Signing up...' : '✨ Sign Up'}
                </button>
              </form>
              <p style={{ fontSize: '12px', textAlign: 'center', marginTop: '16px', color: '#64748b' }}>
                Ai deja cont?{' '}
                <button
                  onClick={() => { setShowRegister(false); setShowLogin(true); setAuthError(''); }}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    color: '#667eea', 
                    cursor: 'pointer', 
                    textDecoration: 'underline',
                    fontWeight: '600'
                  }}
                >
                  Sign In
                </button>
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Authenticated UI
  return (
    <div style={{ 
      padding: '0',
      margin: '0',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', 
      width: '400px', 
      maxHeight: '650px', 
      overflowY: 'auto',
      overflowX: 'hidden',
      backgroundColor: '#f8fafc'
    }}>
      {/* Header with gradient */}
      <div style={{ 
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '20px 16px',
        color: 'white',
        marginBottom: '0'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '700', letterSpacing: '-0.5px' }}>
            Safey
          </h2>
          <button
            onClick={handleLogout}
            style={{
              padding: '6px 12px',
              backgroundColor: 'rgba(255,255,255,0.2)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: '500',
              transition: 'all 0.2s',
              backdropFilter: 'blur(10px)'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.3)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)'; }}
          >
            Sign Out
          </button>
        </div>
        
        {/* User info card */}
        <div style={{ 
          backgroundColor: 'rgba(255,255,255,0.15)',
          padding: '12px',
          borderRadius: '8px',
          backdropFilter: 'blur(10px)'
        }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Signed in as
          </p>
          <p style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '600' }}>
            {user.email}
          </p>
          <div style={{ 
            display: 'inline-block',
            padding: '4px 10px',
            backgroundColor: user.plan === 'premium' ? 'rgba(255,215,0,0.3)' : 
                           user.plan === 'trial' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.2)',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: '600'
          }}>
            {user.plan === 'free' && '🆓 Free'}
            {user.plan === 'trial' && '✨ Trial'}
            {user.plan === 'premium' && '⭐ Premium'}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ padding: '16px', paddingLeft: '16px', paddingRight: '16px', margin: '0' }}>
        {/* Domain toggle card */}
        <div style={{ 
          backgroundColor: 'white',
          padding: '14px',
          borderRadius: '10px',
          marginBottom: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ margin: '0 0 4px 0', fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Current Site
              </p>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#1e293b' }}>
                {currentDomain || 'N/A'}
              </p>
            </div>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              cursor: 'pointer',
              position: 'relative'
            }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={handleToggle}
                style={{ 
                  width: '44px',
                  height: '24px',
                  margin: 0,
                  cursor: 'pointer',
                  appearance: 'none',
                  backgroundColor: enabled ? '#10b981' : '#cbd5e1',
                  borderRadius: '12px',
                  position: 'relative',
                  transition: 'background-color 0.2s',
                  outline: 'none'
                }}
              />
              <span style={{ 
                position: 'absolute',
                right: enabled ? '4px' : '24px',
                top: '2px',
                width: '20px',
                height: '20px',
                backgroundColor: 'white',
                borderRadius: '50%',
                transition: 'right 0.2s',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
              }} />
            </label>
          </div>
        </div>

        {/* Ad Blocker toggle card */}
        <div style={{ 
          backgroundColor: 'white',
          padding: '14px',
          borderRadius: '10px',
          marginBottom: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ margin: '0 0 4px 0', fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Dangerous Content Blocker
              </p>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#1e293b' }}>
                {adBlockerEnabled ? '🛡️ Active' : '⚠️ Disabled'}
              </p>
              <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: '#94a3b8' }}>
                Blocks dangerous pop-ups and sections
              </p>
            </div>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              cursor: 'pointer',
              position: 'relative'
            }}>
              <input
                type="checkbox"
                checked={adBlockerEnabled}
                onChange={handleAdBlockerToggle}
                style={{ 
                  width: '44px',
                  height: '24px',
                  margin: 0,
                  cursor: 'pointer',
                  appearance: 'none',
                  backgroundColor: adBlockerEnabled ? '#10b981' : '#cbd5e1',
                  borderRadius: '12px',
                  position: 'relative',
                  transition: 'background-color 0.2s',
                  outline: 'none'
                }}
              />
              <span style={{ 
                position: 'absolute',
                right: adBlockerEnabled ? '4px' : '24px',
                top: '2px',
                width: '20px',
                height: '20px',
                backgroundColor: 'white',
                borderRadius: '50%',
                transition: 'right 0.2s',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
              }} />
            </label>
          </div>
        </div>

        {/* Alert banner for suspicious links */}
        {suspiciousCount > 0 && (
          <div style={{
            padding: '14px',
            backgroundColor: '#fef3c7',
            borderLeft: '4px solid #f59e0b',
            borderRadius: '8px',
            marginBottom: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>⚠️</span>
              <div>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#92400e' }}>
                  {suspiciousCount} suspicious link{suspiciousCount !== 1 ? 's' : ''} detected
                </p>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#78350f' }}>
                  Review links before clicking
                </p>
              </div>
            </div>
          </div>
        )}

      <div style={{ marginBottom: '16px' }}>
        <button
          onClick={() => { setShowLinks(!showLinks); if (!showLinks) loadPageLinks(); }}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: showLinks ? '#6c757d' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
            marginBottom: '10px'
          }}
        >
          {loadingLinks ? 'Scanning...' : showLinks ? 'Hide Links' : `View Links (${linkAnalyses.length})`}
        </button>
      </div>

      {showLinks && (
        <div style={{ marginBottom: '16px' }}>
          {linkAnalyses.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#666', fontSize: '14px', padding: '20px' }}>
              No links found or scan in progress...
            </p>
          ) : (
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {linkAnalyses.map((analysis, idx) => {
                const score = analysis.verdict.trustScore;
                const category = analysis.verdict.category;
                const color = getCategoryColor(category);
                
                return (
                  <div
                    key={idx}
                    style={{
                      padding: '12px',
                      marginBottom: '8px',
                      border: `2px solid ${color}`,
                      borderRadius: '4px',
                      backgroundColor: category === 'SAFE' ? '#f8fff9' : category === 'SUSPICIOUS' ? '#fffef5' : '#fff5f5'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: '600', color: color }}>
                        {getCategoryLabel(category)}
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: '600', color: '#666' }}>
                        {(score * 100).toFixed(0)}%
                      </span>
                    </div>
                    <a
                      href={analysis.link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: '13px',
                        color: '#007bff',
                        textDecoration: 'none',
                        display: 'block',
                        marginBottom: '8px',
                        wordBreak: 'break-all'
                      }}
                      title={analysis.link.href}
                    >
                      {analysis.link.text || analysis.link.href}
                    </a>
                    <div style={{ fontSize: '11px', color: '#666' }}>
                      {analysis.link.targetDomain}
                    </div>
                    {/* Phishing warning - show prominently */}
                    {analysis.verdict.issues.some(issue => issue.includes('PHISHING_RISK') || issue.includes('typosquatting')) && (
                      <div style={{ 
                        marginTop: '8px', 
                        padding: '12px',
                        backgroundColor: '#fee2e2',
                        border: '2px solid #ef4444',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: '#991b1b',
                        fontWeight: '600',
                        boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                          <span style={{ fontSize: '18px' }}>🚨</span>
                          <strong>PHISHING RISK DETECTED!</strong>
                        </div>
                        <div style={{ fontSize: '11px', lineHeight: '1.5' }}>
                          {analysis.verdict.issues.find(issue => issue.includes('PHISHING_RISK') || issue.includes('typosquatting'))}
                        </div>
                        <div style={{ marginTop: '8px', fontSize: '10px', fontStyle: 'italic' }}>
                          ⚠️ This domain may be trying to impersonate a legitimate website. Do not enter personal information.
                        </div>
                      </div>
                    )}
                    
                    {/* Other issues */}
                    {analysis.verdict.issues.filter(issue => !issue.includes('PHISHING_RISK') && !issue.includes('typosquatting')).length > 0 && (
                      <div style={{ marginTop: '8px', fontSize: '11px', color: '#856404' }}>
                        <strong>Issues:</strong> {analysis.verdict.issues.filter(issue => !issue.includes('PHISHING_RISK') && !issue.includes('typosquatting')).slice(0, 3).join(', ')}{analysis.verdict.issues.filter(issue => !issue.includes('PHISHING_RISK') && !issue.includes('typosquatting')).length > 3 ? '...' : ''}
                      </div>
                    )}
                    {analysis.verdict.gptSummary && (user.plan === 'premium' || user.plan === 'trial') && (
                      <div style={{ 
                        marginTop: '10px', 
                        padding: '12px',
                        backgroundColor: '#f8fafc',
                        borderRadius: '8px',
                        fontSize: '12px', 
                        color: '#475569',
                        lineHeight: '1.6',
                        borderLeft: '4px solid #667eea',
                        whiteSpace: 'pre-wrap',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                      }}>
                        <strong style={{ display: 'block', marginBottom: '6px', fontStyle: 'normal', color: '#1e293b', fontSize: '13px' }}>🤖 AI Analysis:</strong>
                        <div style={{ color: '#334155' }}>
                          {analysis.verdict.gptSummary}
                        </div>
                      </div>
                    )}
                    {!analysis.verdict.gptSummary && (user.plan === 'premium' || user.plan === 'trial') && category !== 'SAFE' && (
                      <div style={{ 
                        marginTop: '10px', 
                        padding: '10px',
                        backgroundColor: '#fff3cd',
                        borderRadius: '6px',
                        fontSize: '11px', 
                        color: '#856404',
                        borderLeft: '3px solid #ffc107'
                      }}>
                        ⏳ AI analysis in progress or unavailable. Check if Ollama is running.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            onClick={openOptions}
            style={{
              width: '100%',
              padding: '12px 16px',
              backgroundColor: '#64748b',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '600',
              transition: 'all 0.2s',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}
            onMouseEnter={(e) => { 
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
            }}
            onMouseLeave={(e) => { 
              e.currentTarget.style.transform = '';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
            }}
          >
            ⚙️ Settings & History
          </button>

          {(user.plan === 'free' || user.plan === 'trial') && (
            <button
              onClick={() => {
                chrome.tabs.create({ url: `${BACKEND_URL}/api/stripe/create-checkout?email=${encodeURIComponent(user.email)}` });
              }}
              style={{
                width: '100%',
                padding: '12px 16px',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
                transition: 'all 0.2s',
                boxShadow: '0 2px 4px rgba(16, 185, 129, 0.3)'
              }}
              onMouseEnter={(e) => { 
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.4)';
              }}
              onMouseLeave={(e) => { 
                e.currentTarget.style.transform = '';
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(16, 185, 129, 0.3)';
              }}
            >
              ⭐ Upgrade to Premium
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}
