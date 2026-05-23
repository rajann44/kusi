import React from 'react';

// Self-contained deal flow SVG visualization
const renderDealFlow = (alert) => {
  const funder = alert.source_or_funder || 'Funder';
  const recipients = alert.recipients || [];
  const amountVal = alert.investment_amount_usd;
  const amountStr = amountVal > 0 
    ? amountVal >= 1e9 
      ? `$${(amountVal / 1e9).toFixed(2)}B` 
      : `$${(amountVal / 1e6).toFixed(1)}M`
    : 'Undisclosed';

  if (recipients.length === 0) {
    return (
      <div className="deal-flow-fallback">
        <strong>{funder}</strong> ➔ <span>Undisclosed Recipients</span>
      </div>
    );
  }

  const itemHeight = 60;
  const padding = 20;
  const totalHeight = Math.max(160, recipients.length * itemHeight);
  const svgWidth = 560;

  const funderX = 10;
  const funderY = totalHeight / 2 - 25;
  const funderWidth = 140;
  const funderHeight = 50;

  const recX = 390;
  const recWidth = 160;
  const recHeight = 40;

  const funderOutX = funderX + funderWidth;
  const funderOutY = totalHeight / 2;

  const isGov = alert.funding_type === 'government';
  const strokeFunder = isGov ? 'hsl(var(--accent-blue))' : 'hsl(var(--accent-cyan))';
  const strokeRec = isGov ? 'hsl(var(--accent-blue))' : 'hsl(var(--accent-purple))';
  const strokeAmount = isGov ? 'hsl(var(--accent-gold))' : 'hsl(var(--accent-green))';
  const gradStart = isGov ? 'hsl(var(--accent-gold))' : 'hsl(var(--accent-cyan))';
  const gradEnd = isGov ? 'hsl(var(--accent-blue))' : 'hsl(var(--accent-purple))';

  return (
    <svg className="deal-flow-svg" width="100%" height={totalHeight} viewBox={`0 0 ${svgWidth} ${totalHeight}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="flow-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={gradStart} />
          <stop offset="100%" stopColor={gradEnd} />
        </linearGradient>
        <filter id="glow-effect" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {recipients.map((rec, idx) => {
        const recInX = recX;
        const recInY = idx * itemHeight + padding + recHeight / 2;
        const pathD = `M ${funderOutX} ${funderOutY} C ${(funderOutX + recInX) / 2} ${funderOutY}, ${(funderOutX + recInX) / 2} ${recInY}, ${recInX} ${recInY}`;
        const isObj = typeof rec === 'object' && rec !== null;
        const isPublic = isObj && (rec.is_public === true || rec.is_public === 'true');
        
        return (
          <g key={idx}>
            <path 
              d={pathD} 
              fill="none" 
              stroke="hsl(var(--border-glass))" 
              strokeWidth="2" 
            />
            <path 
              d={pathD} 
              fill="none" 
              stroke="url(#flow-gradient)" 
              strokeWidth="2.5" 
              className={`animated-flow-line ${isPublic ? 'flow-fast' : ''}`}
            />
          </g>
        );
      })}

      <g className="flow-node funder-node">
        <rect 
          x={funderX} 
          y={funderY} 
          width={funderWidth} 
          height={funderHeight} 
          rx="8" 
          fill="hsl(var(--bg-panel))" 
          stroke={strokeFunder} 
          strokeWidth="1.5"
        />
        <text 
          x={funderX + funderWidth / 2} 
          y={funderY + 22} 
          fill="hsl(var(--text-primary))" 
          fontSize="12" 
          fontWeight="bold" 
          textAnchor="middle"
        >
          {funder.length > 20 ? funder.slice(0, 18) + '...' : funder}
        </text>
        <text 
          x={funderX + funderWidth / 2} 
          y={funderY + 38} 
          fill="hsl(var(--text-muted))" 
          fontSize="9" 
          textAnchor="middle"
        >
          CAPITAL PROVIDER
        </text>
      </g>

      <g className="flow-amount-badge">
        <rect 
          x={funderOutX + 15} 
          y={funderOutY - 12} 
          width={85} 
          height={24} 
          rx="12" 
          fill="hsl(var(--bg-panel))" 
          stroke={strokeAmount} 
          strokeWidth="1.5"
        />
        <text 
          x={funderOutX + 57.5} 
          y={funderOutY + 4} 
          fill={strokeAmount} 
          fontSize="10" 
          fontWeight="bold" 
          textAnchor="middle"
        >
          {amountStr}
        </text>
      </g>

      {recipients.map((rec, idx) => {
        const rY = idx * itemHeight + padding;
        const isObj = typeof rec === 'object' && rec !== null;
        const name = isObj ? rec.name : rec;
        const isPublic = isObj && (rec.is_public === true || rec.is_public === 'true');
        const ticker = isObj ? rec.ticker : null;
        const exchange = isObj ? rec.exchange : null;

        return (
          <g key={idx} className="flow-node recipient-node">
            <rect 
              x={recX} 
              y={rY} 
              width={recWidth} 
              height={recHeight} 
              rx="6" 
              fill="hsl(var(--bg-panel))" 
              stroke={isPublic ? 'hsl(var(--accent-gold))' : strokeRec} 
              strokeWidth={isPublic ? 2 : 1.5}
              className={isPublic ? 'public-node-rect' : ''}
            />
            {isPublic && ticker ? (
              <>
                <text 
                  x={recX + recWidth / 2} 
                  y={rY + 18} 
                  fill="hsl(var(--text-primary))" 
                  fontSize="11" 
                  fontWeight="700" 
                  textAnchor="middle"
                >
                  {name.length > 20 ? name.slice(0, 18) + '...' : name}
                </text>
                <text 
                  x={recX + recWidth / 2} 
                  y={rY + 30} 
                  fill="hsl(var(--accent-gold))" 
                  fontSize="9" 
                  fontWeight="bold" 
                  textAnchor="middle"
                >
                  📈 {exchange ? `${exchange}: ` : ''}{ticker}
                </text>
              </>
            ) : (
              <text 
                x={recX + recWidth / 2} 
                y={rY + 24} 
                fill="hsl(var(--text-primary))" 
                fontSize="11" 
                fontWeight="600" 
                textAnchor="middle"
              >
                {name.length > 22 ? name.slice(0, 20) + '...' : name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

export default function DetailModal({ alert, onClose, isGeneratingBullets }) {
  const [copied, setCopied] = React.useState(false);

  if (!alert) return null;

  const handleCopySummary = () => {
    if (!alert) return;
    
    let textToCopy = `Title: ${alert.title}\n`;
    textToCopy += `Date: ${new Date(alert.published_at).toLocaleString()}\n`;
    textToCopy += `Amount: ${alert.investment_amount_usd > 0 ? '$' + alert.investment_amount_usd.toLocaleString() : 'Undisclosed'}\n`;
    textToCopy += `Sector: ${alert.sector || 'General'}\n`;
    textToCopy += `Funder: ${alert.source_or_funder || 'Unknown'}\n`;
    
    if (alert.summary_bullets && alert.summary_bullets.length > 0) {
      textToCopy += `\nKey Insights:\n`;
      alert.summary_bullets.forEach(b => textToCopy += `- ${b}\n`);
    } else {
      textToCopy += `\nDescription: ${alert.description}\n`;
    }
    
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal-container glass-panel" 
        style={{
          borderColor: alert.funding_type === 'government' ? 'hsl(var(--accent-blue))' : 'hsl(var(--accent-green))',
          boxShadow: alert.funding_type === 'government' 
            ? '0 20px 50px rgba(0, 0, 0, 0.6), var(--glow-blue)' 
            : '0 20px 50px rgba(0, 0, 0, 0.6), var(--glow-green)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close-btn" onClick={onClose}>✕</button>
        
        <div className="modal-header-info">
          <div style={{ display: 'flex', gap: '8px' }}>
            <span className="badge badge-purple" style={{ textTransform: 'uppercase' }}>{alert.sector || 'General'}</span>
            {alert.funding_type === 'government' ? (
              <span className="badge badge-blue">🏛️ Government</span>
            ) : (
              <span className="badge badge-green">💼 Private</span>
            )}
          </div>
          <span className="modal-date">{new Date(alert.published_at).toLocaleString()}</span>
        </div>

        <h2 className="modal-title">{alert.title}</h2>
        
        <div className="modal-meta-grid">
          <div className="meta-box">
            <span className="meta-label">Capital Transferred</span>
            <span className="meta-value" style={{ color: alert.funding_type === 'government' ? 'hsl(var(--accent-gold))' : 'hsl(var(--accent-green))', fontWeight: '700' }}>
              {alert.investment_amount_usd > 0 
                ? `$${(alert.investment_amount_usd).toLocaleString()} USD` 
                : 'Undisclosed'}
            </span>
          </div>
          <div className="meta-box">
            <span className="meta-label">Funder / Source</span>
            <span className="meta-value">{alert.source_or_funder || 'Unknown'}</span>
          </div>
          <div className="meta-box">
            <span className="meta-label">Source Feed</span>
            <span className="meta-value">{alert.source || 'N/A'}</span>
          </div>
        </div>

        {/* Animated Deal Flow Visualization */}
        <div className="deal-flow-section">
          <h4>Capital Flow Pipeline</h4>
          <div className="deal-flow-visualizer">
            {renderDealFlow(alert)}
          </div>
        </div>

        <div className="modal-body-content">
          <h4>About the Announcement</h4>
          <p className="modal-description">{alert.description}</p>
          
          {isGeneratingBullets ? (
            <div style={{ marginTop: '20px' }} className="bullets-loading-skeleton">
              <h4 style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="sparkle-icon">✨</span> Generating Key AI Insights...
              </h4>
              <ul className="bullet-points skeleton-bullets">
                <li className="skeleton-bullet-line"></li>
                <li className="skeleton-bullet-line"></li>
                <li className="skeleton-bullet-line"></li>
              </ul>
            </div>
          ) : alert.summary_bullets && alert.summary_bullets.length > 0 ? (
            <div style={{ marginTop: '20px' }}>
              <h4 style={{ marginBottom: '10px' }}>Key AI Insights</h4>
              <ul className="bullet-points">
                {alert.summary_bullets.map((bullet, idx) => (
                  <li key={idx}>{bullet}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="modal-footer-action" style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
          <button 
            className="glass-btn glass-btn-secondary" 
            style={{ flex: 1 }}
            onClick={handleCopySummary}
          >
            {copied ? '✅ Copied!' : '📋 Copy Summary'}
          </button>
          <a 
            href={alert.url} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="glass-btn"
            style={{ flex: 2, textAlign: 'center', textDecoration: 'none' }}
          >
            🔗 Open Original Announcement
          </a>
        </div>
      </div>
    </div>
  );
}
