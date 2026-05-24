import { useState, useEffect } from 'react';
import { API_BASE } from '../config';


export default function CompanyDrawer({ companyName, isOpen, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && companyName) {
      setLoading(true);
      fetch(`${API_BASE}/api/companies/${encodeURIComponent(companyName)}/history`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            setHistory(data);
          } else {
            console.error('Expected array from history API but got:', data);
            setHistory([]);
          }
          setLoading(false);
        })
        .catch(err => {
          console.error(err);
          setLoading(false);
        });
    }
  }, [isOpen, companyName]);

  if (!isOpen) return null;

  const totalFunding = history.reduce((sum, item) => sum + (item.investment_amount_usd || 0), 0);
  const govFunding = history.filter(h => h.funding_type === 'government').reduce((sum, item) => sum + (item.investment_amount_usd || 0), 0);
  const privateFunding = totalFunding - govFunding;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className={`company-drawer glass-panel ${isOpen ? 'open' : ''}`}>
        <button className="drawer-close-btn" onClick={onClose}>✕</button>
        
        <div className="drawer-header">
          <h2>🏢 {companyName}</h2>
          <p className="drawer-subtitle">Lifetime Funding History</p>
        </div>

        <div className="drawer-stats">
          <div className="stat-box">
            <span className="stat-label">Total Funding Raised</span>
            <span className="stat-value">
              {loading ? (
                <div className="skeleton-bullet-line" style={{ width: '120px', height: '28px', marginTop: '4px', marginBottom: 0 }}></div>
              ) : totalFunding > 0 ? `$${(totalFunding / 1e6).toFixed(1)}M` : 'Undisclosed'}
            </span>
          </div>
          <div className="stat-split">
            {loading ? (
              <>
                <div className="split-item"><div className="skeleton-bullet-line" style={{ width: '80px', height: '14px', margin: 0 }}></div></div>
                <div className="split-item"><div className="skeleton-bullet-line" style={{ width: '80px', height: '14px', margin: 0 }}></div></div>
              </>
            ) : (
              <>
                <div className="split-item">
                  <span className="split-dot gov-dot"></span> Gov: ${ (govFunding / 1e6).toFixed(1) }M
                </div>
                <div className="split-item">
                  <span className="split-dot private-dot"></span> Private: ${ (privateFunding / 1e6).toFixed(1) }M
                </div>
              </>
            )}
          </div>
        </div>

        <div className="drawer-timeline">
          {loading ? (
            <div className="skeleton-timeline">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="timeline-item">
                  <div className="timeline-marker" style={{ background: 'hsl(var(--border-light))' }}></div>
                  <div className="timeline-content" style={{ width: '100%' }}>
                    <div className="skeleton-bullet-line" style={{ width: '30%', height: '12px', marginBottom: '8px' }}></div>
                    <div className="skeleton-bullet-line" style={{ width: '50%', height: '18px', marginBottom: '8px' }}></div>
                    <div className="skeleton-bullet-line" style={{ width: '80%', height: '14px', marginBottom: '8px' }}></div>
                    <div className="skeleton-bullet-line" style={{ width: '90%', height: '14px' }}></div>
                  </div>
                </div>
              ))}
            </div>
          ) : history.length === 0 ? (
            <p>No historical deals found.</p>
          ) : (
            history.map((item, idx) => (
              <div key={idx} className="timeline-item">
                <div className="timeline-marker" style={{ 
                  background: item.funding_type === 'government' ? 'hsl(var(--accent-blue))' : 'hsl(var(--accent-green))' 
                }}></div>
                <div className="timeline-content">
                  <span className="timeline-date">{new Date(item.published_at).toLocaleDateString()}</span>
                  <span className="timeline-amount">
                    {item.investment_amount_usd > 0 ? `$${(item.investment_amount_usd / 1e6).toFixed(1)}M` : 'Undisclosed'}
                  </span>
                  <div className="timeline-funder">{item.source_or_funder || 'Unknown Funder'}</div>
                  <div className="timeline-title" title={item.title}>
                    {item.title.length > 50 ? item.title.substring(0, 47) + '...' : item.title}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
