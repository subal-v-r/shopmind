import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { SEG_COLORS, TOOLTIP_STYLE, GRID_COLOR, AXIS_COLOR, fmtCurrency } from '../utils/chartConfig';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, Cell, PieChart, Pie, Legend,
} from 'recharts';
import './DashboardPage.css';

const PRIORITY = { premium: 1, loyal: 2, occasional: 3, discount: 4 };

export default function DashboardPage() {
  const [segments, setSegments] = useState(null);
  const [projection, setProjection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.getSegments(), api.getProjection()])
      .then(([segsData, projData]) => {
        const sorted = [...(segsData.segments || [])].sort(
          (a, b) => (PRIORITY[a.id] || 9) - (PRIORITY[b.id] || 9)
        );
        setSegments(sorted);
        setProjection(projData.projections || []);
        setError(null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-wrap"><div className="spinner" /><p>Loading platform data...</p></div>;

  // ── Derived financial metrics (computed from real segment data) ────────
  const totalCustomers = segments?.reduce((s, seg) => s + (seg.size || 0), 0) || 0;
  const totalRevenue = segments?.reduce((s, seg) => s + ((seg.avg_spend || 0) * (seg.size || 0)), 0) || 0;
  const avgSpend = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;
  const avgRating = segments?.length
    ? segments.reduce((s, seg) => s + (seg.avg_rating || 0), 0) / segments.length : 0;

  const spendData = segments?.map(s => ({
    name: s.label.split(' ')[0],
    spend: +(s.avg_spend || 0).toFixed(2),
    color: SEG_COLORS[s.label] || '#7c89fa',
  })) || [];

  const revenuePieData = segments?.map(s => ({
    name: s.label.split(' ')[0],
    value: +((s.avg_spend || 0) * (s.size || 0)).toFixed(0),
    color: SEG_COLORS[s.label] || '#7c89fa',
  })) || [];

  const priorityRank = { premium: 'High Priority', loyal: 'High Priority', occasional: 'Medium', discount: 'Manage Risk' };
  const riskColor = { 'High Priority': 'badge-blue', 'Medium': 'badge-yellow', 'Manage Risk': 'badge-red' };

  return (
    <div>
      <div className="page-header">
        <h1>Shopper Behavior Intelligence</h1>
        <p>KMeans behavioral segmentation · {totalCustomers.toLocaleString()} customers analyzed</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* KPI Row */}
      <div className="grid-4" style={{ marginBottom: '1.75rem' }}>
        <KpiCard label="Total Customers" value={totalCustomers.toLocaleString()} sub="Across 4 behavioral segments" accent="var(--accent)" />
        <KpiCard label="Est. Total Revenue" value={`$${(totalRevenue / 1000).toFixed(1)}K`} sub="Avg spend × segment size (estimated)" accent="#059669" />
        <KpiCard label="Avg Spend / Order" value={fmtCurrency(avgSpend)} sub="Across all segments" accent="#d97706" />
        <KpiCard label="Avg Review Rating" value={`${avgRating.toFixed(2)} / 5`} sub="Customer satisfaction" accent="#dc2626" />
      </div>

      {/* Segment Cards */}
      <h2 style={{ marginBottom: '1rem' }}>Customer Segments</h2>
      <div className="grid-2" style={{ marginBottom: '1.75rem' }}>
        {segments?.map(seg => {
          const segColor = SEG_COLORS[seg.label] || '#7c89fa';
          const segRevenue = ((seg.avg_spend || 0) * (seg.size || 0));
          const revPct = totalRevenue > 0 ? ((segRevenue / totalRevenue) * 100).toFixed(1) : 0;
          const rank = priorityRank[seg.id] || 'Medium';
          return (
            <Link key={seg.id} to={`/segment/${seg.id}`} className="seg-card" style={{ '--sc': segColor }}>
              <div className="seg-card-top">
                <div className="seg-card-label">{seg.label}</div>
                <span className={`badge ${riskColor[rank]}`}>{rank}</span>
              </div>
              <div className="seg-card-meta">
                {(seg.size || 0).toLocaleString()} customers · {revPct}% of revenue
              </div>
              <div className="seg-card-metrics">
                <div className="seg-metric"><span>Avg Spend</span><strong>{fmtCurrency(seg.avg_spend)}</strong></div>
                <div className="seg-metric"><span>Rating</span><strong>{seg.avg_rating?.toFixed(2)}</strong></div>
                <div className="seg-metric"><span>Discount %</span><strong>{seg.discount_usage_pct?.toFixed(1)}%</strong></div>
                <div className="seg-metric"><span>Top Cat.</span><strong>{seg.top_category}</strong></div>
              </div>
              <div className="seg-card-footer">View segment →</div>
            </Link>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid-2" style={{ marginBottom: '1.75rem' }}>
        <div className="card">
          <h3 style={{ marginBottom: '1.2rem' }}>Average Spend by Segment</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={spendData} barSize={44}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis dataKey="name" stroke={AXIS_COLOR} tick={{ fontSize: 12 }} />
              <YAxis stroke={AXIS_COLOR} tick={{ fontSize: 12 }} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => [`$${v.toFixed(2)}`, 'Avg Spend']} />
              <Bar dataKey="spend" radius={[6, 6, 0, 0]}>
                {spendData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '1.2rem' }}>Revenue Contribution by Segment</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={revenuePieData} dataKey="value" nameKey="name"
                cx="50%" cy="50%" innerRadius={58} outerRadius={90} paddingAngle={3}
              >
                {revenuePieData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => [`$${(v / 1000).toFixed(1)}K`, 'Est. Revenue']} />
              <Legend iconType="circle" formatter={(name) => <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{name}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* PCA Projection */}
      {projection?.length > 0 && (
        <div className="card" style={{ marginBottom: '1.75rem' }}>
          <div className="chart-header">
            <h3>Segment Cluster Projection (PCA 2D)</h3>
            <span className="chart-note">Principal Component Analysis — PC1: spending/frequency, PC2: discount/loyalty axes</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis dataKey="x" type="number" name="PC1" stroke={AXIS_COLOR} tick={{ fontSize: 11 }} label={{ value: 'PC1 (Spend · Frequency)', position: 'insideBottomRight', fill: AXIS_COLOR, fontSize: 11, dy: 12 }} />
              <YAxis dataKey="y" type="number" name="PC2" stroke={AXIS_COLOR} tick={{ fontSize: 11 }} label={{ value: 'PC2 (Discount · Loyalty)', angle: -90, position: 'insideLeft', fill: AXIS_COLOR, fontSize: 11 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(_, p) => p?.[0]?.payload?.label || ''} formatter={(v, n) => [v?.toFixed(3), n]} />
              <Scatter data={projection} shape="circle">
                {projection.map((p, i) => <Cell key={i} fill={p.color} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <div className="scatter-legend">
            {projection.map((p, i) => (
              <span key={i} className="legend-item">
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.color, display: 'inline-block', flexShrink: 0 }} />
                {p.label}
              </span>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

function KpiCard({ label, value, sub, accent }) {
  return (
    <div className="kpi-card" style={{ '--ac': accent }}>
      <div className="kpi-accent" />
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function MetricItem({ label, value, note }) {
  return (
    <div className="metric-item">
      <div className="metric-value">{value ?? '—'}</div>
      <div className="metric-label">{label}</div>
      <div className="metric-note">{note}</div>
    </div>
  );
}
