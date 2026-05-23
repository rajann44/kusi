import React, { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:3001';

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
  const [settings, setSettings] = useState({
    gemini_api_key: '',
    finnhub_api_key: '',
    discord_webhook_url: '',
    telegram_bot_token: '',
    telegram_chat_id: '',
    min_investment_amount_usd: '0',
    polling_interval_minutes: '2'
  });
  
  const [toast, setToast] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [filterSector, setFilterSector] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(false);

  // Show status indicator
  const [isLive, setIsLive] = useState(false);

  // Modal and Sandbox States
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [isGeneratingBullets, setIsGeneratingBullets] = useState(false);
  const [sandboxTitle, setSandboxTitle] = useState('');
  const [sandboxDesc, setSandboxDesc] = useState('');
  const [sandboxResult, setSandboxResult] = useState(null);
  const [isSandboxLoading, setIsSandboxLoading] = useState(false);
  const [sandboxError, setSandboxError] = useState(null);

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
  const [hoveredTrendPoint, setHoveredTrendPoint] = useState(null); // { quarter, govAmount, govCount, privateAmount, privateCount, x, y }

  // US Market hours status and indices states
  const [marketData, setMarketData] = useState(null);
  const [tickFlashes, setTickFlashes] = useState({});


  // Format funding amounts helper
  const formatAmount = (value) => {
    if (!value || value <= 0) return 'Undisclosed';
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    return `$${(value / 1e6).toFixed(1)}M`;
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
              <span>{name}</span>
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

  // Helper to render a beautiful micro sparkline SVG for index trends
  const renderSparkline = (prices, isPositive) => {
    if (!prices || prices.length < 2) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min === 0 ? 1 : max - min;
    const width = 60;
    const height = 16;
    const points = prices.map((price, idx) => {
      const x = (idx / (prices.length - 1)) * width;
      const y = height - ((price - min) / range) * height;
      return `${x},${y}`;
    }).join(' ');

    const strokeColor = isPositive ? 'hsl(var(--accent-green))' : 'hsl(var(--accent-red))';
    const fillGradient = isPositive ? 'url(#greenSparklineGrad)' : 'url(#redSparklineGrad)';

    const firstPoint = `0,${height}`;
    const lastPoint = `${width},${height}`;
    const areaPoints = `${firstPoint} ${points} ${lastPoint} Z`;

    return (
      <svg width={width} height={height} style={{ overflow: 'visible', margin: '0 4px 0 8px', flexShrink: 0 }}>
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.5"
          points={points}
        />
        <polygon
          fill={fillGradient}
          points={areaPoints}
        />
      </svg>
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
      const symbols = isMarketClosed ? ['BTC'] : ['SPY', 'QQQ', 'DIA', 'BTC'];
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

  // Fetch news history, stats and settings on mount
  useEffect(() => {
    fetchNews();
    fetchStats();
    fetchSettings();
    fetchTrends();
    fetchMarketStatus();

    const marketInterval = setInterval(fetchMarketStatus, 15000);

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

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (err) {
      console.error('Error fetching settings:', err);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        showToast('Settings saved and applied successfully!');
      } else {
        showToast('Failed to save settings.', 'error');
      }
    } catch (err) {
      showToast('Error connecting to backend.', 'error');
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

  const handleSendTestNotification = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/test-notification`, { method: 'POST' });
      if (res.ok) {
        showToast('Test notification dispatched!');
        // Refresh feed and stats to show the mock alert in the UI
        setTimeout(() => {
          fetchNews();
          fetchStats();
        }, 1500);
      } else {
        showToast('Failed to send test notification.', 'error');
      }
    } catch (err) {
      showToast('Error connecting to backend.', 'error');
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
  const sectors = [...new Set(investmentsOnly.map(item => item.sector).filter(Boolean))];
  
  const govInvestments = investmentsOnly.filter(item => item.funding_type === 'government');
  const privateInvestments = investmentsOnly.filter(item => item.funding_type !== 'government');

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

  const handleSandboxClassify = async (e) => {
    e.preventDefault();
    if (!sandboxTitle.trim()) {
      showToast('Title is required for sandbox testing.', 'error');
      return;
    }
    setIsSandboxLoading(true);
    setSandboxResult(null);
    setSandboxError(null);
    try {
      const res = await fetch(`${API_BASE}/api/sandbox-classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: sandboxTitle, description: sandboxDesc })
      });
      if (res.ok) {
        const data = await res.json();
        setSandboxResult(data);
        showToast('AI Classification Complete!');
      } else {
        const errData = await res.json();
        setSandboxError(errData.error || 'Failed to classify article.');
        showToast(errData.error || 'Failed to classify article.', 'error');
      }
    } catch (err) {
      setSandboxError('Error connecting to backend server.');
      showToast('Error connecting to backend.', 'error');
    } finally {
      setIsSandboxLoading(false);
    }
  };

  const renderDealFlow = (alert) => {
    const funder = alert.source_or_funder || 'Funder';
    const recipients = alert.recipients || [];
    const amountVal = alert.investment_amount_usd;
    const amountStr = amountVal > 0 
      ? amountVal >= 1e9 
        ? `$${(amountVal / 1e9).toFixed(2)}B` 
        : `$${(amountVal / 1e6).toFixed(1)}M`
      : 'Undisclosed';

    if (recipients.length === 0) {
      return (
        <div className="deal-flow-fallback">
          <strong>{funder}</strong> ➔ <span>Undisclosed Recipients</span>
        </div>
      );
    }

    const itemHeight = 60;
    const padding = 20;
    const totalHeight = Math.max(160, recipients.length * itemHeight);
    const svgWidth = 560;

    const funderX = 10;
    const funderY = totalHeight / 2 - 25;
    const funderWidth = 140;
    const funderHeight = 50;

    const recX = 390;
    const recWidth = 160;
    const recHeight = 40;

    const funderOutX = funderX + funderWidth;
    const funderOutY = totalHeight / 2;

    const isGov = alert.funding_type === 'government';
    const strokeFunder = isGov ? 'hsl(var(--accent-blue))' : 'hsl(var(--accent-cyan))';
    const strokeRec = isGov ? 'hsl(var(--accent-blue))' : 'hsl(var(--accent-purple))';
    const strokeAmount = isGov ? 'hsl(var(--accent-gold))' : 'hsl(var(--accent-green))';
    const gradStart = isGov ? 'hsl(var(--accent-gold))' : 'hsl(var(--accent-cyan))';
    const gradEnd = isGov ? 'hsl(var(--accent-blue))' : 'hsl(var(--accent-purple))';

    return (
      <svg className="deal-flow-svg" width="100%" height={totalHeight} viewBox={`0 0 ${svgWidth} ${totalHeight}`} style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="flow-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={gradStart} />
            <stop offset="100%" stopColor={gradEnd} />
          </linearGradient>
          <filter id="glow-effect" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {recipients.map((rec, idx) => {
          const recInX = recX;
          const recInY = idx * itemHeight + padding + recHeight / 2;
          const pathD = `M ${funderOutX} ${funderOutY} C ${(funderOutX + recInX) / 2} ${funderOutY}, ${(funderOutX + recInX) / 2} ${recInY}, ${recInX} ${recInY}`;
          const isObj = typeof rec === 'object' && rec !== null;
          const isPublic = isObj && (rec.is_public === true || rec.is_public === 'true');
          
          return (
            <g key={idx}>
              <path 
                d={pathD} 
                fill="none" 
                stroke="hsl(var(--border-glass))" 
                strokeWidth="2" 
              />
              <path 
                d={pathD} 
                fill="none" 
                stroke="url(#flow-gradient)" 
                strokeWidth="2.5" 
                className={`animated-flow-line ${isPublic ? 'flow-fast' : ''}`}
              />
            </g>
          );
        })}

        <g className="flow-node funder-node">
          <rect 
            x={funderX} 
            y={funderY} 
            width={funderWidth} 
            height={funderHeight} 
            rx="8" 
            fill="hsl(var(--bg-panel))" 
            stroke={strokeFunder} 
            strokeWidth="1.5"
          />
          <text 
            x={funderX + funderWidth / 2} 
            y={funderY + 22} 
            fill="#fff" 
            fontSize="12" 
            fontWeight="bold" 
            textAnchor="middle"
          >
            {funder.length > 20 ? funder.slice(0, 18) + '...' : funder}
          </text>
          <text 
            x={funderX + funderWidth / 2} 
            y={funderY + 38} 
            fill="hsl(var(--text-muted))" 
            fontSize="9" 
            textAnchor="middle"
          >
            CAPITAL PROVIDER
          </text>
        </g>

        <g className="flow-amount-badge">
          <rect 
            x={funderOutX + 15} 
            y={funderOutY - 12} 
            width={85} 
            height={24} 
            rx="12" 
            fill="hsl(var(--bg-panel))" 
            stroke={strokeAmount} 
            strokeWidth="1.5"
          />
          <text 
            x={funderOutX + 57.5} 
            y={funderOutY + 4} 
            fill={strokeAmount} 
            fontSize="10" 
            fontWeight="bold" 
            textAnchor="middle"
          >
            {amountStr}
          </text>
        </g>

        {recipients.map((rec, idx) => {
          const rY = idx * itemHeight + padding;
          const isObj = typeof rec === 'object' && rec !== null;
          const name = isObj ? rec.name : rec;
          const isPublic = isObj && (rec.is_public === true || rec.is_public === 'true');
          const ticker = isObj ? rec.ticker : null;
          const exchange = isObj ? rec.exchange : null;

          return (
            <g key={idx} className="flow-node recipient-node">
              <rect 
                x={recX} 
                y={rY} 
                width={recWidth} 
                height={recHeight} 
                rx="6" 
                fill="hsl(var(--bg-panel))" 
                stroke={isPublic ? 'hsl(var(--accent-gold))' : strokeRec} 
                strokeWidth={isPublic ? 2 : 1.5}
                className={isPublic ? 'public-node-rect' : ''}
              />
              {isPublic && ticker ? (
                <>
                  <text 
                    x={recX + recWidth / 2} 
                    y={rY + 18} 
                    fill="#fff" 
                    fontSize="11" 
                    fontWeight="700" 
                    textAnchor="middle"
                  >
                    {name.length > 20 ? name.slice(0, 18) + '...' : name}
                  </text>
                  <text 
                    x={recX + recWidth / 2} 
                    y={rY + 30} 
                    fill="hsl(var(--accent-gold))" 
                    fontSize="9" 
                    fontWeight="bold" 
                    textAnchor="middle"
                  >
                    📈 {exchange ? `${exchange}: ` : ''}{ticker}
                  </text>
                </>
              ) : (
                <text 
                  x={recX + recWidth / 2} 
                  y={rY + 24} 
                  fill="#fff" 
                  fontSize="11" 
                  fontWeight="600" 
                  textAnchor="middle"
                >
                  {name.length > 22 ? name.slice(0, 20) + '...' : name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  };

  // SVG Quarterly Trend Chart math & dimensions
  const paddingLeft = 55;
  const paddingRight = 15;
  const paddingTop = 20;
  const paddingBottom = 30;
  const chartWidth = 500 - paddingLeft - paddingRight; // 430
  const chartHeight = 240 - paddingTop - paddingBottom; // 190
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  const maxTrendAmount = trends.length > 0 
    ? Math.max(...trends.map(t => Math.max(t.governmentAmount || 0, t.privateAmount || 0)), 1e9) 
    : 1e9;

  const pointsGov = trends.map((item, idx) => {
    const x = trends.length > 1 
      ? paddingLeft + (idx / (trends.length - 1)) * chartWidth 
      : paddingLeft + chartWidth / 2;
    const y = paddingTop + chartHeight - ((item.governmentAmount || 0) / maxTrendAmount) * chartHeight;
    return { x, y, item };
  });

  const pointsPrivate = trends.map((item, idx) => {
    const x = trends.length > 1 
      ? paddingLeft + (idx / (trends.length - 1)) * chartWidth 
      : paddingLeft + chartWidth / 2;
    const y = paddingTop + chartHeight - ((item.privateAmount || 0) / maxTrendAmount) * chartHeight;
    return { x, y, item };
  });

  const linePathGov = pointsGov.length > 0 ? pointsGov.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') : '';
  const areaPathGov = pointsGov.length > 0 ? `${linePathGov} L ${pointsGov[pointsGov.length - 1].x} ${paddingTop + chartHeight} L ${pointsGov[0].x} ${paddingTop + chartHeight} Z` : '';

  const linePathPrivate = pointsPrivate.length > 0 ? pointsPrivate.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') : '';
  const areaPathPrivate = pointsPrivate.length > 0 ? `${linePathPrivate} L ${pointsPrivate[pointsPrivate.length - 1].x} ${paddingTop + chartHeight} L ${pointsPrivate[0].x} ${paddingTop + chartHeight} Z` : '';

  const handleChartMouseMove = (e) => {
    if (!trends || trends.length === 0) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Translate mouse position to SVG coordinates (0 to 500, 0 to 240)
    const svgX = (mouseX / rect.width) * 500;
    
    let closestIdx = 0;
    let minDiff = Infinity;
    
    trends.forEach((item, idx) => {
      const x = trends.length > 1 
        ? paddingLeft + (idx / (trends.length - 1)) * chartWidth 
        : paddingLeft + chartWidth / 2;
      const diff = Math.abs(x - svgX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });

    const closestItem = trends[closestIdx];
    const x = trends.length > 1 
      ? paddingLeft + (closestIdx / (trends.length - 1)) * chartWidth 
      : paddingLeft + chartWidth / 2;
    
    setHoveredTrendPoint({
      item: closestItem,
      x: e.clientX,
      y: e.clientY,
      svgX: x,
      idx: closestIdx
    });
  };

  const handleChartMouseLeave = () => {
    setHoveredTrendPoint(null);
  };

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
          <li 
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            ⚙️ Settings & Sandbox
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
              {activeTab === 'settings' && 'Settings & Sandbox'}
            </h1>
            <p>
              {activeTab === 'dashboard' && 'Real-time tracking of funding rounds, research grants, and corporate contracts'}
              {activeTab === 'logs' && 'Browse, query, and analyze historical government grants and private venture deals'}
              {activeTab === 'settings' && 'Configure API integrations, webhook channels, and test the classification model'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
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
            {marketData && (
              <div className="glass-panel market-status-bar" style={{ marginBottom: '24px' }}>
                {/* Global SVG Definitions for Sparkline Gradients */}
                <svg style={{ position: 'absolute', width: 0, height: 0 }}>
                  <defs>
                    <linearGradient id="greenSparklineGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--accent-green))" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="hsl(var(--accent-green))" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="redSparklineGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--accent-red))" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="hsl(var(--accent-red))" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                </svg>

                <div className="market-status-time-group">
                  <div className="market-date-string">{marketData.dateEstString}</div>
                  <div className="market-status-badge-container">
                    <span className={`market-status-dot ${marketData.status.toLowerCase()}`} />
                    <span className="market-status-label">{marketData.label}</span>
                    <span className="market-time-est">({marketData.timeEstString})</span>
                  </div>
                  {marketData.detailMessage && (
                    <div className="market-status-details">{marketData.detailMessage}</div>
                  )}
                </div>
                <div className="market-indices-group">
                  {marketData.indices.map((idx) => {
                    const isPositive = idx.change >= 0;
                    const changeSymbol = isPositive ? '+' : '';
                    const flash = tickFlashes[idx.symbol];
                    return (
                      <div key={idx.symbol} className={`market-index-item ${flash ? `flash-${flash}` : ''}`}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span className="market-index-name" style={{ lineHeight: 1 }}>{idx.name}</span>
                          <span className="market-index-price" style={{ lineHeight: 1 }}>
                            ${idx.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        {renderSparkline(idx.history, isPositive)}
                        <span className={`market-index-change ${isPositive ? 'positive' : 'negative'}`} style={{ alignSelf: 'center', minWidth: '45px', textAlign: 'right' }}>
                          {changeSymbol}{idx.percentChange.toFixed(2)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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
              </div>
              <div className="glass-panel stat-card private-panel">
                <span className="stat-label">💼 Private Venture Capital & Deals</span>
                <span className="stat-value" style={{ color: 'hsl(var(--accent-green))' }}>
                  ${((stats.privateFunding || 0) / 1e9).toFixed(2)}B
                </span>
                <span className="stat-trend" style={{ color: 'hsl(var(--accent-green))' }}>
                  in {stats.privateCount || 0} venture round{stats.privateCount === 1 ? '' : 's'}
                </span>
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
                      return (
                        <div key={`c1-${name}-${idx}`} className="portfolio-recipient-capsule">
                          <span className="recipient-capsule-name">{name}</span>
                          {meta && meta.is_public && (
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
                      return (
                        <div key={`c2-${name}-${idx}`} className="portfolio-recipient-capsule">
                          <span className="recipient-capsule-name">{name}</span>
                          {meta && meta.is_public && (
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

            <div className="dual-feed-grid" style={{ marginTop: '12px' }}>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ flexGrow: 1, minWidth: '250px' }}>
                    <input
                      type="text"
                      placeholder="🔍 Search company name, funder, key phrase..."
                      className="glass-input"
                      value={logsSearchQuery}
                      onChange={(e) => setLogsSearchQuery(e.target.value)}
                    />
                  </div>

                  <div style={{ width: '220px' }}>
                    <select
                      className="glass-input"
                      value={logsSector}
                      onChange={(e) => setLogsSector(e.target.value)}
                    >
                      <option value="">📁 All Sectors</option>
                      {sectors.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <div className="segmented-control">
                      <button 
                        type="button" 
                        className={`segmented-btn ${logsFundingType === 'all' ? 'active' : ''}`}
                        onClick={() => setLogsFundingType('all')}
                      >
                        All Funding
                      </button>
                      <button 
                        type="button" 
                        className={`segmented-btn ${logsFundingType === 'government' ? 'active' : ''}`}
                        onClick={() => setLogsFundingType('government')}
                      >
                        🏛️ Gov Only
                      </button>
                      <button 
                        type="button" 
                        className={`segmented-btn ${logsFundingType === 'private' ? 'active' : ''}`}
                        onClick={() => setLogsFundingType('private')}
                      >
                        💼 Private Only
                      </button>
                    </div>

                    <div className="segmented-control">
                      <button 
                        type="button" 
                        className={`segmented-btn ${logsListingStatus === 'all' ? 'active' : ''}`}
                        onClick={() => setLogsListingStatus('all')}
                      >
                        All Listings
                      </button>
                      <button 
                        type="button" 
                        className={`segmented-btn ${logsListingStatus === 'public' ? 'active' : ''}`}
                        onClick={() => setLogsListingStatus('public')}
                      >
                        📈 Public Only
                      </button>
                      <button 
                        type="button" 
                        className={`segmented-btn ${logsListingStatus === 'private' ? 'active' : ''}`}
                        onClick={() => setLogsListingStatus('private')}
                      >
                        🔒 Private Only
                      </button>
                    </div>
                  </div>

                  <div style={{ width: '220px' }}>
                    <select
                      className="glass-input"
                      value={`${logsSortBy}:${logsSortOrder}`}
                      onChange={(e) => {
                        const [sortBy, sortOrder] = e.target.value.split(':');
                        setLogsSortBy(sortBy);
                        setLogsSortOrder(sortOrder);
                      }}
                    >
                      <option value="published_at:desc">📅 Newest First</option>
                      <option value="published_at:asc">📅 Oldest First</option>
                      <option value="investment_amount_usd:desc">💰 Highest Funding</option>
                      <option value="investment_amount_usd:asc">💰 Lowest Funding</option>
                    </select>
                  </div>
                </div>
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

                <div className="trend-chart-container" style={{ position: 'relative' }}>
                  {trends.length === 0 ? (
                    <div style={{ height: '240px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'hsl(var(--text-muted))' }}>
                      No trend data available.
                    </div>
                  ) : (
                    <svg 
                      width="100%" 
                      height="240" 
                      viewBox="0 0 500 240" 
                      preserveAspectRatio="xMidYMid meet"
                      onMouseMove={handleChartMouseMove}
                      onMouseLeave={handleChartMouseLeave}
                      style={{ overflow: 'visible', cursor: 'crosshair' }}
                    >
                      <defs>
                        {/* Gradients */}
                        <linearGradient id="govAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--accent-blue))" stopOpacity="0.2" />
                          <stop offset="100%" stopColor="hsl(var(--accent-blue))" stopOpacity="0.00" />
                        </linearGradient>
                        <linearGradient id="privateAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--accent-green))" stopOpacity="0.2" />
                          <stop offset="100%" stopColor="hsl(var(--accent-green))" stopOpacity="0.00" />
                        </linearGradient>
                      </defs>

                      {/* Horizontal Gridlines & Y-Axis Labels */}
                      {gridLines.map((gl, idx) => {
                        const y = paddingTop + chartHeight - gl * chartHeight;
                        const val = gl * maxTrendAmount;
                        const label = val >= 1e9 ? `$${(val / 1e9).toFixed(1)}B` : `$${(val / 1e6).toFixed(0)}M`;
                        return (
                          <g key={idx} opacity="0.3">
                            <line 
                              x1={paddingLeft} 
                              y1={y} 
                              x2={paddingLeft + chartWidth} 
                              y2={y} 
                              stroke="hsl(var(--border-light))" 
                              strokeWidth="1"
                              strokeDasharray="4 4"
                            />
                            <text 
                              x={paddingLeft - 8} 
                              y={y + 3} 
                              fill="hsl(var(--text-muted))" 
                              fontSize="10" 
                              textAnchor="end"
                            >
                              {label}
                            </text>
                          </g>
                        );
                      })}

                      {/* X-Axis Labels (Quarters) */}
                      {trends.map((t, idx) => {
                        // Render every second quarter label to prevent overcrowding
                        if (trends.length > 8 && idx % 2 !== 0) return null;
                        const x = trends.length > 1 
                          ? paddingLeft + (idx / (trends.length - 1)) * chartWidth 
                          : paddingLeft + chartWidth / 2;
                        return (
                          <text 
                            key={idx}
                            x={x} 
                            y={paddingTop + chartHeight + 18} 
                            fill="hsl(var(--text-muted))" 
                            fontSize="9" 
                            textAnchor="middle"
                            opacity="0.7"
                          >
                            {t.quarter}
                          </text>
                        );
                      })}

                      {/* Gov Area & Line */}
                      {areaPathGov && (
                        <path d={areaPathGov} fill="url(#govAreaGrad)" className="trend-area" />
                      )}
                      {linePathGov && (
                        <path 
                          d={linePathGov} 
                          fill="none" 
                          stroke="hsl(var(--accent-blue))" 
                          strokeWidth="2.5" 
                          className="trend-line" 
                        />
                      )}

                      {/* Private Area & Line */}
                      {areaPathPrivate && (
                        <path d={areaPathPrivate} fill="url(#privateAreaGrad)" className="trend-area" />
                      )}
                      {linePathPrivate && (
                        <path 
                          d={linePathPrivate} 
                          fill="none" 
                          stroke="hsl(var(--accent-green))" 
                          strokeWidth="2.5" 
                          className="trend-line" 
                        />
                      )}

                      {/* Vertical Hover Guideline */}
                      {hoveredTrendPoint && (
                        <line 
                          x1={hoveredTrendPoint.svgX} 
                          y1={paddingTop} 
                          x2={hoveredTrendPoint.svgX} 
                          y2={paddingTop + chartHeight} 
                          stroke="hsl(var(--accent-cyan))" 
                          strokeWidth="1.5" 
                          strokeDasharray="2 2"
                          opacity="0.8"
                        />
                      )}

                      {/* interactive circles for Gov data points */}
                      {pointsGov.map((p, idx) => {
                        const isHovered = hoveredTrendPoint && hoveredTrendPoint.idx === idx;
                        return (
                          <circle 
                            key={idx}
                            cx={p.x}
                            cy={p.y}
                            r={isHovered ? 6 : 4}
                            fill="hsl(var(--bg-panel))"
                            stroke="hsl(var(--accent-blue))"
                            strokeWidth={isHovered ? 3 : 2}
                            className="trend-dot"
                          />
                        );
                      })}

                      {/* interactive circles for Private data points */}
                      {pointsPrivate.map((p, idx) => {
                        const isHovered = hoveredTrendPoint && hoveredTrendPoint.idx === idx;
                        return (
                          <circle 
                            key={idx}
                            cx={p.x}
                            cy={p.y}
                            r={isHovered ? 6 : 4}
                            fill="hsl(var(--bg-panel))"
                            stroke="hsl(var(--accent-green))"
                            strokeWidth={isHovered ? 3 : 2}
                            className="trend-dot"
                          />
                        );
                      })}
                    </svg>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="dashboard-grid">
            {/* Left Column: Settings Form */}
            <div className="glass-panel">
              <form onSubmit={handleSaveSettings}>
                <h3 style={{ marginBottom: '16px', borderBottom: '1px solid hsl(var(--border-light))', paddingBottom: '8px' }}>
                  🔔 Notifications & Alerts
                </h3>
                <div className="form-group" style={{ marginBottom: '24px' }}>
                  <label>Browser Desktop Notifications</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '8px' }}>
                    <span className="status-label" style={{ textTransform: 'none', letterSpacing: 'normal', fontSize: '13px' }}>
                      Status: <strong style={{ color: browserNotificationsEnabled ? 'hsl(var(--accent-green))' : 'hsl(var(--accent-red))' }}>{browserNotificationsEnabled ? 'Active' : 'Disabled'}</strong>
                    </span>
                    {!browserNotificationsEnabled && (
                      <button 
                        type="button"
                        className="glass-btn glass-btn-secondary" 
                        onClick={requestNotificationPermission}
                        style={{ padding: '8px 16px', fontSize: '13px' }}
                      >
                        Enable Desktop Alerts
                      </button>
                    )}
                  </div>
                  <div className="form-helper" style={{ marginTop: '6px' }}>Receive instant push alerts on your desktop when high-value investments are detected.</div>
                </div>

                <h3 style={{ marginTop: '24px', marginBottom: '16px', borderBottom: '1px solid hsl(var(--border-light))', paddingBottom: '8px' }}>
                  🔑 API Keys
                </h3>
                
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="gemini_api_key">Gemini AI API Key</label>
                    <input
                      type="password"
                      id="gemini_api_key"
                      className="glass-input"
                      placeholder="AIzaSy..."
                      value={settings.gemini_api_key}
                      onChange={(e) => setSettings({...settings, gemini_api_key: e.target.value})}
                    />
                    <div className="form-helper">Used to evaluate news and pull structured investment fields.</div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="finnhub_api_key">Finnhub API Key</label>
                    <input
                      type="password"
                      id="finnhub_api_key"
                      className="glass-input"
                      placeholder="c9..."
                      value={settings.finnhub_api_key}
                      onChange={(e) => setSettings({...settings, finnhub_api_key: e.target.value})}
                    />
                    <div className="form-helper">Used to gather real-time general news from PR wires.</div>
                  </div>
                </div>

                <h3 style={{ marginTop: '24px', marginBottom: '16px', borderBottom: '1px solid hsl(var(--border-light))', paddingBottom: '8px' }}>
                  📢 Webhook Integrations
                </h3>

                <div className="form-group">
                  <label htmlFor="discord_webhook_url">Discord Webhook URL</label>
                  <input
                    type="password"
                    id="discord_webhook_url"
                    className="glass-input"
                    placeholder="https://discord.com/api/webhooks/..."
                    value={settings.discord_webhook_url}
                    onChange={(e) => setSettings({...settings, discord_webhook_url: e.target.value})}
                  />
                  <div className="form-helper">Pushes rich, styled card embed alerts to your Discord channel.</div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="telegram_bot_token">Telegram Bot Token</label>
                    <input
                      type="password"
                      id="telegram_bot_token"
                      className="glass-input"
                      placeholder="123456789:ABCdefGhI..."
                      value={settings.telegram_bot_token}
                      onChange={(e) => setSettings({...settings, telegram_bot_token: e.target.value})}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="telegram_chat_id">Telegram Chat ID / Channel Username</label>
                    <input
                      type="text"
                      id="telegram_chat_id"
                      className="glass-input"
                      placeholder="@my_channel or -100123456"
                      value={settings.telegram_chat_id}
                      onChange={(e) => setSettings({...settings, telegram_chat_id: e.target.value})}
                    />
                  </div>
                </div>

                <h3 style={{ marginTop: '24px', marginBottom: '16px', borderBottom: '1px solid hsl(var(--border-light))', paddingBottom: '8px' }}>
                  🎛️ Filter Rules
                </h3>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="min_investment_amount_usd">Minimum Notification Threshold (USD)</label>
                    <input
                      type="number"
                      id="min_investment_amount_usd"
                      className="glass-input"
                      placeholder="e.g. 5000000 (for $5M)"
                      value={settings.min_investment_amount_usd}
                      onChange={(e) => setSettings({...settings, min_investment_amount_usd: e.target.value})}
                    />
                    <div className="form-helper">Alerts below this amount will log to history but not trigger Discord/Telegram pings (0 to notify all).</div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="polling_interval_minutes">News Polling Loop Interval (Minutes)</label>
                    <input
                      type="number"
                      id="polling_interval_minutes"
                      className="glass-input"
                      placeholder="2"
                      step="0.5"
                      min="1"
                      value={settings.polling_interval_minutes}
                      onChange={(e) => setSettings({...settings, polling_interval_minutes: e.target.value})}
                    />
                    <div className="form-helper">How frequently the poller looks for new articles.</div>
                  </div>
                </div>

                <div style={{ marginTop: '32px', display: 'flex', gap: '16px' }}>
                  <button type="submit" className="glass-btn">
                    💾 Save and Restart Poller
                  </button>
                  <button type="button" className="glass-btn glass-btn-secondary" onClick={handleSendTestNotification}>
                    🧪 Send Test Notification
                  </button>
                </div>
              </form>
            </div>

            {/* Right Column: AI Sandbox & Testing Utilities */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* AI Sandbox Classifier Panel */}
              <div className="glass-panel">
                <h3 style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🤖 AI Sandbox Classifier</span>
                </h3>
                <p style={{ fontSize: '13px', color: 'hsl(var(--text-secondary))', marginBottom: '16px' }}>
                  Paste a custom article title and body below to test how Gemini classifies it in real-time.
                </p>

                <form onSubmit={handleSandboxClassify} className="sandbox-form">
                  <div className="form-group" style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Headline / Title</label>
                    <input
                      type="text"
                      className="glass-input"
                      placeholder="e.g. Rigetti Computing awarded $100M grant..."
                      value={sandboxTitle}
                      onChange={(e) => setSandboxTitle(e.target.value)}
                      style={{ padding: '8px 12px' }}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: '16px' }}>
                    <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Article Summary / Text</label>
                    <textarea
                      className="glass-input"
                      placeholder="Enter snippet or description..."
                      value={sandboxDesc}
                      onChange={(e) => setSandboxDesc(e.target.value)}
                      style={{ minHeight: '80px', resize: 'vertical', padding: '8px 12px' }}
                    />
                  </div>
                  <button 
                    type="submit" 
                    className="glass-btn" 
                    disabled={isSandboxLoading} 
                    style={{ width: '100%', padding: '10px' }}
                  >
                    {isSandboxLoading ? '🤖 Classifying...' : '⚡ Test with Gemini'}
                  </button>
                </form>

                {sandboxError && (
                  <div className="sandbox-error" style={{ marginTop: '16px', color: 'hsl(var(--accent-red))', fontSize: '13px' }}>
                    ⚠️ {sandboxError}
                  </div>
                )}

                {sandboxResult && (
                  <div className="sandbox-result-panel" style={{ marginTop: '16px', borderTop: '1px solid hsl(var(--border-light))', paddingTop: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <span style={{ fontSize: '13px', fontWeight: '600' }}>Gemini Classification:</span>
                      <span className={`badge ${sandboxResult.is_investment ? 'badge-green' : 'badge-red'}`} style={{ textTransform: 'uppercase' }}>
                        {sandboxResult.is_investment ? '💸 Investment' : '🔇 Noise'}
                      </span>
                    </div>

                    {sandboxResult.is_investment ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
                        <div>
                          <span style={{ color: 'hsl(var(--text-secondary))' }}>Sector:</span>{' '}
                          <span className="badge badge-purple">{sandboxResult.sector || 'N/A'}</span>
                        </div>
                        <div>
                          <span style={{ color: 'hsl(var(--text-secondary))' }}>Amount:</span>{' '}
                          <strong style={{ color: 'hsl(var(--accent-green))' }}>
                            {sandboxResult.investment_amount_usd > 0 
                              ? `$${(sandboxResult.investment_amount_usd / 1e6).toFixed(1)}M` 
                              : 'Undisclosed'}
                          </strong>
                        </div>
                        <div>
                          <span style={{ color: 'hsl(var(--text-secondary))' }}>Funder:</span>{' '}
                          <span>{sandboxResult.source_or_funder || 'N/A'}</span>
                        </div>
                        <div>
                          <span style={{ color: 'hsl(var(--text-secondary))' }}>Recipients:</span>{' '}
                          <span>{renderRecipientsInline(sandboxResult.recipients)}</span>
                        </div>
                        {sandboxResult.summary_bullets && sandboxResult.summary_bullets.length > 0 && (
                          <ul style={{ paddingLeft: '16px', marginTop: '4px', fontSize: '12px', color: 'hsl(var(--text-secondary))' }}>
                            {sandboxResult.summary_bullets.map((bullet, idx) => (
                              <li key={idx} style={{ marginBottom: '4px' }}>{bullet}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : (
                      <p style={{ fontSize: '12px', color: 'hsl(var(--text-muted))' }}>
                        This article was classified as financial noise (does not represent a capital deal, investment or grant).
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Testing Utilities */}
              <div className="glass-panel">
                <h3 style={{ marginBottom: '12px' }}>Testing Utilities</h3>
                <p style={{ fontSize: '13px', color: 'hsl(var(--text-secondary))', marginBottom: '16px' }}>
                  Dispatch a pre-configured sample grant announcement to test Discord/Telegram connections.
                </p>
                <button className="glass-btn glass-btn-secondary" style={{ width: '100%' }} onClick={handleSendTestNotification}>
                  🚀 Trigger Mock Alert
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Details Modal */}
      {selectedAlert && (
        <div className="modal-overlay" onClick={() => setSelectedAlert(null)}>
          <div 
            className="modal-container glass-panel" 
            style={{
              borderColor: selectedAlert.funding_type === 'government' ? 'hsl(var(--accent-blue))' : 'hsl(var(--accent-green))',
              boxShadow: selectedAlert.funding_type === 'government' 
                ? '0 20px 50px rgba(0, 0, 0, 0.6), var(--glow-blue)' 
                : '0 20px 50px rgba(0, 0, 0, 0.6), var(--glow-green)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close-btn" onClick={() => setSelectedAlert(null)}>✕</button>
            
            <div className="modal-header-info">
              <div style={{ display: 'flex', gap: '8px' }}>
                <span className="badge badge-purple" style={{ textTransform: 'uppercase' }}>{selectedAlert.sector || 'General'}</span>
                {selectedAlert.funding_type === 'government' ? (
                  <span className="badge badge-blue">🏛️ Government</span>
                ) : (
                  <span className="badge badge-green">💼 Private</span>
                )}
              </div>
              <span className="modal-date">{new Date(selectedAlert.published_at).toLocaleString()}</span>
            </div>

            <h2 className="modal-title">{selectedAlert.title}</h2>
            
            <div className="modal-meta-grid">
              <div className="meta-box">
                <span className="meta-label">Capital Transferred</span>
                <span className="meta-value" style={{ color: selectedAlert.funding_type === 'government' ? 'hsl(var(--accent-gold))' : 'hsl(var(--accent-green))', fontWeight: '700' }}>
                  {selectedAlert.investment_amount_usd > 0 
                    ? `$${(selectedAlert.investment_amount_usd).toLocaleString()} USD` 
                    : 'Undisclosed'}
                </span>
              </div>
              <div className="meta-box">
                <span className="meta-label">Funder / Source</span>
                <span className="meta-value">{selectedAlert.source_or_funder || 'Unknown'}</span>
              </div>
              <div className="meta-box">
                <span className="meta-label">Source Feed</span>
                <span className="meta-value">{selectedAlert.source || 'N/A'}</span>
              </div>
            </div>

            {/* Animated Deal Flow Visualization */}
            <div className="deal-flow-section">
              <h4>Capital Flow Pipeline</h4>
              <div className="deal-flow-visualizer">
                {renderDealFlow(selectedAlert)}
              </div>
            </div>

            <div className="modal-body-content">
              <h4>About the Announcement</h4>
              <p className="modal-description">{selectedAlert.description}</p>
              
              {isGeneratingBullets ? (
                <div style={{ marginTop: '20px' }} className="bullets-loading-skeleton">
                  <h4 style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="sparkle-icon">✨</span> Generating Key AI Insights...
                  </h4>
                  <ul className="bullet-points skeleton-bullets">
                    <li className="skeleton-bullet-line"></li>
                    <li className="skeleton-bullet-line"></li>
                    <li className="skeleton-bullet-line"></li>
                  </ul>
                </div>
              ) : selectedAlert.summary_bullets && selectedAlert.summary_bullets.length > 0 ? (
                <div style={{ marginTop: '20px' }}>
                  <h4 style={{ marginBottom: '10px' }}>Key AI Insights</h4>
                  <ul className="bullet-points">
                    {selectedAlert.summary_bullets.map((bullet, idx) => (
                      <li key={idx}>{bullet}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="modal-footer-action">
              <a 
                href={selectedAlert.url} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="glass-btn"
                style={{ width: '100%', marginTop: '20px' }}
              >
                🔗 Open Original Announcement
              </a>
            </div>
          </div>
        </div>
      )}
      {/* Floating Chart Tooltip */}
      {hoveredTrendPoint && (
        <div 
          className="chart-tooltip" 
          style={{
            position: 'fixed',
            left: `${hoveredTrendPoint.x + 15}px`,
            top: `${hoveredTrendPoint.y - 10}px`,
            zIndex: 9999,
            pointerEvents: 'none'
          }}
        >
          <div className="tooltip-quarter">{hoveredTrendPoint.item.quarter}</div>
          <div className="tooltip-row">
            <span className="tooltip-indicator gov-dot"></span>
            <span className="tooltip-label">Gov Grants:</span>
            <span className="tooltip-val">{formatAmount(hoveredTrendPoint.item.governmentAmount)}</span>
            <span className="tooltip-count">({hoveredTrendPoint.item.governmentCount})</span>
          </div>
          <div className="tooltip-row">
            <span className="tooltip-indicator private-dot"></span>
            <span className="tooltip-label">Private VC:</span>
            <span className="tooltip-val">{formatAmount(hoveredTrendPoint.item.privateAmount)}</span>
            <span className="tooltip-count">({hoveredTrendPoint.item.privateCount})</span>
          </div>
        </div>
      )}
    </div>
  );
}
