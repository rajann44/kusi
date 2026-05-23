import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, supabase } from './database.js';
import { runPollingCycle } from './poller.js';
import { classifyNews, generateSummaryBullets } from './gemini.js';
import { POLLING_INTERVAL_MINUTES } from './config.js';

// Load env variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// CORS Security Fix
const allowedOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',') 
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json());

// Rate Limiters (Protection against abuse / Denial of Wallet)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true,
  legacyHeaders: false,
});

const aiActionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // Limit each IP to 30 summarize/AI requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests from this IP, please try again after an hour' }
});

const pollLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit manual polling to 10 requests per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many polling requests from this IP, please wait before trying again' }
});

app.use('/api/', apiLimiter);

// List of connected SSE clients
let sseClients = [];
let pollingIntervalHandle = null;

let pollerStatus = {
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  isPolling: false,
  itemsFound: 0
};

async function executePoll() {
  if (pollerStatus.isPolling) return;
  pollerStatus.isPolling = true;
  pollerStatus.lastRunAt = new Date().toISOString();
  pollerStatus.lastError = null;
  try {
    const settings = await getSettings();
    const result = await runPollingCycle(settings, broadcastNewInvestment);
    pollerStatus.lastSuccessAt = new Date().toISOString();
    if (result !== undefined) {
      pollerStatus.itemsFound = result;
    }
  } catch (err) {
    console.error('Error during poll cycle:', err);
    pollerStatus.lastError = err.message;
  } finally {
    pollerStatus.isPolling = false;
  }
}

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
    gemini_api_key: process.env.GEMINI_API_KEY || '',
    finnhub_api_key: process.env.FINNHUB_API_KEY || ''
  };

  try {
    const { data: rows, error } = await supabase.from('settings').select('*');
    if (error) {
      console.warn('Error reading settings from Supabase:', error.message);
      return settings;
    }
    if (rows) {
      rows.forEach(row => {
        if (row.key === 'gemini_api_key' && !settings.gemini_api_key) {
          settings.gemini_api_key = row.value;
        } else if (row.key === 'finnhub_api_key' && !settings.finnhub_api_key) {
          settings.finnhub_api_key = row.value;
        }
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
      // Security: Strip out PostgREST reserved characters to prevent filter injection
      let safeSearch = search.replace(/[,.():]/g, ' ').trim();
      const escapedJsonSearch = safeSearch.replace(/"/g, '\\"');
      
      // Remove double spaces resulting from replace
      safeSearch = safeSearch.replace(/\s+/g, ' ');
      
      if (safeSearch) {
        queryBuilder = queryBuilder.or(
          `title.ilike.%${safeSearch}%,source_or_funder.ilike.%${safeSearch}%,recipients.cs.[{"name":"${escapedJsonSearch}"}],recipients.cs.[{"ticker":"${escapedJsonSearch}"}],recipients.cs.["${escapedJsonSearch}"]`
        );
      }
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

    // 2. Fetch indices (SPY, QQQ, BTC)
    const symbols = {
      SPY: { name: 'S&P 500 (SPY)', defaultPrice: 747.47, finnhubSymbol: 'SPY' },
      QQQ: { name: 'Nasdaq 100 (QQQ)', defaultPrice: 717.66, finnhubSymbol: 'QQQ' },
      BTC: { name: 'Bitcoin (BTC)', defaultPrice: 76000.00, finnhubSymbol: 'BINANCE:BTCUSDT' }
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

// REMOVED INSECURE SETTINGS APIs (GET /api/settings and POST /api/settings)


// REST API: Get poller diagnostics status
app.get('/api/poller-status', (req, res) => {
  res.json(pollerStatus);
});

// REST API: Manually trigger a poll cycle (Rate limited)
app.post('/api/poll', pollLimiter, async (req, res) => {
  try {
    // Non-blocking trigger so HTTP doesn't time out
    executePoll().catch(err => console.error('Manual polling error:', err));
    
    res.json({ message: 'Polling cycle triggered' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST API: Generate summary bullets on-demand (Rate limited)
app.post('/api/news/:id/summarize', aiActionLimiter, async (req, res) => {
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

// REST API: Get company history
app.get('/api/companies/:name/history', async (req, res) => {
  try {
    const companyName = req.params.name;
    
    // Use JSON.stringify to 100% safely escape ALL special characters (quotes, backslashes, newlines)
    const queryObj = JSON.stringify([{ "name": companyName }]);
    const queryStr = JSON.stringify([companyName]);
    
    // Use Promise.all to run both contains queries to avoid PostgREST .or() parsing errors with commas
    const [q1, q2] = await Promise.all([
      supabase
        .from('news_items')
        .select('id, title, investment_amount_usd, funding_type, published_at, source_or_funder, recipients')
        .eq('is_investment', true)
        .contains('recipients', queryObj)
        .order('published_at', { ascending: false })
        .limit(100),
      supabase
        .from('news_items')
        .select('id, title, investment_amount_usd, funding_type, published_at, source_or_funder, recipients')
        .eq('is_investment', true)
        .contains('recipients', queryStr)
        .order('published_at', { ascending: false })
        .limit(100)
    ]);

    if (q1.error) throw q1.error;
    if (q2.error) throw q2.error;

    // Merge and deduplicate
    const merged = [...(q1.data || []), ...(q2.data || [])];
    const unique = Array.from(new Map(merged.map(item => [item.id, item])).values());
    unique.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));

    res.json(unique);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Function to dynamically schedule background polling based on settings
async function scheduleBackgroundPolling() {
  if (pollingIntervalHandle) {
    clearInterval(pollingIntervalHandle);
    pollingIntervalHandle = null;
  }

  const minutes = POLLING_INTERVAL_MINUTES;
  const ms = minutes * 60 * 1000;

  console.log(`Scheduling background polling every ${minutes} minutes (${ms}ms)`);
  
  pollingIntervalHandle = setInterval(async () => {
    try {
      await executePoll();
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
    console.log('Running startup news poll...');
    executePoll().catch(err => console.error('Startup polling error:', err));
  } catch (err) {
    console.error('Initialization error during server startup:', err.message);
  }
});
