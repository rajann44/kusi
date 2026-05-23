import { get } from './database.js';
import { classifyNews } from './gemini.js';

// Predefined historical news test cases (Positive & Negative controls)
const TEST_CASES = [
  {
    id: 1,
    name: 'Yesterday\'s Quantum Grants (Positive)',
    title: 'Trump Administration Reaches Agreements for Over $2B in Quantum Computing Grants',
    description: 'Under the CHIPS and Science Act, the U.S. Department of Commerce has agreed to provide over $2 billion in federal funding to nine quantum computing companies, including a $1B grant to IBM for a wafer foundry, $375M to GlobalFoundries, and around $100M each to Rigetti, D-Wave, and others in exchange for minority equity stakes.',
    expected: {
      is_investment: true,
      min_amount: 2000000000,
      sector: 'Quantum'
    }
  },
  {
    id: 2,
    name: 'Nvidia Earnings Beat (Negative)',
    title: 'Nvidia Q1 Earnings Beat Expectations, Shares Surge 8% in After-Hours Trading',
    description: 'Nvidia reported stellar Q1 earnings with revenues up 260% year-over-year, driven by intense demand for H100 AI chips. The company announced a 10-for-1 stock split and increased its dividend by 150%.',
    expected: {
      is_investment: false
    }
  },
  {
    id: 3,
    name: 'Anthropic Venture Investment (Positive)',
    title: 'AI Safety Startup Anthropic Secures $4 Billion Commitment from Amazon',
    description: 'Anthropic has finalized a major venture deal with Amazon, which is investing an additional $4 billion in cash for a minority position, bringing its total investment to $8 billion. Anthropic will use AWS as its primary cloud provider.',
    expected: {
      is_investment: true,
      min_amount: 4000000000,
      sector: 'AI'
    }
  },
  {
    id: 4,
    name: 'Board Appointment (Negative)',
    title: 'OpenAI Appoints Former NSA Director Paul Nakasone to its Board of Directors',
    description: 'OpenAI announced that retired U.S. Army General Paul Nakasone, former head of the National Security Agency (NSA), has joined its board. He will focus on safety, security, and cybersecurity governance.',
    expected: {
      is_investment: false
    }
  },
  {
    id: 5,
    name: 'DOE Lithium Plant Grant (Positive)',
    title: 'DOE Awards $150 Million to Albemarle for North Carolina Lithium Plant',
    description: 'The U.S. Department of Energy announced a $150 million award to Albemarle Corp. to build a commercial-scale lithium processing plant in Kings Mountain, NC, aimed at boosting domestic EV battery manufacturing.',
    expected: {
      is_investment: true,
      min_amount: 150000000,
      sector: 'Energy'
    }
  },
  {
    id: 6,
    name: 'Product Hardware Launch (Negative)',
    title: 'Apple Unveils M4 iPad Pro with Ultra Retina XDR Tandem OLED Display',
    description: 'At its \'Let Loose\' hardware event, Apple announced new iPad Pro models powered by the M4 chip, featuring a thin design, tandem OLED screen, and advanced AI processing capabilities.',
    expected: {
      is_investment: false
    }
  }
];

async function runBacktest() {
  let apiKey = process.argv[2];

  // Try to load from database if not passed as CLI argument
  if (!apiKey) {
    try {
      const row = await get("SELECT value FROM settings WHERE key = 'gemini_api_key'");
      if (row && row.value) {
        apiKey = row.value;
        console.log('Loaded Gemini API Key from SQLite database settings.');
      }
    } catch (e) {
      // db might not be initialized
    }
  }

  if (!apiKey) {
    console.error('\n❌ ERROR: Gemini API Key is required.');
    console.error('Please run with: node backtest.js <your_api_key>');
    process.exit(1);
  }

  console.log('\n======================================================');
  console.log('🧪   INVESTALERT CLASSIFIER BACKTEST SUITE   🧪');
  console.log('======================================================\n');
  console.log(`Running ${TEST_CASES.length} historical scenarios...\n`);

  let passed = 0;
  let failed = 0;

  for (const tc of TEST_CASES) {
    console.log(`[Case #${tc.id}] Testing: "${tc.name}"`);
    console.log(`Headline: "${tc.title}"`);
    
    const result = await classifyNews(tc.title, tc.description, apiKey);
    
    // Evaluate correctness
    const expectedIsInv = tc.expected.is_investment;
    const actualIsInv = !!result.is_investment;
    
    let isCorrect = true;
    let detailMsg = '';

    if (expectedIsInv !== actualIsInv) {
      isCorrect = false;
      detailMsg = `Expected is_investment to be ${expectedIsInv}, got ${actualIsInv}`;
    } else if (expectedIsInv) {
      // Check if amount was parsed correctly
      const expectedMin = tc.expected.min_amount;
      const actualAmt = result.investment_amount_usd || 0;
      
      if (actualAmt < expectedMin) {
        isCorrect = false;
        detailMsg = `Expected amount >= $${expectedMin.toLocaleString()}, got $${actualAmt.toLocaleString()}`;
      } else {
        detailMsg = `Parsed Amount: $${(actualAmt / 1e6).toFixed(1)}M | Sector: ${result.sector || 'N/A'} | Recipients: ${result.recipients?.join(', ') || 'N/A'}`;
      }
    } else {
      detailMsg = 'Successfully filtered out as financial noise.';
    }

    if (isCorrect) {
      console.log(`🟢 PASS: ${detailMsg}\n`);
      passed++;
    } else {
      console.log(`🔴 FAIL: ${detailMsg}`);
      console.log(`Response received:`, JSON.stringify(result, null, 2), `\n`);
      failed++;
    }
  }

  console.log('======================================================');
  console.log('📊                  BACKTEST RESULTS                 ');
  console.log('======================================================');
  console.log(`Total Cases: ${TEST_CASES.length}`);
  console.log(`Passed:      🟢 ${passed}`);
  console.log(`Failed:      🔴 ${failed}`);
  console.log(`Accuracy:    ${((passed / TEST_CASES.length) * 100).toFixed(1)}%`);
  console.log('======================================================\n');
}

runBacktest().catch(err => {
  console.error('Fatal backtest error:', err);
});
