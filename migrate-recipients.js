import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Detailed mapping of known public companies to their tickers and exchanges
const publicCompanyMap = {
  'ibm': { name: 'IBM', ticker: 'IBM', exchange: 'NYSE' },
  'globalfoundries': { name: 'GlobalFoundries', ticker: 'GFS', exchange: 'NASDAQ' },
  'rigetti computing': { name: 'Rigetti Computing', ticker: 'RGTI', exchange: 'NASDAQ' },
  'rigetti & co, llc': { name: 'Rigetti Computing', ticker: 'RGTI', exchange: 'NASDAQ' },
  'rigetti': { name: 'Rigetti Computing', ticker: 'RGTI', exchange: 'NASDAQ' },
  'd-wave quantum': { name: 'D-Wave Quantum Inc.', ticker: 'QBTS', exchange: 'NYSE' },
  'd-wave quantum inc.': { name: 'D-Wave Quantum Inc.', ticker: 'QBTS', exchange: 'NYSE' },
  'analog devices, inc.': { name: 'Analog Devices, Inc.', ticker: 'ADI', exchange: 'NASDAQ' },
  'analog devices': { name: 'Analog Devices, Inc.', ticker: 'ADI', exchange: 'NASDAQ' },
  'portland general electric company': { name: 'Portland General Electric Company', ticker: 'POR', exchange: 'NYSE' },
  'general electric company': { name: 'General Electric Company', ticker: 'GE', exchange: 'NYSE' },
  'intel federal llc': { name: 'Intel Corporation', ticker: 'INTC', exchange: 'NASDAQ' },
  'intel corp': { name: 'Intel Corporation', ticker: 'INTC', exchange: 'NASDAQ' },
  'intel': { name: 'Intel Corporation', ticker: 'INTC', exchange: 'NASDAQ' },
  'applied materials, inc': { name: 'Applied Materials, Inc.', ticker: 'AMAT', exchange: 'NASDAQ' },
  'applied materials': { name: 'Applied Materials, Inc.', ticker: 'AMAT', exchange: 'NASDAQ' },
  'northrop grumman systems corp': { name: 'Northrop Grumman Corporation', ticker: 'NOC', exchange: 'NYSE' },
  'northrop grumman': { name: 'Northrop Grumman Corporation', ticker: 'NOC', exchange: 'NYSE' },
  'microsoft': { name: 'Microsoft Corporation', ticker: 'MSFT', exchange: 'NASDAQ' },
  'nvidia': { name: 'NVIDIA Corporation', ticker: 'NVDA', exchange: 'NASDAQ' },
  'softbank': { name: 'SoftBank Group Corp.', ticker: 'SFTBY', exchange: 'OTCPK' },
  'amazon': { name: 'Amazon.com, Inc.', ticker: 'AMZN', exchange: 'NASDAQ' },
  'amd': { name: 'Advanced Micro Devices, Inc.', ticker: 'AMD', exchange: 'NASDAQ' },
  'advanced micro': { name: 'Advanced Micro Devices, Inc.', ticker: 'AMD', exchange: 'NASDAQ' },
  'cisco': { name: 'Cisco Systems, Inc.', ticker: 'CSCO', exchange: 'NASDAQ' },
  'alphabet': { name: 'Alphabet Inc.', ticker: 'GOOGL', exchange: 'NASDAQ' },
  'google': { name: 'Alphabet Inc.', ticker: 'GOOGL', exchange: 'NASDAQ' },
  'apple': { name: 'Apple Inc.', ticker: 'AAPL', exchange: 'NASDAQ' },
  'meta': { name: 'Meta Platforms, Inc.', ticker: 'META', exchange: 'NASDAQ' },
  'tesla': { name: 'Tesla, Inc.', ticker: 'TSLA', exchange: 'NASDAQ' },
  'lockheed martin': { name: 'Lockheed Martin Corporation', ticker: 'LMT', exchange: 'NYSE' },
  'boeing': { name: 'The Boeing Company', ticker: 'BA', exchange: 'NYSE' },
  'raytheon': { name: 'RTX Corporation', ticker: 'RTX', exchange: 'NYSE' },
  'general dynamics': { name: 'General Dynamics Corporation', ticker: 'GD', exchange: 'NYSE' },
  'honeywell': { name: 'Honeywell International Inc.', ticker: 'HON', exchange: 'NASDAQ' },
  'micron': { name: 'Micron Technology, Inc.', ticker: 'MU', exchange: 'NASDAQ' },
  'texas instruments': { name: 'Texas Instruments Incorporated', ticker: 'TXN', exchange: 'NASDAQ' }
};

// Returns standard structured recipient object
function processRecipientName(rawName) {
  if (!rawName) return null;
  const name = rawName.trim();
  const lower = name.toLowerCase();

  // Check exact mapping
  if (publicCompanyMap[lower]) {
    return {
      name: publicCompanyMap[lower].name,
      is_public: true,
      ticker: publicCompanyMap[lower].ticker,
      exchange: publicCompanyMap[lower].exchange
    };
  }

  // Check substring mapping for common public companies
  for (const [key, mapping] of Object.entries(publicCompanyMap)) {
    // Avoid mapping false positives like "San Francisco" -> "Cisco" or "Artificial Intelligence" -> "Intel"
    if (key.length > 4 && lower.includes(key)) {
      return {
        name: mapping.name,
        is_public: true,
        ticker: mapping.ticker,
        exchange: mapping.exchange
      };
    }
  }

  // Defaults to private
  return {
    name: name,
    is_public: false
  };
}

async function runMigration() {
  console.log('Starting Supabase recipients array-of-objects migration...');
  
  let totalProcessed = 0;
  let totalUpdated = 0;
  let page = 0;
  const batchSize = 100;

  while (true) {
    console.log(`Fetching batch ${page + 1} (offset: ${page * batchSize})...`);
    
    const { data: rows, error } = await supabase
      .from('news_items')
      .select('*')
      .range(page * batchSize, (page + 1) * batchSize - 1)
      .order('id', { ascending: true });

    if (error) {
      console.error('Error fetching database batch:', error);
      break;
    }

    if (!rows || rows.length === 0) {
      console.log('No more rows to fetch.');
      break;
    }

    const rowsToUpsert = [];

    for (const row of rows) {
      totalProcessed++;
      
      let rawRecipients = [];
      if (Array.isArray(row.recipients)) {
        rawRecipients = row.recipients;
      } else if (typeof row.recipients === 'string') {
        try {
          rawRecipients = JSON.parse(row.recipients);
        } catch (e) {
          rawRecipients = row.recipients ? [row.recipients] : [];
        }
      }

      // Check if migration is needed (i.e. elements are plain strings)
      let needsMigration = false;
      const newRecipients = [];

      for (const item of rawRecipients) {
        if (typeof item === 'string') {
          needsMigration = true;
          const structured = processRecipientName(item);
          if (structured) newRecipients.push(structured);
        } else if (item && typeof item === 'object') {
          // If already object, let's verify if we can match public mapping to enrich it
          const name = item.name || '';
          const lower = name.toLowerCase();
          
          if (!item.is_public && publicCompanyMap[lower]) {
            needsMigration = true;
            newRecipients.push({
              name: publicCompanyMap[lower].name,
              is_public: true,
              ticker: publicCompanyMap[lower].ticker,
              exchange: publicCompanyMap[lower].exchange
            });
          } else {
            newRecipients.push(item);
          }
        }
      }

      // If array is empty but rawRecipients was string, it needs migration
      if (rawRecipients.length > 0 && newRecipients.length === 0) {
        needsMigration = true;
      }

      if (needsMigration) {
        row.recipients = newRecipients;
        rowsToUpsert.push(row);
      }
    }

    if (rowsToUpsert.length > 0) {
      console.log(`Upserting ${rowsToUpsert.length} migrated rows in batch...`);
      const { error: upsertErr } = await supabase
        .from('news_items')
        .upsert(rowsToUpsert);

      if (upsertErr) {
        console.error('Error batch upserting rows:', upsertErr);
        break;
      }
      totalUpdated += rowsToUpsert.length;
    }

    if (rows.length < batchSize) {
      console.log('Reached end of database table.');
      break;
    }
    
    page++;
  }

  console.log(`\nMigration Completed!`);
  console.log(`Total rows processed: ${totalProcessed}`);
  console.log(`Total rows migrated: ${totalUpdated}`);
}

runMigration();
