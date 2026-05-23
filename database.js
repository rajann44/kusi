import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

const isValidUrl = supabaseUrl && supabaseUrl.startsWith('https://');
const isValidKey = supabaseKey && !supabaseKey.startsWith('YOUR_');

// Exported supabase client
export let supabase;

if (!isValidUrl || !isValidKey) {
  console.warn('\n================================================================');
  console.warn('⚠️ WARNING: Supabase URL or Key is not configured in your .env file!');
  console.warn('Please update the .env file in the root of your project:');
  console.warn('  SUPABASE_URL=https://your-project-id.supabase.co');
  console.warn('  SUPABASE_KEY=your-service-role-key');
  console.warn('================================================================\n');
  
  supabase = {
    from: () => {
      const builder = {
        select: () => builder,
        insert: () => builder,
        update: () => builder,
        delete: () => builder,
        eq: () => builder,
        ilike: () => builder,
        order: () => builder,
        limit: () => builder,
        single: () => Promise.resolve({ data: null, error: new Error('Supabase is not configured') }),
        maybeSingle: () => Promise.resolve({ data: null, error: new Error('Supabase is not configured') }),
        then: (onfulfilled) => onfulfilled({ data: [], error: new Error('Supabase is not configured') })
      };
      return builder;
    }
  };
} else {
  supabase = createClient(supabaseUrl, supabaseKey);
}

// Initialize database check & seeding
export const initDatabase = async () => {
  try {
    console.log('Checking database connection to Supabase:', supabaseUrl);
    
    // Check if table is accessible by reading count
    const { count, error } = await supabase
      .from('news_items')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error('Error connecting to Supabase: Check if tables exist in your Supabase SQL Editor.', error.message);
      return;
    }

    console.log(`Connected to Supabase. Found ${count} news items.`);

    // Check if the government quantum grant is present and has funding_type
    const { data: seedCheck } = await supabase
      .from('news_items')
      .select('funding_type')
      .eq('url', 'https://www.wsj.com/tech/quantum-computing-grants-ibm-rigetti-globalfoundries-7382e6be')
      .maybeSingle();

    if (count === 0 || !seedCheck || !seedCheck.funding_type) {
      console.log('Database needs seeding/re-seeding of historical items.');
      await seedDatabase();
    } else {
      console.log('Database already has seeded items with funding_type. Skipping seeding.');
    }
  } catch (err) {
    console.error('Initialization error during database startup:', err.message);
  }
};

// Seed database with historical real-world news if empty
const seedDatabase = async () => {
  console.log('Seeding Supabase database with historical investment alerts...');

  const seeds = [
    {
      title: 'Trump Administration Reaches Agreements for Over $2B in Quantum Computing Grants',
      description: 'Under the CHIPS and Science Act, the U.S. Department of Commerce has agreed to provide over $2 billion in federal funding to nine quantum computing companies, including a $1B grant to IBM for a wafer foundry, $375M to GlobalFoundries, and around $100M each to Rigetti, D-Wave, and others in exchange for minority equity stakes.',
      url: 'https://www.wsj.com/tech/quantum-computing-grants-ibm-rigetti-globalfoundries-7382e6be',
      published_at: '2026-05-21T13:00:00Z',
      source: 'WSJ',
      is_investment: true,
      funding_type: 'government',
      investment_amount_usd: 2000000000,
      recipients: [
        { name: 'IBM', is_public: true, ticker: 'IBM', exchange: 'NYSE' },
        { name: 'GlobalFoundries', is_public: true, ticker: 'GFS', exchange: 'NASDAQ' },
        { name: 'Rigetti Computing', is_public: true, ticker: 'RGTI', exchange: 'NASDAQ' },
        { name: 'D-Wave Quantum', is_public: true, ticker: 'QBTS', exchange: 'NYSE' },
        { name: 'Atom Computing', is_public: false },
        { name: 'PsiQuantum', is_public: false },
        { name: 'Quantinuum', is_public: false },
        { name: 'Infleqtion', is_public: false },
        { name: 'Diraq', is_public: false }
      ],
      source_or_funder: 'U.S. Department of Commerce (CHIPS Act)',
      sector: 'Quantum Computing',
      summary_bullets: [
        'Provides over $2 billion in federal funding to nine quantum computing companies.',
        'IBM receives $1B to launch pure-play quantum foundry \'Anderon\' in Albany, NY.',
        'U.S. Government acquires minority, non-controlling equity stakes in exchange.'
      ]
    },
    {
      title: 'AI Cloud Specialist CoreWeave Secures $7.5 Billion Debt Financing Facility',
      description: 'CoreWeave has secured a $7.5 billion debt facility led by Blackstone Tactical Opportunities and Magnetar Capital to fund its rapid acquisition of advanced GPU hardware and expand its AI data center footprint.',
      url: 'https://www.bloomberg.com/news/articles/2026-05-15/coreweave-secures-7-5b-debt-facility',
      published_at: '2026-05-15T10:00:00Z',
      source: 'Bloomberg',
      is_investment: true,
      funding_type: 'private',
      investment_amount_usd: 7500000000,
      recipients: [
        { name: 'CoreWeave', is_public: false }
      ],
      source_or_funder: 'Blackstone & Magnetar Capital',
      sector: 'AI Infrastructure',
      summary_bullets: [
        'Secures a massive $7.5B debt facility to expand AI cloud capacity.',
        'Led by Blackstone Tactical Opportunities and Magnetar Capital.',
        'Funds will be used to buy advanced GPUs and build data centers.'
      ]
    },
    {
      title: 'Autonomous Driving Startup Wayve Raises $1.05 Billion Series C Led by SoftBank',
      description: 'Wayve has closed a $1.05 billion Series C funding round to develop its Embodied AI technology for self-driving cars. The round was led by SoftBank Group with participation from NVIDIA and Microsoft.',
      url: 'https://techcrunch.com/2026-05-08/wayve-raises-1b-series-c-softbank-nvidia-microsoft',
      published_at: '2026-05-08T09:00:00Z',
      source: 'TechCrunch',
      is_investment: true,
      funding_type: 'private',
      investment_amount_usd: 1050000000,
      recipients: [
        { name: 'Wayve', is_public: false }
      ],
      source_or_funder: 'SoftBank Group, NVIDIA, Microsoft',
      sector: 'Autonomous Vehicles',
      summary_bullets: [
        'Raises $1.05 Billion in Series C funding to scale Embodied AI.',
        'Led by SoftBank Group, with backing from chip giant NVIDIA.',
        'Microsoft participates to support cloud compute requirements.'
      ]
    },
    {
      title: 'Scale AI Secures $1 Billion Series F at a $13.8 Billion Valuation',
      description: 'Scale AI has raised $1 billion in late-stage funding to double down on AI data labeling services. The round was led by Accel and included new investors Cisco, AMD, and Amazon.',
      url: 'https://www.wsj.com/tech/scale-ai-secures-1b-series-f-accel',
      published_at: '2026-05-01T15:00:00Z',
      source: 'WSJ',
      is_investment: true,
      funding_type: 'private',
      investment_amount_usd: 1000000000,
      recipients: [
        { name: 'Scale AI', is_public: false }
      ],
      source_or_funder: 'Accel, Cisco, AMD, Amazon',
      sector: 'AI Data Services',
      summary_bullets: [
        'Raises $1B at a valuation of $13.8 Billion.',
        'Led by Accel, with participation from corporate venture arms of AMD and Cisco.',
        'Funding will accelerate growth of enterprise data engineering pipelines.'
      ]
    },
    {
      title: 'Microsoft Announces $1.5 Billion Investment in UAE AI Giant G42',
      description: 'Microsoft Corp. is investing $1.5 billion in Abu Dhabi-based AI technology firm G42 to expand global access to AI and cloud infrastructure, under an agreement audited by the U.S. government.',
      url: 'https://www.bloomberg.com/news/articles/2026-04-18/microsoft-invests-1-5b-in-uae-ai-firm-g42',
      published_at: '2026-04-18T07:30:00Z',
      source: 'Bloomberg',
      is_investment: true,
      funding_type: 'private',
      investment_amount_usd: 1500000000,
      recipients: [
        { name: 'G42', is_public: false }
      ],
      source_or_funder: 'Microsoft',
      sector: 'AI Infrastructure',
      summary_bullets: [
        'Microsoft invests $1.5B for a minority stake in G42.',
        'Joint venture to build AI safety and localized cloud infrastructure.',
        'Requires alignment with U.S. national security and export rules.'
      ]
    }
  ];

  try {
    const seedUrls = seeds.map(s => s.url);
    await supabase.from('news_items').delete().in('url', seedUrls);

    const { error } = await supabase.from('news_items').insert(seeds);
    if (error) {
      console.error('Error seeding Supabase database:', error.message);
    } else {
      console.log('Database seeding complete. Pre-loaded 5 historical items (curated types) into Supabase.');
    }
  } catch (err) {
    console.error('Exception during database seeding:', err.message);
  }
};
