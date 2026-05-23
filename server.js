import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, supabase } from './database.js';
import { runPollingCycle } from './poller.js';
import { sendDiscordNotification, sendTelegramNotification } from './notifier.js';
import { classifyNews, generateSummaryBullets } from './gemini.js';

// Load env variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// List of connected SSE clients
let sseClients = [];
let pollingIntervalHandle = null;

// Helper to push news updates to frontend via SSE and recompute trend cache
function broadcastNewInvestment(item) {
  sseClients.forEach(client => {
    client.write(`data: ${JSON.stringify(item)}\n\n`);
  });
  // Trigger cache recomputation in the background
  computeTrendsCache().catch(err => console.error('Failed to update trends cache on new item:', err.message));
}

// Fetch settings from database helper
async function getSettings() {
  const settings = {
    gemini_api_key: '',
    finnhub_api_key: '',
    discord_webhook_url: '',
    telegram_bot_token: '',
    telegram_chat_id: '',
    min_investment_amount_usd: '0',
    polling_interval_minutes: '2'
  };

  try {
    const { data: rows, error } = await supabase.from('settings').select('*');
    if (error) {
      console.warn('Error reading settings from Supabase:', error.message);
      return settings;
    }
    if (rows) {
      rows.forEach(row => {
        settings[row.key] = row.value;
      });
    }
  } catch (err) {
    console.error('Error fetching settings:', err.message);
  }
  return settings;
}

// REST API: Get news history
app.get('/api/news', async (req, res) => {
  try {
    const { 
      onlyInvestments, 
      sector, 
      funding_type,
      public_listing,
      search,
      page,
      limit = 50,
      sortBy = 'published_at',
      sortOrder = 'desc'
    } = req.query;
    
    const isPaginated = page !== undefined;
    const parsedPage = isPaginated ? parseInt(page) : 1;
    const parsedLimit = parseInt(limit);
    const offset = (parsedPage - 1) * parsedLimit;

    let queryBuilder = supabase
      .from('news_items')
      .select('*', { count: isPaginated ? 'exact' : 'none' });

    if (onlyInvestments === 'true') {
      queryBuilder = queryBuilder.eq('is_investment', true);
    }
    
    if (sector) {
      queryBuilder = queryBuilder.eq('sector', sector);
    }

    if (funding_type && funding_type !== 'all') {
      queryBuilder = queryBuilder.eq('funding_type', funding_type);
    }

    if (public_listing === 'public') {
      queryBuilder = queryBuilder.contains('recipients', JSON.stringify([{ is_public: true }]));
    } else if (public_listing === 'private') {
      queryBuilder = queryBuilder.not('recipients', 'cs', JSON.stringify([{ is_public: true }]));
    }

    if (search) {
      const trimmedSearch = search.trim();
      const escapedJsonSearch = trimmedSearch.replace(/"/g, '\\"');
      queryBuilder = queryBuilder.or(
        `title.ilike.%${trimmedSearch}%,source_or_funder.ilike.%${trimmedSearch}%,recipients.cs.[{"name":"${escapedJsonSearch}"}],recipients.cs.[{"ticker":"${escapedJsonSearch}"}],recipients.cs.["${escapedJsonSearch}"]`
      );
    }

    const allowedSortFields = ['published_at', 'investment_amount_usd', 'created_at'];
    const actualSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'published_at';
    const isAscending = sortOrder === 'asc';

    queryBuilder = queryBuilder.order(actualSortBy, { ascending: isAscending });

    if (isPaginated) {
      queryBuilder = queryBuilder.range(offset, offset + parsedLimit - 1);
    } else {
      queryBuilder = queryBuilder.limit(parsedLimit);
    }

    const { data: rows, count: totalCount, error } = await queryBuilder;

    if (error) throw error;

    // Parse JSON columns if necessary (Supabase parses JSONB arrays, but handle fallback strings)
    const parsedRows = (rows || []).map(row => ({
      ...row,
      recipients: Array.isArray(row.recipients) ? row.recipients : (row.recipients ? JSON.parse(row.recipients) : []),
      summary_bullets: Array.isArray(row.summary_bullets) ? row.summary_bullets : (row.summary_bullets ? JSON.parse(row.summary_bullets) : [])
    }));

    if (isPaginated) {
      res.json({
        items: parsedRows,
        totalCount: totalCount || 0,
        page: parsedPage,
        limit: parsedLimit,
        hasMore: (totalCount || 0) > offset + parsedRows.length
      });
    } else {
      res.json(parsedRows);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// In-memory cache for quarterly analytics trends
let trendsCache = null;

async function computeTrendsCache() {
  console.log('Computing analytics trends cache...');
  try {
    let allInvestments = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: batchData, error } = await supabase
        .from('news_items')
        .select('investment_amount_usd, funding_type, published_at')
        .eq('is_investment', true)
        .range(from, from + batchSize - 1);

      if (error) throw error;

      allInvestments = allInvestments.concat(batchData || []);
      if (!batchData || batchData.length < batchSize) {
        hasMore = false;
      } else {
        from += batchSize;
      }
    }

    const aggregates = {};

    allInvestments.forEach(item => {
      if (!item.published_at) return;
      const date = new Date(item.published_at);
      if (isNaN(date.getTime())) return;
      
      const year = date.getFullYear();
      const quarter = Math.floor(date.getMonth() / 3) + 1;
      const quarterKey = `${year}-Q${quarter}`;
      const type = item.funding_type === 'government' ? 'government' : 'private';

      if (!aggregates[quarterKey]) {
        aggregates[quarterKey] = {
          quarter: quarterKey,
          governmentAmount: 0,
          governmentCount: 0,
          privateAmount: 0,
          privateCount: 0
        };
      }

      const amount = item.investment_amount_usd || 0;
      if (type === 'government') {
        aggregates[quarterKey].governmentAmount += amount;
        aggregates[quarterKey].governmentCount += 1;
      } else {
        aggregates[quarterKey].privateAmount += amount;
        aggregates[quarterKey].privateCount += 1;
      }
    });

    // Sort quarters chronologically (e.g. 2022-Q4, 2023-Q1...)
    trendsCache = Object.values(aggregates).sort((a, b) => {
      return a.quarter.localeCompare(b.quarter);
    });

    console.log(`Computed trends cache. Total quarters: ${trendsCache.length}`);
  } catch (err) {
    console.error('Error computing trends cache:', err.message);
  }
}

// REST API: Get quarterly analytics trends
app.get('/api/analytics/trends', async (req, res) => {
  try {
    if (!trendsCache) {
      await computeTrendsCache();
    }
    res.json(trendsCache || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simple cache for market status to respect API rate limits
let marketStatusCache = null;
let marketStatusCacheTime = 0;

// REST API: Get US Market hours status and indices
app.get('/api/market-status', async (req, res) => {
  try {
    const now = Date.now();
    if (marketStatusCache && (now - marketStatusCacheTime < 10000)) {
      return res.json(marketStatusCache);
    }

    const settings = await getSettings();
    const apiKey = settings.finnhub_api_key;

    // 1. Calculate US Market Status in Eastern Time
    const nowEst = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = nowEst.getDay();
    const hours = nowEst.getHours();
    const minutes = nowEst.getMinutes();
    const timeVal = hours * 100 + minutes;

    let status = 'CLOSED';
    let label = 'Market Closed';

    // Simple market hours logic
    const year = nowEst.getFullYear();
    const month = nowEst.getMonth() + 1;
    const date = nowEst.getDate();
    const dateString = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;

    const holidays = [
      `${year}-01-01`, // New Year's
      `${year}-07-04`, // July 4th
      `${year}-12-25`, // Christmas
    ];

    const isHoliday = holidays.includes(dateString);
    const isWeekend = day === 0 || day === 6;

    if (isWeekend || isHoliday) {
      status = 'CLOSED';
      label = 'Market Closed';
    } else {
      if (timeVal >= 930 && timeVal < 1600) {
        status = 'OPEN';
        label = 'Market Open';
      } else if (timeVal >= 400 && timeVal < 930) {
        status = 'PRE_MARKET';
        label = 'Pre-Market';
      } else if (timeVal >= 1600 && timeVal < 2000) {
        status = 'AFTER_HOURS';
        label = 'After-Hours';
      } else {
        status = 'CLOSED';
        label = 'Market Closed';
      }
    }

    // Calculate US Market Status Detail Message
    let detailMessage = "";
    if (isWeekend) {
      detailMessage = "Markets closed. Reopens Monday at 9:30 AM EST.";
    } else if (isHoliday) {
      detailMessage = "Markets closed for federal holiday. Reopens next business day at 9:30 AM EST.";
    } else {
      if (status === 'OPEN') {
        const remainingHours = 15 - hours;
        const remainingMinutes = 60 - minutes;
        if (hours === 15) {
          detailMessage = `Closes in ${remainingMinutes}m. After-hours follows.`;
        } else {
          detailMessage = "Closes at 4:00 PM EST. After-hours follows until 8:00 PM.";
        }
      } else if (status === 'PRE_MARKET') {
        detailMessage = "Pre-market trading. Core market opens at 9:30 AM EST.";
      } else if (status === 'AFTER_HOURS') {
        detailMessage = "After-hours session. Closes at 8:00 PM EST.";
      } else {
        // Closed night time
        if (hours >= 20) {
          const isFriday = day === 5;
          if (isFriday) {
            detailMessage = "Markets closed for the weekend. Reopens Monday at 4:00 AM EST (Pre-Market).";
          } else {
            detailMessage = "Markets closed. Reopens tomorrow at 4:00 AM EST (Pre-Market).";
          }
        } else {
          detailMessage = "Markets closed. Pre-market session opens at 4:00 AM EST.";
        }
      }
    }

    // 2. Fetch indices (SPY, QQQ, DIA, BTC)
    const symbols = {
      SPY: { name: 'S&P 500 (SPY)', defaultPrice: 515.20, finnhubSymbol: 'SPY' },
      QQQ: { name: 'Nasdaq 100 (QQQ)', defaultPrice: 438.50, finnhubSymbol: 'QQQ' },
      DIA: { name: 'Dow Jones (DIA)', defaultPrice: 392.10, finnhubSymbol: 'DIA' },
      BTC: { name: 'Bitcoin (BTC)', defaultPrice: 67420.00, finnhubSymbol: 'BINANCE:BTCUSDT' }
    };

    const indices = [];

    for (const [symbol, info] of Object.entries(symbols)) {
      let price = info.defaultPrice;
      let change = symbol === 'BTC' ? 420.50 : 1.25;
      let percentChange = symbol === 'BTC' ? 0.63 : 0.24;
      let source = 'mock';

      if (apiKey) {
        try {
          const fetchSymbol = info.finnhubSymbol;
          const fetchPromise = fetch(`https://finnhub.io/api/v1/quote?symbol=${fetchSymbol}&token=${apiKey}`);
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000));
          const response = await Promise.race([fetchPromise, timeoutPromise]);
          
          if (response.ok) {
            const data = await response.json();
            if (data && data.c) {
              price = data.c;
              change = data.d || 0;
              percentChange = data.dp || 0;
              source = 'finnhub';
            }
          }
        } catch (e) {
          // ignore, fallback to default mock
        }
      }

      indices.push({
        symbol,
        name: info.name,
        price,
        change,
        percentChange,
        source
      });
    }

    const result = {
      status,
      label,
      detailMessage,
      timeEst: nowEst.toISOString(),
      dateEstString: nowEst.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      timeEstString: nowEst.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' EST',
      indices
    };

    marketStatusCache = result;
    marketStatusCacheTime = now;

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST API: Get database statistics
app.get('/api/stats', async (req, res) => {
  try {
    // 1. Get count of noise
    const { count: totalNoise, error: err1 } = await supabase
      .from('news_items')
      .select('*', { count: 'exact', head: true })
      .eq('is_investment', false);

    if (err1) throw err1;

    // 2. Paginate fetch all investments to bypass the 1000 row limit
    let allInvestments = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: batchData, error: err2 } = await supabase
        .from('news_items')
        .select('investment_amount_usd, funding_type, recipients')
        .eq('is_investment', true)
        .range(from, from + batchSize - 1);

      if (err2) throw err2;

      allInvestments = allInvestments.concat(batchData || []);
      if (!batchData || batchData.length < batchSize) {
        hasMore = false;
      } else {
        from += batchSize;
      }
    }

    const totalInvestments = allInvestments.length;
    const totalFunding = allInvestments.reduce((sum, r) => sum + (r.investment_amount_usd || 0), 0);

    const governmentInvestments = allInvestments.filter(r => r.funding_type === 'government');
    const privateInvestments = allInvestments.filter(r => r.funding_type !== 'government');

    const governmentCount = governmentInvestments.length;
    const governmentFunding = governmentInvestments.reduce((sum, r) => sum + (r.investment_amount_usd || 0), 0);

    const privateCount = privateInvestments.length;
    const privateFunding = privateInvestments.reduce((sum, r) => sum + (r.investment_amount_usd || 0), 0);

    let publicInvestmentsCount = 0;
    let publicInvestmentsFunding = 0;
    let privateInvestmentsCount = 0;
    let privateInvestmentsFunding = 0;

    allInvestments.forEach(r => {
      let recs = [];
      if (Array.isArray(r.recipients)) {
        recs = r.recipients;
      } else if (typeof r.recipients === 'string') {
        try {
          recs = JSON.parse(r.recipients);
        } catch (e) {
          recs = [];
        }
      }
      
      const amount = r.investment_amount_usd || 0;
      const hasPublic = Array.isArray(recs) && recs.some(rec => rec && (rec.is_public === true || rec.is_public === 'true'));
      
      if (hasPublic) {
        publicInvestmentsCount++;
        publicInvestmentsFunding += amount;
      } else {
        privateInvestmentsCount++;
        privateInvestmentsFunding += amount;
      }
    });

    res.json({
      totalInvestments: totalInvestments || 0,
      totalNoise: totalNoise || 0,
      totalFunding: totalFunding || 0,
      governmentCount,
      governmentFunding,
      privateCount,
      privateFunding,
      publicInvestmentsCount,
      publicInvestmentsFunding,
      privateInvestmentsCount,
      privateInvestmentsFunding
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST API: Get current settings
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST API: Update settings
app.post('/api/settings', async (req, res) => {
  try {
    const newSettings = req.body;
    
    for (const [key, val] of Object.entries(newSettings)) {
      const { error } = await supabase
        .from('settings')
        .upsert({ key, value: String(val) });
      if (error) throw error;
    }

    // Restart the polling cycle with the new interval if changed
    await scheduleBackgroundPolling();

    res.json({ message: 'Settings saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST API: Manually trigger a poll cycle
app.post('/api/poll', async (req, res) => {
  try {
    const settings = await getSettings();
    // Non-blocking trigger so HTTP doesn't time out
    runPollingCycle(settings, broadcastNewInvestment)
      .catch(err => console.error('Manual polling error:', err));
    
    res.json({ message: 'Polling cycle triggered' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST API: Send a mock/test notification to verify Discord/Telegram webhook credentials
app.post('/api/test-notification', async (req, res) => {
  try {
    const settings = await getSettings();
    
    const mockItem = {
      title: 'U.S. government announces CHIPS Act funding for advanced computing',
      url: 'https://example.com/test-funding-news',
      source: 'Mock Test',
      is_investment: true,
      investment_amount_usd: 120000000,
      recipients: [
        { name: 'TestQuantumCorp', is_public: false },
        { name: 'FutureSiliconLtd', is_public: true, ticker: 'FSL', exchange: 'NASDAQ' }
      ],
      source_or_funder: 'U.S. Department of Commerce',
      sector: 'Quantum & Semiconductor Foundry',
      summary_bullets: [
        'This is a mock notification to verify your connection settings.',
        'Recipient gets $120 Million for establishing a local chip packaging line.',
        'If you see this, your notifier configuration works perfectly!'
      ]
    };

    if (settings.discord_webhook_url) {
      await sendDiscordNotification(mockItem, settings.discord_webhook_url);
    }
    if (settings.telegram_bot_token && settings.telegram_chat_id) {
      await sendTelegramNotification(mockItem, settings.telegram_bot_token, settings.telegram_chat_id);
    }

    // Also push to SSE stream so UI displays the mock event
    broadcastNewInvestment(mockItem);

    res.json({ message: 'Test notification sent successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST API: Custom sandbox classification
app.post('/api/sandbox-classify', async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    const settings = await getSettings();
    const apiKey = settings.gemini_api_key;
    if (!apiKey) {
      return res.status(400).json({ error: 'Gemini API key is not configured. Please add it in settings.' });
    }
    console.log(`Running sandbox classification for: "${title}"`);
    const result = await classifyNews(title, description, apiKey);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST API: Generate summary bullets on-demand
app.post('/api/news/:id/summarize', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 1. Fetch the item from database
    const { data: item, error: fetchError } = await supabase
      .from('news_items')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !item) {
      return res.status(404).json({ error: 'News item not found' });
    }

    // Parse existing bullets if stored as a string or array
    const existingBullets = Array.isArray(item.summary_bullets)
      ? item.summary_bullets
      : (item.summary_bullets ? JSON.parse(item.summary_bullets) : []);

    if (existingBullets && existingBullets.length > 0) {
      return res.json({ ...item, summary_bullets: existingBullets });
    }

    // 2. Generate bullets using Gemini API
    const settings = await getSettings();
    const apiKey = settings.gemini_api_key;
    if (!apiKey) {
      return res.status(400).json({ error: 'Gemini API key is not configured.' });
    }

    console.log(`Generating on-demand AI highlights for item ${id}: "${item.title}"`);
    const bullets = await generateSummaryBullets(item.title, item.description, apiKey);

    if (bullets && bullets.length > 0) {
      // 3. Update database
      const { error: updateError } = await supabase
        .from('news_items')
        .update({ summary_bullets: bullets })
        .eq('id', id);

      if (updateError) {
        console.error(`Failed to update summary bullets in DB for ID ${id}:`, updateError.message);
      }
      
      item.summary_bullets = bullets;
    }

    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Server-Sent Events endpoint for real-time frontend push notifications
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Add client to active pool
  const client = res;
  sseClients.push(client);
  console.log(`Frontend client connected to real-time stream. Active: ${sseClients.length}`);

  // Ping client periodically to prevent timeout
  const pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(pingInterval);
    sseClients = sseClients.filter(c => c !== client);
    console.log(`Frontend client disconnected. Active: ${sseClients.length}`);
  });
});

// Function to dynamically schedule background polling based on settings
async function scheduleBackgroundPolling() {
  if (pollingIntervalHandle) {
    clearInterval(pollingIntervalHandle);
    pollingIntervalHandle = null;
  }

  const settings = await getSettings();
  const minutes = parseFloat(settings.polling_interval_minutes || '2');
  const ms = minutes * 60 * 1000;

  console.log(`Scheduling background polling every ${minutes} minutes (${ms}ms)`);
  
  pollingIntervalHandle = setInterval(async () => {
    try {
      const currentSettings = await getSettings();
      await runPollingCycle(currentSettings, broadcastNewInvestment);
    } catch (err) {
      console.error('Error during scheduled poll cycle:', err);
    }
  }, ms);
}

// Start Server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  try {
    await initDatabase();
    
    // Compute initial trends cache
    await computeTrendsCache();
    
    // Schedule the loop
    await scheduleBackgroundPolling();

    // Trigger initial poll on startup
    const settings = await getSettings();
    console.log('Running startup news poll...');
    runPollingCycle(settings, broadcastNewInvestment)
      .catch(err => console.error('Startup polling error:', err));
  } catch (err) {
    console.error('Initialization error during server startup:', err.message);
  }
});
