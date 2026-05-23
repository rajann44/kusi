import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Classifies a news article using Gemini AI to check if it's an investment or grant,
 * and extracts structured information.
 * 
 * @param {string} title - The news headline
 * @param {string} description - The news description or body snippet
 * @param {string} apiKey - The user's Google Gemini API key
 * @returns {Promise<object>} Parsed classification details
 */
export async function classifyNews(title, description, apiKey) {
  if (!apiKey) {
    console.warn('Gemini API key is missing. Skipping AI classification.');
    return { is_investment: false };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // We use gemini-1.5-flash for speed and structured JSON support
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        responseMimeType: 'application/json'
      }
    });

    const prompt = `
      You are an expert financial analyst. Analyze the following news headline and summary to determine if it represents a significant business investment, corporate funding round, venture capital investment, corporate partnership contract, or government grant award.

      Title: "${title}"
      Summary: "${description || 'No description available.'}"

      Rule for determining if it is an investment/grant (is_investment = true):
      - There must be a clear transfer of capital, a grant, an equity stake purchase, a venture capital funding round, a joint venture commitment, or a major government subsidy.
      - General stock price movement, earnings reports, executive appointments, or technical product releases do NOT qualify unless they explicitly announce a new funding round or grant.

      Return a JSON object matching this schema:
      {
        "is_investment": boolean,
        "investment_amount_usd": number (the total amount of the investment/grant in USD. For example, $2 Billion is 2000000000. $100 Million is 100000000. If the exact amount is unknown, return 0),
        "recipients": [
          {
            "name": "string" (the name of the company, organization, or research team receiving the funding/grants),
            "is_public": boolean (true if the entity is a publicly listed/traded company on a public stock exchange, false otherwise. Use your internal knowledge to determine if they are listed),
            "ticker": "string" (the stock ticker symbol if public, e.g. "IBM", "GFS", "RGTI". Omit or return null if not public),
            "exchange": "string" (the stock exchange where they are listed, e.g. "NYSE", "NASDAQ", "OTCPK". Omit or return null if not public)
          }
        ],
        "source_or_funder": "string" (the name of the entity providing the capital, e.g., "U.S. Department of Commerce (CHIPS Act)", "Sequoia Capital", "Microsoft", or "Unknown" if not specified),
        "funding_type": "string" (must be "government" if the capital provider/funder is a government agency, department, state-owned enterprise, public body, or grant program e.g. CHIPS Act, Department of Energy, DoD, DARPA, NIH, European Commission, etc. Otherwise, return "private" for venture capital, corporate investments, private equity, debt facilities, banks, etc.),
        "sector": "string" (a short 1-3 word classification of the field, e.g. "Quantum Computing", "Semiconductors", "Biotech", "Defense Tech", "Clean Energy", "AI"),
        "summary_bullets": ["string"] (maximum of 3 bullet points summarizing the key facts of the investment and what it will be used for)
      }

      Do not include any markdown styling (like \`\`\`json) in your raw response. Return only the JSON object.
    `;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    try {
      const parsedData = JSON.parse(responseText.trim());
      return parsedData;
    } catch (parseErr) {
      console.error('Failed to parse Gemini response as JSON. Raw response:', responseText);
      return { is_investment: false };
    }
  } catch (err) {
    console.error('Error during Gemini news classification:', err.message);
    return { is_investment: false };
  }
}

/**
 * Generates exactly 3 short bullet points summarizing an investment/grant.
 * Used for on-demand AI highlights generation in the UI details modal.
 * 
 * @param {string} title - The news headline
 * @param {string} description - The news description or body snippet
 * @param {string} apiKey - The user's Google Gemini API key
 * @returns {Promise<string[]>} Array of 3 bullet points
 */
export async function generateSummaryBullets(title, description, apiKey) {
  if (!apiKey) {
    console.warn('Gemini API key is missing. Skipping AI highlights generation.');
    return [];
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        responseMimeType: 'application/json'
      }
    });

    const prompt = `
      You are an expert financial analyst. Analyze the following news headline and description about a capital investment, funding round, or grant:

      Title: "${title}"
      Description: "${description || 'No description available.'}"

      Generate exactly 3 short, high-fidelity bullet points summarizing the key facts of this investment/grant. Focus on the recipient, the amount, the funder, and what the capital will be used for. Keep each bullet point under 15 words.

      Return ONLY a JSON array of strings containing exactly 3 bullet points, matching this schema:
      [
        "string",
        "string",
        "string"
      ]

      Do not wrap in markdown code blocks. Return only the JSON array.
    `;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();
    
    try {
      const parsedData = JSON.parse(responseText);
      if (Array.isArray(parsedData)) {
        return parsedData;
      }
      return [];
    } catch (parseErr) {
      console.warn('Failed to parse Gemini response as JSON. Trying fallback cleanup.');
      let cleanText = responseText;
      if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '').trim();
      }
      const parsedData = JSON.parse(cleanText);
      if (Array.isArray(parsedData)) {
        return parsedData;
      }
      return [];
    }
  } catch (err) {
    console.error('Error during Gemini summary bullets generation:', err.message);
    return [];
  }
}

