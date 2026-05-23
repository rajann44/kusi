import React, { useState, useEffect } from 'react';
import MarketBar from './components/MarketBar';
import DetailModal from './components/DetailModal';
import AnalyticsChart from './components/AnalyticsChart';
import CompanyDrawer from './components/CompanyDrawer';

export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [news, setNews] = useState([]);
  const [stats, setStats] = useState({
    totalInvestments: 0,
    totalFunding: 0,
    totalNoise: 0,
    governmentCount: 0,
    governmentFunding: 0,
    privateCount: 0,
    privateFunding: 0,
    publicInvestmentsCount: 0,
    publicInvestmentsFunding: 0,
    privateInvestmentsCount: 0,
    privateInvestmentsFunding: 0
  });

  
  const [toast, setToast] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [dashboardSector, setDashboardSector] = useState('All');
  const [filterSector, setFilterSector] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(false);

  // Show status indicator
  const [isLive, setIsLive] = useState(false);
  const [pollerStatus, setPollerStatus] = useState(null);

  // Modal and details states
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [isGeneratingBullets, setIsGeneratingBullets] = useState(false);
  const [activeCompanyDrawer, setActiveCompanyDrawer] = useState(null);

  // Server-side search, filtering & pagination states for Logs tab
  const [paginatedNews, setPaginatedNews] = useState([]);
  const [logsSearchQuery, setLogsSearchQuery] = useState('');
  const [logsSector, setLogsSector] = useState('');
  const [logsFundingType, setLogsFundingType] = useState('all');
  const [logsListingStatus, setLogsListingStatus] = useState('all');
  const [logsSortBy, setLogsSortBy] = useState('published_at');
  const [logsSortOrder, setLogsSortOrder] = useState('desc');
  const [logsPage, setLogsPage] = useState(1);
  const [logsTotalCount, setLogsTotalCount] = useState(0);
  const [logsHasMore, setLogsHasMore] = useState(false);
  const [isLogsLoading, setIsLogsLoading] = useState(false);

  // Quarterly Analytics Trend States
  const [trends, setTrends] = useState([]);

  // US Market hours status and indices states
  const [marketData, setMarketData] = useState(null);
  const [tickFlashes, setTickFlashes] = useState({});

  // Theme Management
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };


  // Format funding amounts helper
  const formatAmount = (value) => {
    if (!value || value <= 0) return 'Undisclosed';
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    return `$${(value / 1e6).toFixed(1)}M`;
  };

  // Helper to clear and reset Search & Analytics filters
  const handleClearFilters = () => {
    setLogsSearchQuery('');
    setLogsSector('');
    setLogsFundingType('all');
    setLogsListingStatus('all');
    setLogsSortBy('published_at');
    setLogsSortOrder('desc');
    setLogsPage(1);
    showToast('All filters reset', 'success');
  };

  // Helper to show custom toasts
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Render recipients with glowing ticker pills for public listings
  const renderRecipientsInline = (recipients) => {
    if (!recipients || !Array.isArray(recipients)) return 'Unknown Recipient';
    return (
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
        {recipients.map((rec, idx) => {
          if (!rec) return null;
          const isObj = typeof rec === 'object' && rec !== null;
          const name = isObj ? rec.name : rec;
          const isPublic = isObj && (rec.is_public === true || rec.is_public === 'true');
          const ticker = isObj ? rec.ticker : null;
          const exchange = isObj ? rec.exchange : null;
          
          return (
            <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span 
                className="clickable-company-name"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveCompanyDrawer(name);
                }}
              >
                {name}
              </span>
              {isPublic && ticker && (
                <span className="public-ticker-pill" title={exchange ? `${exchange} Listed` : 'Publicly Listed'}>
                  📈 {exchange ? `${exchange}:` : ''}{ticker}
                </span>
              )}
              {idx < recipients.length - 1 && <span style={{ color: 'hsl(var(--text-muted))' }}>,</span>}
            </span>
          );
        })}
      </span>
    );
  };



  const fetchMarketStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/market-status`);
      if (res.ok) {
        const data = await res.json();
        setMarketData(prev => {
          const updatedIndices = data.indices.map(newIdx => {
            const prevIdx = prev && prev.indices.find(p => p.symbol === newIdx.symbol);
            let history = prevIdx && prevIdx.history ? [...prevIdx.history] : [];
            
            if (history.length === 0) {
              let current = newIdx.price;
              const isCrypto = newIdx.symbol === 'BTC';
              const step = isCrypto ? 25.0 : 0.25;
              for (let i = 0; i < 15; i++) {
                const change = (Math.random() - 0.48) * step;
                current -= change;
                history.unshift(current);
              }
              history[history.length - 1] = newIdx.price;
            } else {
              if (history[history.length - 1] !== newIdx.price) {
                history.push(newIdx.price);
                if (history.length > 15) history.shift();
              }
            }
            return {
              ...newIdx,
              history
            };
          });
          return {
            ...data,
            indices: updatedIndices
          };
        });
      }
    } catch (e) {
      console.error('Error fetching market status:', e);
    }
  };

  // US market indices simulation effect for ticking prices when market is active
  useEffect(() => {
    if (!marketData) return;

    const simulator = setInterval(() => {
      const isMarketClosed = marketData.status === 'CLOSED';
      // Equities can only update when market is active, BTC can update 24/7
      const symbols = isMarketClosed ? ['BTC'] : ['SPY', 'QQQ', 'BTC'];
      const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];

      setMarketData((prev) => {
        if (!prev) return null;
        const updatedIndices = prev.indices.map((idx) => {
          if (idx.symbol === randomSymbol) {
            const isUp = Math.random() > 0.45;
            const isCrypto = randomSymbol === 'BTC';
            const scale = isCrypto ? 12.0 : 0.08;
            const delta = (Math.random() * scale + (isCrypto ? 1.0 : 0.01)) * (isUp ? 1 : -1);
            const newPrice = Math.max(10, idx.price + delta);
            const newChange = idx.change + delta;
            const newPercentChange = (newChange / (newPrice - newChange)) * 100;
            
            setTickFlashes((prevFlashes) => ({
              ...prevFlashes,
              [randomSymbol]: isUp ? 'up' : 'down'
            }));

            setTimeout(() => {
              setTickFlashes((prevFlashes) => {
                const copy = { ...prevFlashes };
                delete copy[randomSymbol];
                return copy;
              });
            }, 800);

            const history = idx.history ? [...idx.history, newPrice].slice(-15) : [newPrice];

            return {
              ...idx,
              price: newPrice,
              change: newChange,
              percentChange: newPercentChange,
              history
            };
          }
          return idx;
        });

        return {
          ...prev,
          indices: updatedIndices
        };
      });
    }, 2500);

    return () => clearInterval(simulator);
  }, [marketData ? marketData.status : null]);

  const fetchPollerStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/poller-status`);
      if (res.ok) {
        setPollerStatus(await res.json());
      }
    } catch (err) {
      console.error('Error fetching poller status:', err);
    }
  };

  // Fetch news history, stats and settings on mount
  useEffect(() => {
    fetchNews();
    fetchStats();
    fetchTrends();
    fetchMarketStatus();
    fetchPollerStatus();

    const marketInterval = setInterval(() => {
      fetchMarketStatus();
      fetchPollerStatus();
    }, 15000);

    // Check browser notification permission
    if ('Notification' in window) {
      setBrowserNotificationsEnabled(Notification.permission === 'granted');
    }

    return () => clearInterval(marketInterval);
  }, []);

  // Establish Server-Sent Events connection for real-time notifications
  useEffect(() => {
    const eventSource = new EventSource(`${API_BASE}/api/stream`);

    eventSource.onopen = () => {
      setIsLive(true);
      console.log('Real-time connection opened.');
    };

    eventSource.onerror = () => {
      setIsLive(false);
      console.warn('Real-time connection disconnected. Retrying...');
    };

    eventSource.onmessage = (event) => {
      try {
        const newItem = JSON.parse(event.data);
        console.log('Received real-time news item:', newItem);
        
        // Add to state if not duplicate
        setNews(prev => {
          if (prev.some(item => item.url === newItem.url)) return prev;
          // Refresh stats to ensure counters are accurate
          fetchStats();
          fetchTrends();
          return [newItem, ...prev];
        });

        // Trigger local browser alert
        if (newItem.is_investment && Notification.permission === 'granted') {
          const amountStr = newItem.investment_amount_usd > 0
            ? `$${(newItem.investment_amount_usd / 1e6).toFixed(1)}M`
            : 'Undisclosed';
          const recipientNames = newItem.recipients
            ? newItem.recipients.map(r => typeof r === 'object' ? r.name : r).join(', ')
            : 'Entity';
          new Notification('💰 New Investment Alert!', {
            body: `${recipientNames} received ${amountStr} in ${newItem.sector || 'funding'}`,
            icon: '/favicon.ico'
          });
        }

        showToast(`New Investment Found: ${newItem.title.slice(0, 40)}...`);
      } catch (err) {
        console.error('Error parsing stream event data:', err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // Trigger automatic highlights generation when selectedAlert is opened and bullets are empty
  useEffect(() => {
    if (!selectedAlert || !selectedAlert.id) return;
    
    const bullets = selectedAlert.summary_bullets;
    if (!bullets || bullets.length === 0) {
      const fetchOnDemandBullets = async () => {
        setIsGeneratingBullets(true);
        try {
          const res = await fetch(`${API_BASE}/api/news/${selectedAlert.id}/summarize`, {
            method: 'POST'
          });
          if (res.ok) {
            const updatedItem = await res.json();
            const parsedBullets = Array.isArray(updatedItem.summary_bullets)
              ? updatedItem.summary_bullets
              : (updatedItem.summary_bullets ? JSON.parse(updatedItem.summary_bullets) : []);
            
            const enrichedItem = { ...updatedItem, summary_bullets: parsedBullets };
            
            // Only update selectedAlert if the user hasn't closed it or switched to another item in the meantime
            setSelectedAlert(prev => prev && prev.id === enrichedItem.id ? enrichedItem : prev);
            
            // Update news list so changes persist in local list state
            setNews(prevNews => prevNews.map(item => item.id === enrichedItem.id ? enrichedItem : item));
          } else {
            console.error('Failed to generate summary bullets');
          }
        } catch (err) {
          console.error('Error calling summarize API:', err);
        } finally {
          setIsGeneratingBullets(false);
        }
      };
      
      fetchOnDemandBullets();
    }
  }, [selectedAlert?.id]);

  const fetchNews = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/news?onlyInvestments=true&limit=200`);
      if (res.ok) {
        const data = await res.json();
        setNews(data);
      }
    } catch (err) {
      console.error('Error fetching news:', err);
    }
  };

  const fetchTrends = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/analytics/trends`);
      if (res.ok) {
        const data = await res.json();
        // Filter out trends before 2022-Q4
        const filtered = data.filter(d => d.quarter >= '2022-Q4');
        setTrends(filtered);
      }
    } catch (err) {
      console.error('Error fetching trends:', err);
    }
  };

  const fetchPaginatedLogs = async (resetList = false) => {
    setIsLogsLoading(true);
    try {
      const pageToFetch = resetList ? 1 : logsPage;
      const params = new URLSearchParams({
        onlyInvestments: 'true',
        page: pageToFetch.toString(),
        limit: '50',
        search: logsSearchQuery,
        sector: logsSector,
        funding_type: logsFundingType,
        sortBy: logsSortBy,
        sortOrder: logsSortOrder
      });
      if (logsListingStatus !== 'all') {
        params.append('public_listing', logsListingStatus);
      }

      const res = await fetch(`${API_BASE}/api/news?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (resetList) {
          setPaginatedNews(data.items || []);
          setLogsPage(1);
        } else {
          setPaginatedNews(prev => [...prev, ...(data.items || [])]);
        }
        setLogsTotalCount(data.totalCount || 0);
        setLogsHasMore(data.hasMore || false);
      }
    } catch (err) {
      console.error('Error fetching paginated logs:', err);
    } finally {
      setIsLogsLoading(false);
    }
  };

  // Trigger paginated logs search on filters/sort changes
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      fetchPaginatedLogs(true);
    }, 300); // 300ms debounce

    return () => clearTimeout(delayDebounceFn);
  }, [logsSearchQuery, logsSector, logsFundingType, logsListingStatus, logsSortBy, logsSortOrder]);

  // Trigger loading next page when page increments
  useEffect(() => {
    if (logsPage > 1) {
      fetchPaginatedLogs(false);
    }
  }, [logsPage]);

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/stats`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };


  const handleManualPoll = async () => {
    setIsPolling(true);
    try {
      const res = await fetch(`${API_BASE}/api/poll`, { method: 'POST' });
      if (res.ok) {
        showToast('News polling cycle started in background.');
        // Refresh feed and stats shortly after
        setTimeout(() => {
          fetchNews();
          fetchStats();
        }, 3000);
      } else {
        showToast('Failed to start polling.', 'error');
      }
    } catch (err) {
      showToast('Error connecting to backend.', 'error');
    } finally {
      setTimeout(() => setIsPolling(false), 2000);
    }
  };

  const requestNotificationPermission = () => {
    if ('Notification' in window) {
      Notification.requestPermission().then(permission => {
        setBrowserNotificationsEnabled(permission === 'granted');
        if (permission === 'granted') {
          showToast('Desktop alerts activated!');
        }
      });
    } else {
      alert('Desktop notifications are not supported in this browser.');
    }
  };

  // Filtered lists
  const investmentsOnly = news.filter(item => item.is_investment === 1 || item.is_investment === true);
  const sectors = [...new Set(investmentsOnly.map(item => item.sector).filter(Boolean))].sort();
  
  const govInvestments = investmentsOnly.filter(item => 
    item.funding_type === 'government' && (dashboardSector === 'All' || item.sector === dashboardSector)
  );
  const privateInvestments = investmentsOnly.filter(item => 
    item.funding_type !== 'government' && (dashboardSector === 'All' || item.sector === dashboardSector)
  );

  // Calculate totals for charts
  const totalFunding = investmentsOnly.reduce((acc, curr) => acc + (curr.investment_amount_usd || 0), 0);
  
  // Sector distribution calculations
  const sectorTotals = investmentsOnly.reduce((acc, curr) => {
    const sec = curr.sector || 'General';
    acc[sec] = (acc[sec] || 0) + (curr.investment_amount_usd || 0);
    return acc;
  }, {});

  const sortedSectors = Object.entries(sectorTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const maxSectorValue = Math.max(...sortedSectors.map(s => s[1]), 1);

  // Aggregate funding by recipient
  const recipientMetadata = {};
  const recipientFunding = investmentsOnly.reduce((acc, item) => {
    if (item.recipients && Array.isArray(item.recipients)) {
      item.recipients.forEach(rec => {
        if (!rec) return;
        const isObj = typeof rec === 'object' && rec !== null;
        const name = isObj ? rec.name : rec;
        acc[name] = (acc[name] || 0) + (item.investment_amount_usd || 0);
        if (isObj && (rec.is_public === true || rec.is_public === 'true')) {
          recipientMetadata[name] = {
            is_public: true,
            ticker: rec.ticker,
            exchange: rec.exchange
          };
        }
      });
    }
    return acc;
  }, {});

  const sortedRecipients = Object.entries(recipientFunding)
    .sort((a, b) => b[1] - a[1])
    .filter(([_, amount]) => amount > 0)
    .slice(0, 15);
  return (
    <div className="app-container">
      {/* Toast popup */}
      {toast && (
        <div className={`toast ${toast.type === 'error' ? 'error' : ''}`}>
          <span>{toast.type === 'error' ? '⚠️' : '✅'} {toast.message}</span>
        </div>
      )}

      {/* Sidebar Nav */}
      <div className="sidebar">
        <div className="brand-section">
          <div className="brand-logo">⚡</div>
          <div className="brand-name">InvestAlert</div>
        </div>

        <ul className="nav-menu">
          <li 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            📊 Dashboard
          </li>
          <li 
            className={`nav-item ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            🔍 Search & Analytics
          </li>
        </ul>

        {/* Minimal connection status */}
        <div className="sidebar-status">
          <div className="live-indicator">
            <span className={`live-dot ${isLive ? '' : 'offline'}`} style={{ backgroundColor: isLive ? '#2ecc71' : '#e74c3c' }}></span>
            <span>{isLive ? 'Live Sync Active' : 'Disconnected'}</span>
          </div>
          <div className="sidebar-stat-badge">
            Tracked: <strong>{stats.totalInvestments}</strong> deals
          </div>

          {/* Poller Diagnostics Widget */}
          {pollerStatus && (
            <div className="sidebar-stat-badge" style={{ marginTop: '12px', fontSize: '11px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ color: 'hsl(var(--text-bright))' }}>Poller Diagnostics</strong>
                <span className={`live-dot ${pollerStatus.isPolling ? '' : 'offline'}`} style={{ backgroundColor: pollerStatus.isPolling ? '#3498db' : (pollerStatus.lastError ? '#e74c3c' : '#95a5a6'), width: '8px', height: '8px', marginRight: 0 }}></span>
              </div>
              <div style={{ color: 'hsl(var(--text-muted))' }}>
                Last run: {pollerStatus.lastRunAt ? new Date(pollerStatus.lastRunAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Never'}
              </div>
              {pollerStatus.lastError ? (
                <div style={{ color: '#e74c3c', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pollerStatus.lastError}>⚠️ {pollerStatus.lastError}</div>
              ) : (
                <div style={{ color: '#2ecc71', marginTop: '2px' }}>✅ Healthy ({pollerStatus.itemsFound || 0} hits)</div>
              )}
            </div>
          )}

          <div className="desktop-alerts-toggle-container" style={{ marginTop: '12px', borderTop: '1px dashed hsl(var(--border-light))', paddingTop: '12px' }}>
            <button
              type="button"
              className="glass-btn"
              onClick={requestNotificationPermission}
              style={{ width: '100%', fontSize: '11px', padding: '6px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              {browserNotificationsEnabled ? '🔔 Alerts Enabled' : '🔕 Enable Alerts'}
            </button>
          </div>
        </div>
      </div>

      {/* Main Panel */}
      <main className="main-content">
        
        {/* Header */}
        <div className="view-header">
          <div className="view-title">
            <h1>
              {activeTab === 'dashboard' && 'Investment Stream'}
              {activeTab === 'logs' && 'Search & Analytics'}
            </h1>
            <p>
              {activeTab === 'dashboard' && 'Real-time tracking of funding rounds, research grants, and corporate contracts'}
              {activeTab === 'logs' && 'Browse, query, and analyze historical government grants and private venture deals'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button 
              type="button"
              className="theme-toggle-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
            </button>
            <button 
              className="glass-btn glass-btn-secondary" 
              onClick={handleManualPoll} 
              disabled={isPolling}
              style={{ padding: '8px 16px', fontSize: '13px' }}
            >
              {isPolling ? '🔄 Syncing...' : '🔄 Sync Feed'}
            </button>
          </div>
        </div>

        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <div>
            {/* Market Status & Indices Bar */}
            <MarketBar marketData={marketData} tickFlashes={tickFlashes} />

            {/* Stats Cards */}
            <div className="stats-grid">
              <div className="glass-panel stat-card gov-panel">
                <span className="stat-label">🏛️ Government Grants & Subsidies</span>
                <span className="stat-value" style={{ color: 'hsl(var(--accent-blue))' }}>
                  ${((stats.governmentFunding || 0) / 1e9).toFixed(2)}B
                </span>
                <span className="stat-trend" style={{ color: 'hsl(var(--accent-blue))' }}>
                  in {stats.governmentCount || 0} federal award{stats.governmentCount === 1 ? '' : 's'}
                </span>
                <div className="stat-meta">
                  <span>Source: <strong>USAspending.gov</strong></span>
                  <span>Data Since: <strong>Nov 30, 2022</strong></span>
                </div>
              </div>
              <div className="glass-panel stat-card private-panel">
                <span className="stat-label">💼 Private Venture Capital & Deals</span>
                <span className="stat-value" style={{ color: 'hsl(var(--accent-green))' }}>
                  ${((stats.privateFunding || 0) / 1e9).toFixed(2)}B
                </span>
                <span className="stat-trend" style={{ color: 'hsl(var(--accent-green))' }}>
                  in {stats.privateCount || 0} venture round{stats.privateCount === 1 ? '' : 's'}
                </span>
                <div className="stat-meta">
                  <span>Source: <strong>SEC EDGAR Form D</strong></span>
                  <span>Data Since: <strong>Nov 30, 2022</strong></span>
                </div>
              </div>
              <div className="glass-panel stat-card public-allocation-panel">
                <div className="allocation-main">
                  <span className="stat-label">📈 Capital Allocation</span>
                  <span className="stat-value" style={{ color: 'hsl(var(--accent-gold))' }}>
                    {stats.publicInvestmentsFunding && stats.totalFunding
                      ? `${((stats.publicInvestmentsFunding / stats.totalFunding) * 100).toFixed(1)}%`
                      : '0.0%'}
                  </span>
                  <span className="allocation-sublabel">Public Markets Share</span>
                  <div className="stat-meta" style={{ marginTop: '12px', paddingTop: '8px', width: '100%' }}>
                    <span>Combined Feeds</span>
                    <span>Since: <strong>Nov 2022</strong></span>
                  </div>
                </div>
                <div className="allocation-details">
                  <div className="allocation-row">
                    <span>Publicly Listed Companies:</span>
                    <strong>{formatAmount(stats.publicInvestmentsFunding)} ({stats.publicInvestmentsCount || 0} deals)</strong>
                  </div>
                  <div className="allocation-row">
                    <span>Private Ventures / Other:</span>
                    <strong>{formatAmount(stats.privateInvestmentsFunding)} ({stats.privateInvestmentsCount || 0} deals)</strong>
                  </div>
                  <div className="allocation-progress-bar-container">
                    <div 
                      className="allocation-progress-bar-fill"
                      style={{ width: `${stats.totalFunding > 0 ? (stats.publicInvestmentsFunding / stats.totalFunding) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Top Recipient Portfolio Row */}
            {sortedRecipients.length > 0 && (
              <div className="portfolio-recipients-container glass-panel" style={{ marginBottom: '24px' }}>
                <div className="portfolio-recipients-label">🏆 Top Recipient Portfolio:</div>
                <div className="portfolio-recipients-viewport">
                  <div 
                    className="portfolio-recipients-track"
                    style={{ '--ticker-duration': `${sortedRecipients.length * 30}s` }}
                  >
                    {/* Copy 1 */}
                    {sortedRecipients.map(([name, amount], idx) => {
                      const amountStr = formatAmount(amount);
                      const meta = recipientMetadata[name];
                      const isPublic = meta && meta.is_public;
                      return (
                        <div key={`c1-${name}-${idx}`} className={`portfolio-recipient-capsule ${isPublic ? 'public-capsule' : 'private-capsule'}`}>
                          <span className="recipient-capsule-icon">{isPublic ? '📈' : '🏢'}</span>
                          <span className="recipient-capsule-name">{name}</span>
                          {isPublic && (
                            <span className="recipient-capsule-ticker">{meta.ticker}</span>
                          )}
                          <span className="recipient-capsule-amount">{amountStr}</span>
                        </div>
                      );
                    })}
                    {/* Copy 2 (Seamless loop) */}
                    {sortedRecipients.map(([name, amount], idx) => {
                      const amountStr = formatAmount(amount);
                      const meta = recipientMetadata[name];
                      const isPublic = meta && meta.is_public;
                      return (
                        <div key={`c2-${name}-${idx}`} className={`portfolio-recipient-capsule ${isPublic ? 'public-capsule' : 'private-capsule'}`}>
                          <span className="recipient-capsule-icon">{isPublic ? '📈' : '🏢'}</span>
                          <span className="recipient-capsule-name">{name}</span>
                          {isPublic && (
                            <span className="recipient-capsule-ticker">{meta.ticker}</span>
                          )}
                          <span className="recipient-capsule-amount">{amountStr}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Sector Filter Pills */}
            {sectors.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '12px', marginBottom: '8px', scrollbarWidth: 'none', msOverflowStyle: 'none' }} className="hide-scroll">
                <button 
                  className={`segmented-btn ${dashboardSector === 'All' ? 'active' : ''}`}
                  onClick={() => setDashboardSector('All')}
                  style={{ whiteSpace: 'nowrap', borderRadius: '20px', padding: '6px 14px', fontSize: '12px' }}
                >
                  🌍 All Sectors
                </button>
                {sectors.map(sector => (
                  <button 
                    key={sector}
                    className={`segmented-btn ${dashboardSector === sector ? 'active' : ''}`}
                    onClick={() => setDashboardSector(sector)}
                    style={{ whiteSpace: 'nowrap', borderRadius: '20px', padding: '6px 14px', fontSize: '12px' }}
                  >
                    {sector}
                  </button>
                ))}
              </div>
            )}

            <div className="dual-feed-grid" style={{ marginTop: '4px' }}>
              {/* U.S. Government Grants Feed */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="feed-column-title gov-title">
                  🏛️ U.S. Government Grants & Subsidies
                </div>
                {govInvestments.length === 0 ? (
                  <div className="glass-panel" style={{ textAlign: 'center', padding: '40px', color: 'hsl(var(--text-muted))' }}>
                    <p style={{ fontSize: '15px' }}>📡 No government grants yet.</p>
                  </div>
                ) : (
                  <div className="feed-list">
                    {govInvestments.slice(0, 10).map((item) => {
                      const amount = formatAmount(item.investment_amount_usd);
                      return (
                        <div 
                          key={item.id || item.url} 
                          className="glass-panel feed-card gov-card"
                          onClick={() => setSelectedAlert(item)}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="feed-card-header">
                            <span className="feed-card-recipient" title={item.recipients?.map(r => typeof r === 'object' ? r.name : r).join(', ') || 'N/A'}>
                              🏢 {renderRecipientsInline(item.recipients)}
                            </span>
                            <span className="feed-card-amount gov-amount">
                              {amount}
                            </span>
                          </div>

                          <div className="feed-card-funder-line">
                            awarded by <strong className="funder-highlight">{item.source_or_funder || 'U.S. Government'}</strong>
                          </div>

                          <div className="feed-card-headline">
                            {item.title}
                          </div>

                           <div className="feed-card-footer">
                            {item.sector && <span className="feed-card-badge">{item.sector}</span>}
                            <span className="feed-card-badge">{item.source}</span>
                            {item.summary_bullets && (Array.isArray(item.summary_bullets) ? item.summary_bullets.length > 0 : item.summary_bullets.bullets?.length > 0) && (
                              <span className="feed-card-badge ai-highlight-badge">✨ Insights Ready</span>
                            )}
                            <span className="feed-card-date">⏱️ {new Date(item.published_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Private Venture Capital Feed */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="feed-column-title private-title">
                  💼 Private Venture Capital & Deals
                </div>
                {privateInvestments.length === 0 ? (
                  <div className="glass-panel" style={{ textAlign: 'center', padding: '40px', color: 'hsl(var(--text-muted))' }}>
                    <p style={{ fontSize: '15px' }}>📡 No private deals yet.</p>
                  </div>
                ) : (
                  <div className="feed-list">
                    {privateInvestments.slice(0, 10).map((item) => {
                      const amount = formatAmount(item.investment_amount_usd);
                      return (
                        <div 
                          key={item.id || item.url} 
                          className="glass-panel feed-card private-card"
                          onClick={() => setSelectedAlert(item)}
                          style={{ cursor: 'pointer' }}
                        >
                          <div className="feed-card-header">
                            <span className="feed-card-recipient" title={item.recipients?.map(r => typeof r === 'object' ? r.name : r).join(', ') || 'N/A'}>
                              🏢 {renderRecipientsInline(item.recipients)}
                            </span>
                            <span className="feed-card-amount private-amount">
                              {amount}
                            </span>
                          </div>

                          <div className="feed-card-funder-line">
                            backed by <strong className="funder-highlight">{item.source_or_funder || 'Private VCs'}</strong>
                          </div>

                          <div className="feed-card-headline">
                            {item.title}
                          </div>

                           <div className="feed-card-footer">
                            {item.sector && <span className="feed-card-badge">{item.sector}</span>}
                            <span className="feed-card-badge">{item.source}</span>
                            {item.summary_bullets && (Array.isArray(item.summary_bullets) ? item.summary_bullets.length > 0 : item.summary_bullets.bullets?.length > 0) && (
                              <span className="feed-card-badge ai-highlight-badge">✨ Insights Ready</span>
                            )}
                            <span className="feed-card-date">⏱️ {new Date(item.published_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* LOGS TAB */}
        {activeTab === 'logs' && (
          <div className="dashboard-grid">
            {/* Left Column: Search Feed */}
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Filter Console */}
              <div className="filter-console">
                <div className="filter-console-header">
                  <div className="filter-console-title">
                    <span>🔍 Advanced Filter Console</span>
                  </div>
                  <button 
                    type="button" 
                    className="filter-reset-btn"
                    onClick={handleClearFilters}
                  >
                    🔄 Reset Filters
                  </button>
                </div>

                {/* Quick Presets Row */}
                <div className="presets-row">
                  <span className="presets-label">⚡ Quick Presets:</span>
                  <div className="presets-list">
                    <button 
                      type="button"
                      className={`preset-btn ${logsSearchQuery === '' && logsSector === '' && logsFundingType === 'all' && logsListingStatus === 'all' && logsSortBy === 'published_at' && logsSortOrder === 'desc' ? 'active' : ''}`}
                      onClick={handleClearFilters}
                    >
                      All Transactions
                    </button>
                    <button 
                      type="button"
                      className={`preset-btn ${logsFundingType === 'government' && logsListingStatus === 'all' && logsSector === '' ? 'active' : ''}`}
                      onClick={() => {
                        setLogsFundingType('government');
                        setLogsListingStatus('all');
                        setLogsSector('');
                        setLogsPage(1);
                        showToast('Filter: Government Grants', 'success');
                      }}
                    >
                      🏛️ Gov Grants
                    </button>
                    <button 
                      type="button"
                      className={`preset-btn ${logsFundingType === 'private' && logsListingStatus === 'all' && logsSector === '' ? 'active' : ''}`}
                      onClick={() => {
                        setLogsFundingType('private');
                        setLogsListingStatus('all');
                        setLogsSector('');
                        setLogsPage(1);
                        showToast('Filter: Private Capital', 'success');
                      }}
                    >
                      💼 Venture Capital
                    </button>
                    <button 
                      type="button"
                      className={`preset-btn ${logsListingStatus === 'public' && logsFundingType === 'all' && logsSector === '' ? 'active' : ''}`}
                      onClick={() => {
                        setLogsListingStatus('public');
                        setLogsFundingType('all');
                        setLogsSector('');
                        setLogsPage(1);
                        showToast('Filter: Publicly Listed Companies', 'success');
                      }}
                    >
                      📈 Publicly Listed
                    </button>
                    <button 
                      type="button"
                      className={`preset-btn ${logsSortBy === 'investment_amount_usd' && logsSortOrder === 'desc' ? 'active' : ''}`}
                      onClick={() => {
                        setLogsSortBy('investment_amount_usd');
                        setLogsSortOrder('desc');
                        setLogsPage(1);
                        showToast('Sorted by Highest Funding', 'success');
                      }}
                    >
                      🔥 Top Funding
                    </button>
                  </div>
                </div>
                
                <div className="filter-grid">
                  <div className="filter-field field-search">
                    <span className="filter-field-label">Search Keywords</span>
                    <div className="search-input-wrapper">
                      <span className="search-input-icon">🔍</span>
                      <input
                        type="text"
                        placeholder="Search company name, funder, key phrase..."
                        className="glass-input search-input-with-icon"
                        value={logsSearchQuery}
                        onChange={(e) => {
                          setLogsSearchQuery(e.target.value);
                          setLogsPage(1);
                        }}
                      />
                      {logsSearchQuery && (
                        <button 
                          type="button" 
                          className="search-input-clear"
                          onClick={() => {
                            setLogsSearchQuery('');
                            setLogsPage(1);
                          }}
                          aria-label="Clear search"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="filter-field field-sector">
                    <span className="filter-field-label">Sector Category</span>
                    <select
                      className="glass-input"
                      value={logsSector}
                      onChange={(e) => {
                        setLogsSector(e.target.value);
                        setLogsPage(1);
                      }}
                    >
                      <option value="">📁 All Sectors</option>
                      {sectors.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>

                  <div className="filter-field field-funding">
                    <span className="filter-field-label">Funding Source</span>
                    <div className="segmented-control">
                      <button 
                        type="button" 
                        className={`segmented-btn ${logsFundingType === 'all' ? 'active' : ''}`}
                        onClick={() => {
                          setLogsFundingType('all');
                          setLogsPage(1);
                        }}
                      >
                        All Funding
                      </button>
                      <button 
                        type="button" 
                        className={`segmented-btn ${logsFundingType === 'government' ? 'active' : ''}`}
                        onClick={() => {
                          setLogsFundingType('government');
                          setLogsPage(1);
                        }}
                      >
                        🏛️ Gov Only
                      </button>
                      <button 
                        type="button" 
                        className={`segmented-btn ${logsFundingType === 'private' ? 'active' : ''}`}
                        onClick={() => {
                          setLogsFundingType('private');
                          setLogsPage(1);
                        }}
                      >
                        💼 Private Only
                      </button>
                    </div>
                  </div>

                  <div className="filter-field field-listing">
                    <span className="filter-field-label">Listing Status</span>
                    <div className="segmented-control">
                      <button 
                        type="button" 
                        className={`segmented-btn ${logsListingStatus === 'all' ? 'active' : ''}`}
                        onClick={() => {
                          setLogsListingStatus('all');
                          setLogsPage(1);
                        }}
                      >
                        All Listings
                      </button>
                      <button 
                        type="button" 
                        className={`segmented-btn ${logsListingStatus === 'public' ? 'active' : ''}`}
                        onClick={() => {
                          setLogsListingStatus('public');
                          setLogsPage(1);
                        }}
                      >
                        📈 Public Only
                      </button>
                      <button 
                        type="button" 
                        className={`segmented-btn ${logsListingStatus === 'private' ? 'active' : ''}`}
                        onClick={() => {
                          setLogsListingStatus('private');
                          setLogsPage(1);
                        }}
                      >
                        🔒 Private Only
                      </button>
                    </div>
                  </div>

                  <div className="filter-field field-sort">
                    <span className="filter-field-label">Sort Order</span>
                    <select
                      className="glass-input"
                      value={`${logsSortBy}:${logsSortOrder}`}
                      onChange={(e) => {
                        const [sortBy, sortOrder] = e.target.value.split(':');
                        setLogsSortBy(sortBy);
                        setLogsSortOrder(sortOrder);
                        setLogsPage(1);
                      }}
                    >
                      <option value="published_at:desc">📅 Newest First</option>
                      <option value="published_at:asc">📅 Oldest First</option>
                      <option value="investment_amount_usd:desc">💰 Highest Funding</option>
                      <option value="investment_amount_usd:asc">💰 Lowest Funding</option>
                    </select>
                  </div>
                </div>

                {/* Active Filters Row */}
                {(logsSearchQuery || logsSector || logsFundingType !== 'all' || logsListingStatus !== 'all') && (
                  <div className="active-filters-row">
                    <span className="active-filters-label">Active Filters:</span>
                    <div className="active-filters-list">
                      {logsSearchQuery && (
                        <span className="active-filter-badge">
                          🔍 "{logsSearchQuery}"
                          <button 
                            type="button" 
                            className="active-filter-close"
                            onClick={() => {
                              setLogsSearchQuery('');
                              setLogsPage(1);
                            }}
                          >
                            ×
                          </button>
                        </span>
                      )}
                      {logsSector && (
                        <span className="active-filter-badge">
                          📁 {logsSector}
                          <button 
                            type="button" 
                            className="active-filter-close"
                            onClick={() => {
                              setLogsSector('');
                              setLogsPage(1);
                            }}
                          >
                            ×
                          </button>
                        </span>
                      )}
                      {logsFundingType !== 'all' && (
                        <span className="active-filter-badge">
                          {logsFundingType === 'government' ? '🏛️ Gov Funding' : '💼 Private Funding'}
                          <button 
                            type="button" 
                            className="active-filter-close"
                            onClick={() => {
                              setLogsFundingType('all');
                              setLogsPage(1);
                            }}
                          >
                            ×
                          </button>
                        </span>
                      )}
                      {logsListingStatus !== 'all' && (
                        <span className="active-filter-badge">
                          {logsListingStatus === 'public' ? '📈 Public' : '🔒 Private'}
                          <button 
                            type="button" 
                            className="active-filter-close"
                            onClick={() => {
                              setLogsListingStatus('all');
                              setLogsPage(1);
                            }}
                          >
                            ×
                          </button>
                        </span>
                      )}
                      <button 
                        type="button"
                        className="clear-all-badge-btn" 
                        onClick={handleClearFilters}
                      >
                        Clear All
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px', color: 'hsl(var(--text-secondary))', paddingBottom: '8px', borderBottom: '1px solid hsl(var(--border-light))' }}>
                <div>
                  Showing {paginatedNews.length} of <strong>{logsTotalCount}</strong> investments
                </div>
                {isLogsLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'hsl(var(--accent-cyan))' }}>
                    <span className="spinner" style={{ width: '14px', height: '14px', border: '2px solid transparent', borderTopColor: 'currentColor', borderRadius: '50%', display: 'inline-block', animation: 'spin 1s linear infinite' }}></span>
                    <span>Querying DB...</span>
                  </div>
                )}
              </div>

              <div className="feed-list">
                {paginatedNews.length === 0 && !isLogsLoading ? (
                  <div style={{ textAlign: 'center', padding: '60px 40px', color: 'hsl(var(--text-muted))' }}>
                    <p style={{ fontSize: '16px', marginBottom: '8px' }}>📡 No records found.</p>
                    <p style={{ fontSize: '13px' }}>Try adjusting your search criteria or funding filters.</p>
                  </div>
                ) : (
                  paginatedNews.map((item) => {
                    const isGov = item.funding_type === 'government';
                    const amount = formatAmount(item.investment_amount_usd);

                    return (
                      <div 
                        key={item.id} 
                        className={`glass-panel feed-card ${isGov ? 'gov-card' : 'private-card'}`} 
                        onClick={() => setSelectedAlert(item)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="feed-card-header">
                          <span className="feed-card-recipient" title={item.recipients?.map(r => typeof r === 'object' ? r.name : r).join(', ') || 'N/A'}>
                            🏢 {renderRecipientsInline(item.recipients)}
                          </span>
                          <span className={`feed-card-amount ${isGov ? 'gov-amount' : 'private-amount'}`}>
                            {amount}
                          </span>
                        </div>
                        
                        <div className="feed-card-funder-line">
                          {isGov ? 'awarded by' : 'backed by'}{' '}
                          <strong className="funder-highlight">{item.source_or_funder || (isGov ? 'U.S. Government' : 'Private VCs')}</strong>
                        </div>

                        <div className="feed-card-headline">
                          {item.title}
                        </div>

                        <div className="feed-card-footer">
                          {item.sector && <span className="feed-card-badge">{item.sector}</span>}
                          <span className="feed-card-badge">{item.source}</span>
                          {item.summary_bullets && (Array.isArray(item.summary_bullets) ? item.summary_bullets.length > 0 : item.summary_bullets.bullets?.length > 0) && (
                            <span className="feed-card-badge ai-highlight-badge">✨ Insights Ready</span>
                          )}
                          <span className="feed-card-date">⏱️ {new Date(item.published_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    );
                  })
                )}

                {logsHasMore && (
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
                    <button 
                      className="glass-btn glass-btn-secondary" 
                      onClick={() => setLogsPage(prev => prev + 1)}
                      disabled={isLogsLoading}
                      style={{ minWidth: '180px' }}
                    >
                      {isLogsLoading ? '🔄 Loading...' : 'Load More'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Analytics */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Sector Distribution Card */}
              <div className="glass-panel">
                <h3 style={{ marginBottom: '20px' }}>Sector Distribution (Recent)</h3>
                {sortedSectors.length === 0 ? (
                  <p style={{ color: 'hsl(var(--text-muted))', textAlign: 'center', padding: '20px' }}>No sector chart data available.</p>
                ) : (
                  <div className="chart-container">
                    {sortedSectors.map(([sec, amount]) => {
                      const pct = Math.max(5, (amount / maxSectorValue) * 100);
                      const amountStr = `$${(amount / 1e6).toFixed(1)}M`;
                      return (
                        <div key={sec} className="custom-chart-bar-row">
                          <div className="chart-bar-label" title={sec}>{sec}</div>
                          <div className="chart-bar-bg">
                            <div className="chart-bar-fill" style={{ width: `${pct}%` }}></div>
                          </div>
                          <div className="chart-bar-value">{amountStr}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Quarterly Funding Trends SVG Card */}
              <div className="glass-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ margin: 0 }}>Quarterly Funding Trends</h3>
                  <div style={{ display: 'flex', gap: '12px', fontSize: '11px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'hsl(var(--accent-blue))', display: 'inline-block' }}></span>
                      Gov
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'hsl(var(--accent-green))', display: 'inline-block' }}></span>
                      Private
                    </span>
                  </div>
                </div>

                <div className="trend-chart-container">
                  <AnalyticsChart trends={trends} />
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* Modals & Drawers */}
      {selectedAlert && (
        <DetailModal 
          alert={selectedAlert} 
          onClose={() => setSelectedAlert(null)}
          isGeneratingBullets={isGeneratingBullets}
        />
      )}

      <CompanyDrawer 
        companyName={activeCompanyDrawer}
        isOpen={!!activeCompanyDrawer}
        onClose={() => setActiveCompanyDrawer(null)}
      />

    </div>
  );
}
