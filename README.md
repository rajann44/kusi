# Kusi

Kusi is a real-time tracking application that monitors U.S. government grants, subsidies, and private venture capital deals. It processes feeds from SEC EDGAR and news sources, classifies financial events using Gemini AI, aggregates analytics, and delivers real-time notifications.

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

---

## 🌍 Deployment & Architecture

This application uses a decoupled frontend/backend architecture designed for real-time updates and seamless scaling.

### Core Services

- **Backend Server (Render)**:
  - Deployed as a web service on [Render](https://render.com/).
  - **Responsibilities**: Runs the Node.js/Express API, handles SSE (Server-Sent Events) for real-time frontend updates, executes the long-running background polling loop (`poller.js`), and securely manages all API keys (Gemini, Finnhub).

- **Frontend Application (Vercel)**:
  - Deployed as a static SPA on [Vercel](https://vercel.com/).
  - **Responsibilities**: Serves the React + Vite frontend application. It connects to the Render backend API using the `VITE_API_BASE_URL` environment variable.

- **Database (Supabase)**:
  - Hosted on [Supabase](https://supabase.com/) (PostgreSQL).
  - **Responsibilities**: Persists historical deals, tracks poller state, and handles data caching. The backend uses a Supabase Service Role Key to bypass Row-Level Security (RLS) for seamless background data ingestion.

### Third-Party APIs

- **Gemini AI**: Used on the backend for natural language processing. Extracts structured metadata (sectors, amounts) from raw SEC XML and USAspending descriptions, and generates smart bullet-point summaries.
- **Finnhub**: Used by the background poller to fetch real-time corporate news and market index data.
- **SEC EDGAR**: Public RSS feed used to discover new Form D (Venture Capital) filings.
- **USAspending.gov API**: Public API used to track large-scale U.S. federal technology grants and subsidies.
