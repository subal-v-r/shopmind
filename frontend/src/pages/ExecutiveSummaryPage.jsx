import React, { useEffect, useState, useRef } from 'react';
import { api } from '../utils/api';
import { SEG_COLORS, fmtCurrency, safeNum } from '../utils/chartConfig';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import './ExecutiveSummaryPage.css';

export default function ExecutiveSummaryPage() {
    const [segs, setSegs] = useState(null);
    const [sent, setSent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);
    const [exportMsg, setExportMsg] = useState(null);
    const contentRef = useRef(null);

    useEffect(() => {
        Promise.all([api.getSegments(), api.getSentiment()])
            .then(([s, se]) => {
                setSegs(s.segments || []);
                setSent(se);
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="loading-wrap"><div className="spinner" /><p>Generating executive summary...</p></div>;

    const totalCustomers = segs?.reduce((s, seg) => s + safeNum(seg.size), 0) || 0;
    const totalRevenue = segs?.reduce((s, seg) => s + (safeNum(seg.avg_spend) * safeNum(seg.size)), 0) || 0;
    const topSeg = segs?.[0];
    const atRiskSeg = sent?.per_segment?.find(s => safeNum(s.negative_pct) > 15);
    const avgRating = safeNum(sent?.overall?.avg_rating);

    const insights = [
        {
            title: 'Customer Base Overview',
            body: `${totalCustomers.toLocaleString()} customers in 4 behavioral groups. Estimated revenue: $${(totalRevenue / 1000).toFixed(1)}K (avg spend × segment size).`,
        },
        {
            title: `Highest-Value Segment: ${topSeg?.label || '—'}`,
            body: `${safeNum(topSeg?.size).toLocaleString()} customers · $${safeNum(topSeg?.avg_spend).toFixed(2)} avg spend · ${safeNum(topSeg?.avg_rating).toFixed(2)} rating. Priority #1 for VIP retention.`,
        },
        {
            title: 'Overall Sentiment',
            body: `${safeNum(sent?.overall?.positive_pct).toFixed(1)}% positive across ${safeNum(sent?.overall?.total).toLocaleString()} reviews. Avg rating: ${avgRating.toFixed(2)}/5. ${safeNum(sent?.overall?.negative_pct).toFixed(1)}% negative — monitor churn signals.`,
        },
        {
            title: 'Discount Dependency Risk',
            body: `Discount-Driven Shoppers have ${safeNum(segs?.find(s => s.id === 'discount')?.discount_usage_pct).toFixed(1)}% discount rate with lowest avg spend ($${safeNum(segs?.find(s => s.id === 'discount')?.avg_spend).toFixed(2)}). Over-discounting erodes margins.`,
        },
    ];

    const risks = [
        { title: 'High Churn in Discount Segment', body: `Discount-Driven Shoppers churn without promotions. $${safeNum(segs?.find(s => s.id === 'discount')?.avg_spend).toFixed(2)} avg spend with heavy discount reliance reduces profitability.`, level: 'High' },
        { title: atRiskSeg ? `Negative Sentiment: ${atRiskSeg.segment}` : 'Negative Sentiment Exposure', body: atRiskSeg ? `${atRiskSeg.segment} shows ${safeNum(atRiskSeg.negative_pct).toFixed(1)}% negative reviews. Unaddressed, this converts to churn within 2–3 cycles.` : 'Monitor segments with negative_pct > 15%.', level: 'Medium' },
        { title: 'Revenue Concentration Risk', body: `${topSeg?.label} may drive >30% of total revenue for ${((safeNum(topSeg?.size) / Math.max(totalCustomers, 1)) * 100).toFixed(1)}% of customers — single-point fragility.`, level: 'Medium' },
    ];

    const opps = [
        { title: 'Convert Occasional Buyers', body: `${safeNum(segs?.find(s => s.id === 'occasional')?.size).toLocaleString()} Occasional Buyers have ${safeNum(segs?.find(s => s.id === 'occasional')?.avg_rating).toFixed(2)} rating. Seasonal campaigns can double purchase frequency.` },
        { title: 'Loyalty Program Expansion', body: `${safeNum(segs?.find(s => s.id === 'loyal')?.size).toLocaleString()} Loyal Buyers for referral programs. 10% conversion = ${Math.round(safeNum(segs?.find(s => s.id === 'loyal')?.size) * 0.1)} new acquisitions.` },
        { title: 'Premium Tier Upsell', body: `${safeNum(segs?.find(s => s.id === 'premium')?.size).toLocaleString()} Premium Buyers at $${safeNum(segs?.find(s => s.id === 'premium')?.avg_spend).toFixed(2)} AOV. A 10% CLV lift adds ~$${((safeNum(segs?.find(s => s.id === 'premium')?.size) * safeNum(segs?.find(s => s.id === 'premium')?.avg_spend)) * 0.1).toFixed(0)} estimated revenue.` },
    ];

    const ranked = segs ? [...segs].sort((a, b) => (safeNum(b.avg_spend) * safeNum(b.size)) - (safeNum(a.avg_spend) * safeNum(a.size))) : [];

    const handleExport = async () => {
        if (!contentRef.current) return;
        setExporting(true); setExportMsg(null);
        try {
            // Hide no-print elements
            const noPrints = document.querySelectorAll('.no-print');
            noPrints.forEach(el => { el.dataset.displayBak = el.style.display; el.style.display = 'none'; });

            const canvas = await html2canvas(contentRef.current, {
                scale: 1.5,
                useCORS: true,
                backgroundColor: document.body.classList.contains('dark') ? '#0b0f19' : '#f8fafc',
                scrollY: -window.scrollY,
                windowWidth: contentRef.current.scrollWidth,
                windowHeight: contentRef.current.scrollHeight,
            });

            noPrints.forEach(el => { el.style.display = el.dataset.displayBak || ''; });

            const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
            const A4W = pdf.internal.pageSize.getWidth();
            const A4H = pdf.internal.pageSize.getHeight();
            const margin = 28;
            const imgW = A4W - margin * 2;
            const ratio = canvas.width / imgW;
            const imgH = canvas.height / ratio;
            const totalPages = Math.ceil(imgH / (A4H - margin * 2));

            for (let page = 0; page < totalPages; page++) {
                if (page > 0) pdf.addPage();
                const srcY = page * (A4H - margin * 2) * ratio;
                const sliceH = Math.min((A4H - margin * 2) * ratio, canvas.height - srcY);
                const sliceCanvas = document.createElement('canvas');
                sliceCanvas.width = canvas.width;
                sliceCanvas.height = sliceH;
                const ctx = sliceCanvas.getContext('2d');
                ctx.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
                const imgData = sliceCanvas.toDataURL('image/jpeg', 0.92);
                pdf.addImage(imgData, 'JPEG', margin, margin, imgW, sliceH / ratio);
            }

            pdf.save(`shopmind4-executive-summary-${new Date().toISOString().slice(0, 10)}.pdf`);
            setExportMsg({ type: 'success', text: `PDF saved (${totalPages} page${totalPages > 1 ? 's' : ''})` });
        } catch (err) {
            setExportMsg({ type: 'error', text: `Export failed: ${err.message}` });
        } finally {
            setExporting(false);
        }
    };

    return (
        <div ref={contentRef}>
            <div className="exec-header-row">
                <div className="page-header" style={{ marginBottom: 0 }}>
                    <h1>Executive Summary</h1>
                    <p>Data-driven insights — {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
                <div className="no-print exec-export-group">
                    <button
                        className="btn-primary"
                        style={{ padding: '0.65rem 1.35rem', whiteSpace: 'nowrap' }}
                        onClick={handleExport}
                        disabled={exporting}
                    >
                        {exporting
                            ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Exporting...</>
                            : 'Export PDF'}
                    </button>
                    {exportMsg && (
                        <div className={`export-msg ${exportMsg.type}`}>{exportMsg.text}</div>
                    )}
                </div>
            </div>

            {/* Overview KPIs */}
            <div className="exec-overview-row" style={{ marginTop: '1.5rem', marginBottom: '1.75rem' }}>
                <OverviewCard label="Total Customers" value={totalCustomers.toLocaleString()} />
                <OverviewCard label="Est. Revenue" value={`$${(totalRevenue / 1000).toFixed(1)}K`} note="Estimated" />
                <OverviewCard label="Segments" value="4" />
                <OverviewCard label="Avg Rating" value={`${avgRating.toFixed(2)} / 5`} />
            </div>

            {/* 5 Key Insights */}
            <h2 style={{ marginBottom: '1rem' }}>5 Key Insights</h2>
            <div className="insight-list" style={{ marginBottom: '1.75rem' }}>
                {insights.map((ins, i) => (
                    <div key={i} className="insight-card card">
                        <div className="ins-num">{i + 1}</div>
                        <div className="ins-body">
                            <div className="ins-title">{ins.title}</div>
                            <div className="ins-text">{ins.body}</div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid-2" style={{ marginBottom: '1.75rem' }}>
                {/* Revenue Risks */}
                <div>
                    <h2 style={{ marginBottom: '1rem' }}>Revenue Risks</h2>
                    <div className="risk-list">
                        {risks.map((r, i) => (
                            <div key={i} className={`risk-card card risk-${r.level.toLowerCase()}`}>
                                <div className="risk-header">
                                    <div className="risk-title">{r.title}</div>
                                    <span className={`badge ${r.level === 'High' ? 'badge-red' : 'badge-yellow'}`}>{r.level}</span>
                                </div>
                                <div className="risk-body">{r.body}</div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Growth Opportunities */}
                <div>
                    <h2 style={{ marginBottom: '1rem' }}>Growth Opportunities</h2>
                    <div className="opp-list">
                        {opps.map((o, i) => (
                            <div key={i} className="opp-card card">
                                <div className="opp-title">{o.title}</div>
                                <div className="opp-body">{o.body}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Segment Prioritization Table */}
            <div className="card">
                <h2 style={{ marginBottom: '1rem' }}>Segment Prioritization Ranking</h2>
                <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Priority</th><th>Segment</th><th>Size</th><th>Avg Spend</th>
                                <th>Est. Revenue</th><th>Rev. Share %</th><th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ranked.map((seg, i) => {
                                const segRev = safeNum(seg.avg_spend) * safeNum(seg.size);
                                const revPct = totalRevenue > 0 ? ((segRev / totalRevenue) * 100).toFixed(1) : 0;
                                const recs = ['Focus First — VIP Retention', 'Retain & Grow — Loyalty Programs', 'Activate — Seasonal Campaigns', 'Manage — Discount Controls'];
                                const color = SEG_COLORS[seg.label] || 'var(--accent)';
                                return (
                                    <tr key={seg.id}>
                                        <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>#{i + 1}</td>
                                        <td>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                                <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />
                                                <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{seg.label}</span>
                                            </span>
                                        </td>
                                        <td>{safeNum(seg.size).toLocaleString()}</td>
                                        <td>{fmtCurrency(seg.avg_spend)}</td>
                                        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>${(segRev / 1000).toFixed(1)}K <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 400 }}>(est.)</span></td>
                                        <td>{revPct}%</td>
                                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>{recs[i] || '—'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

function OverviewCard({ label, value, note }) {
    return (
        <div className="exec-ov-item card">
            <div className="eov-val">{value}</div>
            <div className="eov-label">{label}</div>
            {note && <div className="eov-note badge badge-gray" style={{ marginTop: '0.3rem', fontSize: '0.62rem' }}>{note}</div>}
        </div>
    );
}
