import { useState } from 'react';

const formatAmount = (val) => {
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toLocaleString()}`;
};

export default function AnalyticsChart({ trends }) {
  const [hoveredTrendPoint, setHoveredTrendPoint] = useState(null);
  const [showGov, setShowGov] = useState(true);
  const [showPrivate, setShowPrivate] = useState(true);
  const [timeline, setTimeline] = useState('all');

  if (!trends || trends.length === 0) {
    return (
      <div className="glass-panel" style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'hsl(var(--text-muted))' }}>
        <span>📊 Loading analytics data...</span>
      </div>
    );
  }

  // SVG Quarterly Trend Chart math & dimensions
  const paddingLeft = 55;
  const paddingRight = 15;
  const paddingTop = 20;
  const paddingBottom = 30;
  const chartWidth = 500 - paddingLeft - paddingRight; // 430
  const chartHeight = 240 - paddingTop - paddingBottom; // 190
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  const displayTrends = timeline === '1y' ? trends.slice(-4) : trends;

  const maxTrendAmount = Math.max(
    ...displayTrends.map(t => Math.max(showGov ? (t.governmentAmount || 0) : 0, showPrivate ? (t.privateAmount || 0) : 0)), 
    1e9
  );

  const pointsGov = showGov ? displayTrends.map((item, idx) => {
    const x = displayTrends.length > 1 
      ? paddingLeft + (idx / (displayTrends.length - 1)) * chartWidth 
      : paddingLeft + chartWidth / 2;
    const y = paddingTop + chartHeight - ((item.governmentAmount || 0) / maxTrendAmount) * chartHeight;
    return { x, y, item };
  }) : [];

  const pointsPrivate = showPrivate ? displayTrends.map((item, idx) => {
    const x = displayTrends.length > 1 
      ? paddingLeft + (idx / (displayTrends.length - 1)) * chartWidth 
      : paddingLeft + chartWidth / 2;
    const y = paddingTop + chartHeight - ((item.privateAmount || 0) / maxTrendAmount) * chartHeight;
    return { x, y, item };
  }) : [];

  const linePathGov = pointsGov.length > 0 ? pointsGov.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') : '';
  const areaPathGov = pointsGov.length > 0 ? `${linePathGov} L ${pointsGov[pointsGov.length - 1].x} ${paddingTop + chartHeight} L ${pointsGov[0].x} ${paddingTop + chartHeight} Z` : '';

  const linePathPrivate = pointsPrivate.length > 0 ? pointsPrivate.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') : '';
  const areaPathPrivate = pointsPrivate.length > 0 ? `${linePathPrivate} L ${pointsPrivate[pointsPrivate.length - 1].x} ${paddingTop + chartHeight} L ${pointsPrivate[0].x} ${paddingTop + chartHeight} Z` : '';

  const handleChartMouseMove = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    
    // Translate mouse position to SVG coordinates (0 to 500, 0 to 240)
    const svgX = (mouseX / rect.width) * 500;
    
    let closestIdx = 0;
    let minDiff = Infinity;
    
    displayTrends.forEach((item, idx) => {
      const x = displayTrends.length > 1 
        ? paddingLeft + (idx / (displayTrends.length - 1)) * chartWidth 
        : paddingLeft + chartWidth / 2;
      const diff = Math.abs(x - svgX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });

    const closestItem = displayTrends[closestIdx];
    const x = displayTrends.length > 1 
      ? paddingLeft + (closestIdx / (displayTrends.length - 1)) * chartWidth 
      : paddingLeft + chartWidth / 2;
    
    setHoveredTrendPoint({
      item: closestItem,
      x: e.clientX,
      y: e.clientY,
      svgX: x,
      idx: closestIdx
    });
  };

  const handleChartMouseLeave = () => {
    setHoveredTrendPoint(null);
  };

  return (
    <div style={{ position: 'relative' }}>
      <div className="chart-controls-wrapper">
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            type="button" 
            className="glass-btn glass-btn-secondary" 
            style={{ padding: '0 12px', height: '36px', fontSize: '12px', opacity: timeline === '1y' ? 1 : 0.6 }}
            onClick={() => setTimeline('1y')}
          >
            1 Year
          </button>
          <button 
            type="button" 
            className="glass-btn glass-btn-secondary" 
            style={{ padding: '0 12px', height: '36px', fontSize: '12px', opacity: timeline === 'all' ? 1 : 0.6 }}
            onClick={() => setTimeline('all')}
          >
            All-Time
          </button>
        </div>
        <div style={{ display: 'flex', gap: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', opacity: showGov ? 1 : 0.6, padding: '8px 4px' }}>
            <input type="checkbox" checked={showGov} onChange={() => setShowGov(!showGov)} style={{ accentColor: 'hsl(var(--accent-blue))', width: '18px', height: '18px', cursor: 'pointer' }} />
            <span style={{ color: 'hsl(var(--accent-blue))', fontWeight: '600' }}>Gov Grants</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', opacity: showPrivate ? 1 : 0.6, padding: '8px 4px' }}>
            <input type="checkbox" checked={showPrivate} onChange={() => setShowPrivate(!showPrivate)} style={{ accentColor: 'hsl(var(--accent-green))', width: '18px', height: '18px', cursor: 'pointer' }} />
            <span style={{ color: 'hsl(var(--accent-green))', fontWeight: '600' }}>Private VC</span>
          </label>
        </div>
      </div>
      <svg 
        width="100%" 
        viewBox="0 0 500 240" 
        style={{ overflow: 'visible', cursor: 'crosshair', height: 'auto' }}
        onMouseMove={handleChartMouseMove}
        onMouseLeave={handleChartMouseLeave}
      >
        <defs>
          <linearGradient id="govAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent-blue))" stopOpacity="0.15" />
            <stop offset="100%" stopColor="hsl(var(--accent-blue))" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="privateAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent-green))" stopOpacity="0.15" />
            <stop offset="100%" stopColor="hsl(var(--accent-green))" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y Axis gridlines and values */}
        {gridLines.map((ratio, idx) => {
          const yVal = paddingTop + chartHeight - ratio * chartHeight;
          const labelVal = ratio * maxTrendAmount;
          let labelText = '0';
          if (labelVal >= 1e9) {
            labelText = `$${(labelVal / 1e9).toFixed(1)}B`;
          } else if (labelVal >= 1e6) {
            labelText = `$${(labelVal / 1e6).toFixed(0)}M`;
          } else if (labelVal > 0) {
            labelText = `$${(labelVal / 1e3).toFixed(0)}K`;
          }

          return (
            <g key={idx}>
              <line 
                x1={paddingLeft} 
                y1={yVal} 
                x2={paddingLeft + chartWidth} 
                y2={yVal} 
                stroke="hsl(var(--border-light))" 
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.3"
              />
              <text 
                x={paddingLeft - 8} 
                y={yVal + 3} 
                fill="hsl(var(--text-muted))" 
                fontSize="8" 
                textAnchor="end"
                opacity="0.8"
              >
                {labelText}
              </text>
            </g>
          );
        })}

        {/* X Axis vertical lines and labels */}
        {displayTrends.map((t, idx) => {
          if (displayTrends.length > 8 && idx % 2 !== 0) return null;
          const x = displayTrends.length > 1 
            ? paddingLeft + (idx / (displayTrends.length - 1)) * chartWidth 
            : paddingLeft + chartWidth / 2;
          return (
            <text 
              key={idx}
              x={x} 
              y={paddingTop + chartHeight + 18} 
              fill="hsl(var(--text-muted))" 
              fontSize="9" 
              textAnchor="middle"
              opacity="0.7"
            >
              {t.quarter}
            </text>
          );
        })}

        {/* Gov Area & Line */}
        {areaPathGov && (
          <path d={areaPathGov} fill="url(#govAreaGrad)" className="trend-area" />
        )}
        {linePathGov && (
          <path 
            d={linePathGov} 
            fill="none" 
            stroke="hsl(var(--accent-blue))" 
            strokeWidth="2.5" 
            className="trend-line" 
          />
        )}

        {/* Private Area & Line */}
        {areaPathPrivate && (
          <path d={areaPathPrivate} fill="url(#privateAreaGrad)" className="trend-area" />
        )}
        {linePathPrivate && (
          <path 
            d={linePathPrivate} 
            fill="none" 
            stroke="hsl(var(--accent-green))" 
            strokeWidth="2.5" 
            className="trend-line" 
          />
        )}

        {/* Vertical Hover Guideline */}
        {hoveredTrendPoint && (
          <line 
            x1={hoveredTrendPoint.svgX} 
            y1={paddingTop} 
            x2={hoveredTrendPoint.svgX} 
            y2={paddingTop + chartHeight} 
            stroke="hsl(var(--accent-cyan))" 
            strokeWidth="1.5" 
            strokeDasharray="2 2"
            opacity="0.8"
          />
        )}

        {/* interactive circles for Gov data points */}
        {pointsGov.map((p, idx) => {
          const isHovered = hoveredTrendPoint && hoveredTrendPoint.idx === idx;
          return (
            <circle 
              key={idx}
              cx={p.x}
              cy={p.y}
              r={isHovered ? 6 : 4}
              fill="hsl(var(--bg-panel))"
              stroke="hsl(var(--accent-blue))"
              strokeWidth={isHovered ? 3 : 2}
              className="trend-dot"
            />
          );
        })}

        {/* interactive circles for Private data points */}
        {pointsPrivate.map((p, idx) => {
          const isHovered = hoveredTrendPoint && hoveredTrendPoint.idx === idx;
          return (
            <circle 
              key={idx}
              cx={p.x}
              cy={p.y}
              r={isHovered ? 6 : 4}
              fill="hsl(var(--bg-panel))"
              stroke="hsl(var(--accent-green))"
              strokeWidth={isHovered ? 3 : 2}
              className="trend-dot"
            />
          );
        })}
      </svg>

      {/* Floating neon tooltip */}
      {hoveredTrendPoint && (
        <div 
          className="glass-panel floating-chart-tooltip" 
          style={{
            position: 'fixed',
            left: `${hoveredTrendPoint.x + 15}px`,
            top: `${hoveredTrendPoint.y - 85}px`,
            pointerEvents: 'none',
            zIndex: 1000,
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '12px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), var(--glow-cyan)'
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: '6px', color: 'hsl(var(--text-primary))' }}>
            📆 {hoveredTrendPoint.item.quarter} Summary
          </div>
          {showGov && (
            <div className="tooltip-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span className="tooltip-indicator gov-dot"></span>
              <span className="tooltip-label">Gov Grants:</span>
              <span className="tooltip-val">{formatAmount(hoveredTrendPoint.item.governmentAmount)}</span>
              <span className="tooltip-count">({hoveredTrendPoint.item.governmentCount})</span>
            </div>
          )}
          {showPrivate && (
            <div className="tooltip-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="tooltip-indicator private-dot"></span>
              <span className="tooltip-label">Private VC:</span>
              <span className="tooltip-val">{formatAmount(hoveredTrendPoint.item.privateAmount)}</span>
              <span className="tooltip-count">({hoveredTrendPoint.item.privateCount})</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
