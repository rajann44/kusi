import xml2js from 'xml2js';
import { supabase } from './database.js';

const SEC_USER_AGENT = 'RajanKusi/1.0 rajan@ticker.app';
const START_DATE = '2022-11-30';
const END_DATE = new Date().toISOString().split('T')[0];

const KEYWORDS_BY_SECTOR = {
  'Quantum Computing': ['quantum'],
  'AI': ['"artificial intelligence"', '"machine learning"', '"deep learning"'],
  'Semiconductors': ['semiconductor', 'microchip', '"integrated circuit"'],
  'Clean Energy': ['fusion', '"clean energy"', 'lithium', 'geothermal'],
  'Biotechnology': ['biotech', 'biotechnology', 'crispr'],
  'Defense & Aerospace': ['defense', 'aerospace', 'satellite', 'drone']
};

async function fetchHitsForKeyword(keyword) {
  let allHits = [];
  let fromOffset = 0;
  let hasMore = true;

  while (hasMore) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(keyword)}&forms=D&startdt=${START_DATE}&enddt=${END_DATE}&size=100&from=${fromOffset}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': SEC_USER_AGENT } });
      if (!res.ok) {
        console.error(`SEC EFTS search failed for keyword [${keyword}] at offset ${fromOffset}: status ${res.status}`);
        break;
      }

      const data = await res.json();
      const hits = data.hits?.hits || [];
      allHits = allHits.concat(hits);

      if (hits.length < 100 || allHits.length >= 10000) {
        hasMore = false;
      } else {
        fromOffset += 100;
      }
      
      // Delay to respect EFTS search limits
      await new Promise(r => setTimeout(r, 150));
    } catch (err) {
      console.error(`Error searching EFTS for keyword [${keyword}]:`, err.message);
      break;
    }
  }

  return allHits;
}

async function runBackfill() {
  console.log(`Starting Private SEC Form D Backfill since ${START_DATE} to ${END_DATE}...`);

  // 1. Fetch existing private URLs from Supabase to prevent duplicate processing
  const { data: existingRows, error: fetchErr } = await supabase
    .from('news_items')
    .select('url')
    .eq('funding_type', 'private');

  if (fetchErr) {
    console.error('Error fetching existing private URLs from Supabase:', fetchErr.message);
    process.exit(1);
  }

  const existingUrls = new Set(existingRows.map(r => r.url));
  console.log(`Loaded ${existingUrls.size} existing private URLs from Supabase.`);

  // 2. Query search index for all keywords and collect hits
  const uniqueHits = new Map(); // adsh -> { hit, sectors: Set }

  for (const [sector, keywords] of Object.entries(KEYWORDS_BY_SECTOR)) {
    for (const kw of keywords) {
      console.log(`Searching EFTS for keyword: [${kw}] (${sector})...`);
      const hits = await fetchHitsForKeyword(kw);
      console.log(`Found ${hits.length} hits for keyword [${kw}].`);

      for (const hit of hits) {
        const adsh = hit._source?.adsh;
        if (!adsh) continue;

        if (!uniqueHits.has(adsh)) {
          uniqueHits.set(adsh, {
            hit,
            sectors: new Set([sector])
          });
        } else {
          uniqueHits.get(adsh).sectors.add(sector);
        }
      }
    }
  }

  console.log(`Deduplicated search hits: ${uniqueHits.size} unique filings.`);

  // 3. Filter out hits that are already in database
  const hitsToProcess = [];
  for (const [adsh, item] of uniqueHits.entries()) {
    const cik = item.hit._source?.ciks?.[0];
    if (!cik) continue;

    const cikNum = parseInt(cik).toString();
    const adshNoHyphen = adsh.replace(/-/g, '');
    const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${adshNoHyphen}/primary_doc.xml`;

    if (!existingUrls.has(url)) {
      hitsToProcess.push({
        adsh,
        cikNum,
        url,
        fileDate: item.hit._source?.file_date,
        sectors: Array.from(item.sectors)
      });
    }
  }

  console.log(`Found ${hitsToProcess.length} new unique filings to parse.`);

  // 4. Process each new filing XML with a 150ms delay
  const parser = new xml2js.Parser({ explicitArray: false });
  const newItemsToInsert = [];
  let processedCount = 0;

  for (const info of hitsToProcess) {
    processedCount++;
    if (processedCount % 50 === 0 || processedCount === 1) {
      console.log(`Processing filing ${processedCount}/${hitsToProcess.length}...`);
    }

    try {
      const res = await fetch(info.url, { headers: { 'User-Agent': SEC_USER_AGENT } });
      
      // Delay after the request to be rate-limit compliant (150ms)
      await new Promise(r => setTimeout(r, 150));

      if (res.status === 403) {
        console.warn(`WARNING: Received 403 Forbidden from SEC for URL: ${info.url}. Rate limit might be exceeded. Waiting 5 seconds...`);
        await new Promise(r => setTimeout(r, 5000));
        // Retry once
        const retryRes = await fetch(info.url, { headers: { 'User-Agent': SEC_USER_AGENT } });
        await new Promise(r => setTimeout(r, 150));
        if (!retryRes.ok) {
          console.error(`Retry failed for URL ${info.url}: status ${retryRes.status}`);
          continue;
        }
      } else if (!res.ok) {
        console.error(`Failed to fetch XML for URL ${info.url}: status ${res.status}`);
        continue;
      }

      const xmlText = await res.text();
      const result = await parser.parseStringPromise(xmlText);
      const submission = result.edgarSubmission;
      
      if (!submission) continue;

      const recipientName = submission.primaryIssuer?.entityName || 'Unknown Company';
      const offeringData = submission.offeringData;
      
      let amountSold = 0;
      let totalOfferingAmount = 0;

      if (offeringData?.offeringSalesAmounts) {
        amountSold = parseFloat(offeringData.offeringSalesAmounts.totalAmountSold) || 0;
        totalOfferingAmount = parseFloat(offeringData.offeringSalesAmounts.totalOfferingAmount) || 0;
      }

      // Filter: Amount >= $2M OR undisclosed deal (amountSold === 0)
      if (amountSold > 0 && amountSold < 2000000) {
        // Skip small deals
        continue;
      }

      // Build descriptive title and summary description
      const amountStr = amountSold > 0 ? `$${(amountSold / 1e6).toFixed(1)}M` : 'Undisclosed amount';
      const title = `${recipientName} raises ${amountStr} in private funding`;
      
      let industryGroup = 'Technology';
      if (offeringData?.industryGroup?.industryGroupType) {
        industryGroup = offeringData.industryGroup.industryGroupType;
      }

      const description = `${recipientName} has filed a Form D with the SEC disclosing a private offering of securities. Industry: ${industryGroup}. Total offering amount: ${totalOfferingAmount > 0 ? `$${totalOfferingAmount.toLocaleString()}` : 'Undisclosed'}, total amount sold: ${amountSold > 0 ? `$${amountSold.toLocaleString()}` : 'Undisclosed'}.`;

      // Sector programmatically determined from the matching keyword query
      const sector = info.sectors[0] || 'Private Equity';

      newItemsToInsert.push({
        title: title,
        description: description,
        url: info.url,
        published_at: info.fileDate ? new Date(info.fileDate).toISOString() : new Date().toISOString(),
        source: 'SEC Form D',
        is_investment: true,
        investment_amount_usd: amountSold,
        recipients: [recipientName],
        source_or_funder: 'Private Investors',
        funding_type: 'private',
        sector: sector,
        summary_bullets: [] // AI highlights generated on-demand
      });

    } catch (err) {
      console.error(`Error parsing filing XML for URL ${info.url}:`, err.message);
    }
  }

  console.log(`Finished parsing. Found ${newItemsToInsert.length} private investments matching criteria.`);

  // 5. Batch insert new items into Supabase
  if (newItemsToInsert.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < newItemsToInsert.length; i += batchSize) {
      const batch = newItemsToInsert.slice(i, i + batchSize);
      console.log(`Inserting batch ${i / batchSize + 1} of ${Math.ceil(newItemsToInsert.length / batchSize)}...`);
      const { error: insertErr } = await supabase
        .from('news_items')
        .insert(batch);

      if (insertErr) {
        console.error(`Error inserting private batch starting at index ${i}:`, insertErr.message);
      }
    }
    console.log('SEC Form D private investments backfill finished successfully!');
  } else {
    console.log('No new private investments to insert.');
  }
}

runBackfill();
