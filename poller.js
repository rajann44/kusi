import xml2js from 'xml2js';
import { supabase } from './database.js';
import { classifyNews } from './gemini.js';
import { sendDiscordNotification, sendTelegramNotification } from './notifier.js';

// SEC EDGAR requires a specific User-Agent format: "Name contact@email.com"
const SEC_USER_AGENT = 'RajanInvestAlert/1.0 rajan@ticker.app';

/**
 * Polls the Finnhub news endpoint.
 */
async function pollFinnhubNews(apiKey) {
  if (!apiKey) return [];
  try {
    const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${apiKey}`);
    if (!res.ok) {
      console.error(`Finnhub API returned status ${res.status}`);
      return [];
    }
    const articles = await res.json();
    return articles.map(a => ({
      title: a.headline,
      description: a.summary,
      url: a.url,
      published_at: new Date(a.datetime * 1000).toISOString(),
      source: 'Finnhub'
    }));
  } catch (err) {
    console.error('Error polling Finnhub:', err.message);
    return [];
  }
}

/**
 * Polls the SEC EDGAR RSS feed.
 */
async function pollSecEdgar() {
  try {
    const res = await fetch('https://www.sec.gov/Archives/edgar/xbrlrss.all.xml', {
      headers: {
        'User-Agent': SEC_USER_AGENT,
        'Accept-Encoding': 'gzip, deflate'
      }
    });
    if (!res.ok) {
      console.error(`SEC EDGAR returned status ${res.status}`);
      return [];
    }
    const xmlText = await res.text();
    
    // Parse XML
    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(xmlText);
    
    // SEC browse-edgar XML has a feed structure with entries
    const feed = result.feed || result.rss;
    if (!feed) return [];

    let entries = [];
    if (feed.entry) {
      entries = Array.isArray(feed.entry) ? feed.entry : [feed.entry];
    } else if (feed.channel && feed.channel.item) {
      entries = Array.isArray(feed.channel.item) ? feed.channel.item : [feed.channel.item];
    }

    return entries.map(entry => {
      const link = entry.link?.$?.href || entry.link || entry.guid || '';
      return {
        title: entry.title || 'SEC Filing',
        description: entry.summary?._ || entry.summary || entry.description || 'SEC Filing details',
        url: link,
        published_at: entry.updated || entry.pubDate || new Date().toISOString(),
        source: 'SEC EDGAR'
      };
    }).filter(e => e.url); // filter out empty URLs
  } catch (err) {
    console.error('Error polling SEC EDGAR:', err.message);
    return [];
  }
}

/**
 * Runs a full polling and classification cycle.
 */
export async function runPollingCycle(settings, onNewItemFound) {
  console.log(`[${new Date().toISOString()}] Polling news sources...`);

  // Gather feeds
  const finnhubItems = await pollFinnhubNews(settings.finnhub_api_key);
  const secItems = await pollSecEdgar();
  const allItems = [...finnhubItems, ...secItems];

  let newInvestmentsCount = 0;

  for (const item of allItems) {
    try {
      // 1. Check if the URL already exists in database
      const { data: existing, error: checkError } = await supabase
        .from('news_items')
        .select('id, is_investment')
        .eq('url', item.url)
        .maybeSingle();

      if (checkError) {
        console.error(`Error checking duplicate URL ${item.url}:`, checkError.message);
        continue;
      }
      
      if (existing) {
        continue; // already processed
      }

      // 2. Insert as pending/unclassified into database (pre-emptively to prevent duplicate polling races)
      const { data: insertedData, error: insertError } = await supabase
        .from('news_items')
        .insert({
          title: item.title,
          description: item.description || '',
          url: item.url,
          published_at: item.published_at,
          source: item.source,
          is_investment: false
        })
        .select('id')
        .single();
      
      if (insertError) {
        console.error(`Error inserting pending item ${item.title}:`, insertError.message);
        continue;
      }
      
      const dbId = insertedData.id;

      // 3. Run Gemini AI classification
      console.log(`Classifying: "${item.title}"`);
      const aiResult = await classifyNews(item.title, item.description, settings.gemini_api_key);

      if (aiResult && aiResult.is_investment) {
        console.log(`💥 INVESTMENT DETECTED! Amount: $${aiResult.investment_amount_usd.toLocaleString()} | Sector: ${aiResult.sector}`);

        // Update database with structured classification info
        const { error: updateError } = await supabase
          .from('news_items')
          .update({
            is_investment: true,
            investment_amount_usd: aiResult.investment_amount_usd || 0,
            recipients: aiResult.recipients || [],
            source_or_funder: aiResult.source_or_funder || 'Unknown',
            funding_type: aiResult.funding_type || 'private',
            sector: aiResult.sector || 'General',
            summary_bullets: aiResult.summary_bullets || []
          })
          .eq('id', dbId);

        if (updateError) {
          console.error(`Error updating investment details for ID ${dbId}:`, updateError.message);
          continue;
        }

        const fullyClassifiedItem = {
          ...item,
          id: dbId,
          is_investment: true,
          investment_amount_usd: aiResult.investment_amount_usd || 0,
          recipients: aiResult.recipients || [],
          source_or_funder: aiResult.source_or_funder || 'Unknown',
          funding_type: aiResult.funding_type || 'private',
          sector: aiResult.sector || 'General',
          summary_bullets: aiResult.summary_bullets || []
        };

        // Filter alerts by threshold
        const minAmount = parseFloat(settings.min_investment_amount_usd || '0');
        if (fullyClassifiedItem.investment_amount_usd >= minAmount) {
          // 4. Send External Notifications
          if (settings.discord_webhook_url) {
            await sendDiscordNotification(fullyClassifiedItem, settings.discord_webhook_url);
          }
          if (settings.telegram_bot_token && settings.telegram_chat_id) {
            await sendTelegramNotification(
              fullyClassifiedItem, 
              settings.telegram_bot_token, 
              settings.telegram_chat_id
            );
          }

          // 5. Notify local SSE clients
          if (onNewItemFound) {
            onNewItemFound(fullyClassifiedItem);
          }
          
          newInvestmentsCount++;
        }
      }
    } catch (err) {
      console.error(`Error processing item "${item.title}":`, err.message);
    }
  }

  console.log(`Polling cycle finished. Found ${newInvestmentsCount} new relevant investments.`);
}
