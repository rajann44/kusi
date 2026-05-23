# Kusi InvestAlert

InvestAlert is a real-time tracking application that monitors U.S. government grants, subsidies, and private venture capital deals. It processes feeds from SEC EDGAR and news sources, classifies financial events using Gemini AI, aggregates analytics, and delivers real-time notifications.

---

## 🚀 Quick Start

### 1. Configure Environment
Create a `.env` file in the root directory:
```env
# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-supabase-service-key

# Port Configuration
PORT=3001
```

### 2. Install Dependencies
```bash
# Install root (backend) dependencies
npm install

# Install frontend dependencies
cd frontend && npm install
```

### 3. Start Development Servers
Run the backend and frontend concurrently:
```bash
# Start backend (from root)
npm run dev

# Start frontend (from frontend/)
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🛠️ Key Scripts

- **`node migrate-recipients.js`**: Migrates the `recipients` field in your database from plain strings to structured public-market objects.
- **`node backfill-grants.js`**: Ingests historical technology-focused grants from USAspending.gov.
- **`node backfill-private.js`**: Ingests historical high-value technology offerings from SEC Form D filings.
- **`node backtest.js <gemini_api_key>`**: Runs classification quality checks against positive and negative control scenarios.
