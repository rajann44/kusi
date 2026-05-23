import { supabase } from './database.js';

const START_DATE = '2022-11-30';
const END_DATE = new Date().toISOString().split('T')[0];

const KEYWORDS = [
  'quantum computing', 'quantum information', 'quantum processor', 'quantum communication', 'qubit',
  'artificial intelligence', 'machine learning', 'deep learning', 'generative ai', 'neural network', 'computer vision',
  'semiconductor', 'microchip', 'integrated circuit', 'foundry', 'chips act', 'silicon wafer',
  'nuclear fusion', 'clean energy', 'solar cell', 'wind turbine', 'advanced battery', 'lithium-ion', 'geothermal',
  'biotechnology', 'synthetic biology', 'mrna', 'gene editing', 'crispr', 'therapeutics',
  'defense technology', 'aerospace', 'hypersonic', 'satellite constellation', 'autonomous drone', 'radar system'
];

function getSector(title, description) {
  const text = `${title} ${description || ''}`.toLowerCase();
  
  if (text.includes('quantum') || text.includes('qubit')) {
    return 'Quantum Computing';
  }
  if (text.includes('artificial intelligence') || text.includes('machine learning') || text.includes('deep learning') || text.includes('neural network') || text.includes('gen ai') || text.includes('generative ai')) {
    return 'AI';
  }
  if (text.includes('semiconductor') || text.includes('microchip') || text.includes('chips act') || text.includes('integrated circuit') || text.includes('silicon wafer')) {
    return 'Semiconductors';
  }
  if (text.includes('fusion') || text.includes('thermonuclear')) {
    return 'Clean Energy (Fusion)';
  }
  if (text.includes('clean energy') || text.includes('solar cell') || text.includes('wind turbine') || text.includes('advanced battery') || text.includes('lithium-ion') || text.includes('geothermal') || text.includes('climate tech') || text.includes('decarbonization') || text.includes('energy storage')) {
    return 'Clean Energy';
  }
  if (text.includes('biotechnology') || text.includes('synthetic biology') || text.includes('mrna') || text.includes('gene editing') || text.includes('crispr') || text.includes('biotech')) {
    return 'Biotechnology';
  }
  if (text.includes('defense tech') || text.includes('defense technology') || text.includes('aerospace') || text.includes('hypersonic') || text.includes('satellite constellation') || text.includes('autonomous drone') || text.includes('radar system') || text.includes('space tech') || text.includes('military')) {
    return 'Defense & Aerospace';
  }
  
  return 'Advanced Tech';
}

async function fetchGrants() {
  console.log(`Starting Government Grants Backfill from ${START_DATE} to ${END_DATE}...`);

  // 1. Fetch existing URLs to prevent duplicates
  const { data: existingRows, error: fetchErr } = await supabase
    .from('news_items')
    .select('url')
    .eq('funding_type', 'government');
  
  if (fetchErr) {
    console.error('Error fetching existing government URLs from Supabase:', fetchErr.message);
    process.exit(1);
  }
  
  const existingUrls = new Set(existingRows.map(r => r.url));
  console.log(`Loaded ${existingUrls.size} existing government URLs from Supabase.`);

  let page = 1;
  let hasMore = true;
  let newItemsToInsert = [];
  let totalFetched = 0;

  while (hasMore) {
    try {
      console.log(`Fetching USAspending page ${page}...`);
      const response = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filters: {
            time_period: [
              {
                start_date: START_DATE,
                end_date: END_DATE
              }
            ],
            award_type_codes: ['02', '03', '04', '05'], // Grants
            award_amounts: [
              {
                lower_bound: 2000000 // >= $2M
              }
            ],
            keywords: KEYWORDS
          },
          fields: [
            'Award ID',
            'Recipient Name',
            'Award Amount',
            'Awarding Agency',
            'Awarding Sub Agency',
            'Description',
            'Start Date',
            'generated_internal_id'
          ],
          page: page,
          limit: 100,
          sort: 'Start Date',
          order: 'desc'
        })
      });

      if (!response.ok) {
        console.error(`USAspending API returned status ${response.status}:`, await response.text());
        break;
      }

      const data = await response.json();
      const results = data.results || [];
      totalFetched += results.length;

      if (results.length === 0) {
        hasMore = false;
        break;
      }

      for (const item of results) {
        const generatedId = item.generated_internal_id;
        if (!generatedId) continue;

        const url = `https://www.usaspending.gov/award/${encodeURIComponent(generatedId)}`;

        // Skip if already in database
        if (existingUrls.has(url)) continue;

        const recipientName = item['Recipient Name'] || 'Unknown Recipient';
        const amount = item['Award Amount'] || 0;
        const agencyName = item['Awarding Agency'] || 'U.S. Government';
        const subAgencyName = item['Awarding Sub Agency'];
        const funder = subAgencyName ? `${agencyName} - ${subAgencyName}` : agencyName;
        const description = item['Description'] || '';
        const title = `${recipientName} awarded $${(amount / 1e6).toFixed(1)}M grant by ${funder}`;
        const sector = getSector(title, description);

        newItemsToInsert.push({
          title: title,
          description: description,
          url: url,
          published_at: item['Start Date'] ? new Date(item['Start Date']).toISOString() : new Date().toISOString(),
          source: 'USAspending',
          is_investment: true,
          investment_amount_usd: amount,
          recipients: [recipientName],
          source_or_funder: funder,
          funding_type: 'government',
          sector: sector,
          summary_bullets: [] // AI highlights generated on-demand
        });
      }

      console.log(`Page ${page}: fetched ${results.length} items. Total queue size: ${newItemsToInsert.length}`);
      
      // If we got less than the page limit, we reached the end
      if (results.length < 100) {
        hasMore = false;
      } else {
        page++;
      }
      
      // Short delay to be polite to the API
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (err) {
      console.error(`Error fetching page ${page}:`, err.message);
      break;
    }
  }

  console.log(`Fetched ${totalFetched} items in total. Found ${newItemsToInsert.length} new items to insert.`);

  // 2. Batch insert new items into Supabase
  if (newItemsToInsert.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < newItemsToInsert.length; i += batchSize) {
      const batch = newItemsToInsert.slice(i, i + batchSize);
      console.log(`Inserting batch ${i / batchSize + 1} of ${Math.ceil(newItemsToInsert.length / batchSize)}...`);
      const { error: insertErr } = await supabase
        .from('news_items')
        .insert(batch);

      if (insertErr) {
        console.error(`Error inserting batch starting at index ${i}:`, insertErr.message);
      }
    }
    console.log('Government grants backfill finished successfully!');
  } else {
    console.log('No new government grants to insert.');
  }
}

fetchGrants();
