

// Helper to render a beautiful micro sparkline SVG for index trends
const renderSparkline = (prices, isPositive) => {
  if (!prices || prices.length < 2) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min === 0 ? 1 : max - min;
  const width = 60;
  const height = 16;
  const points = prices.map((price, idx) => {
    const x = (idx / (prices.length - 1)) * width;
    const y = height - ((price - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  const strokeColor = isPositive ? 'hsl(var(--accent-green))' : 'hsl(var(--accent-red))';
  const fillGradient = isPositive ? 'url(#greenSparklineGrad)' : 'url(#redSparklineGrad)';

  const firstPoint = `0,${height}`;
  const lastPoint = `${width},${height}`;
  const areaPoints = `${firstPoint} ${points} ${lastPoint}`;

  return (
    <svg width={width} height={height} style={{ overflow: 'visible', margin: '0 4px 0 8px', flexShrink: 0 }}>
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        points={points}
      />
      <polygon
        fill={fillGradient}
        points={areaPoints}
      />
    </svg>
  );
};

export default function MarketBar({ marketData, tickFlashes }) {
  if (!marketData) return null;

  return (
    <div className={`glass-panel market-status-bar status-${marketData.status.toLowerCase()}`} style={{ marginBottom: '24px' }}>
      {/* Global SVG Definitions for Sparkline Gradients */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <linearGradient id="greenSparklineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent-green))" stopOpacity="0.25" />
            <stop offset="100%" stopColor="hsl(var(--accent-green))" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="redSparklineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent-red))" stopOpacity="0.25" />
            <stop offset="100%" stopColor="hsl(var(--accent-red))" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      <div className="market-status-time-group">
        <div className="market-date-string">{marketData.dateEstString}</div>
        <div className="market-status-badge-container">
          <span className={`market-status-dot ${marketData.status.toLowerCase()}`} />
          <span className="market-status-label">{marketData.label}</span>
          <span className="market-time-est">({marketData.timeEstString})</span>
        </div>
        {marketData.detailMessage && (
          <div className="market-status-details">{marketData.detailMessage}</div>
        )}
      </div>
      <div className="market-indices-group">
        {marketData.indices.map((idx) => {
          const isPositive = idx.change >= 0;
          const changeSymbol = isPositive ? '+' : '';
          const flash = tickFlashes[idx.symbol];
          return (
            <div key={idx.symbol} className={`market-index-card ${flash ? `flash-${flash}` : ''}`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span className="market-index-name" style={{ lineHeight: 1 }}>{idx.name}</span>
                <span className="market-index-price" style={{ lineHeight: 1 }}>
                  ${idx.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              {renderSparkline(idx.history, isPositive)}
              <span className={`market-index-change ${isPositive ? 'positive' : 'negative'}`} style={{ alignSelf: 'center', display: 'flex', alignItems: 'center', gap: '3px' }}>
                <span className="trend-arrow">{isPositive ? '▲' : '▼'}</span>
                <span>{changeSymbol}{idx.percentChange.toFixed(2)}%</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
