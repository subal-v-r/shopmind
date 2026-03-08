import React, { useState } from 'react';
import { api } from '../utils/api';
import { safeNum, safeStr, SEG_META } from '../utils/chartConfig';
import './AnalyzerPage.css';

/* ── Field Schema ───────────────────────────────────────── */
const CATEGORIES = ['Clothing', 'Accessories', 'Footwear', 'Outerwear'];
const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];
const FREQUENCIES = ['Weekly', 'Bi-Weekly', 'Monthly', 'Quarterly', 'Annually'];
const FREQ_SCORE = { 'Weekly': 5, 'Bi-Weekly': 4, 'Monthly': 3, 'Quarterly': 2, 'Annually': 1 };
const GENDERS = ['Male', 'Female'];
const PAYMENTS = ['Credit Card', 'Debit Card', 'PayPal', 'Cash', 'Bank Transfer'];
const SHIPPINGS = ['Free Shipping', 'Express', 'Standard', 'Store Pickup', '2-Day Shipping', 'Next Day Air'];

const DEFAULT = {
    frequency: 'Monthly', subscription: 'No', discount: 'No', promo: 'No',
    prev_purchases: '',
    amount: '', rating: '', payment: 'Credit Card', shipping: 'Free Shipping',
    age: '', gender: 'Male', category: 'Clothing', season: 'Spring',
};

function validate(f) {
    const e = {};
    if (!f.age || isNaN(+f.age) || +f.age < 18 || +f.age > 90) e.age = 'Age must be 18–90';
    if (!f.amount || isNaN(+f.amount) || +f.amount <= 0) e.amount = 'Enter a valid purchase amount';
    if (!f.rating || isNaN(+f.rating) || +f.rating < 1 || +f.rating > 5) e.rating = 'Rating must be 1–5';
    if (!f.prev_purchases || isNaN(+f.prev_purchases) || +f.prev_purchases < 0) e.prev_purchases = 'Must be ≥ 0';
    return e;
}

const SEG_COLORS_ID = { premium: '#4f46e5', loyal: '#059669', occasional: '#d97706', discount: '#dc2626' };

const SEG_STRATEGY = {
    'Premium Urgent Buyers': ['Launch VIP early access program', 'Offer complimentary express shipping', 'Target with premium bundle upsells'],
    'Loyal Frequent Buyers': ['Enroll in loyalty points program', 'Send subscriber-only flash sales (10% off)', 'Run referral incentive campaign'],
    'Occasional Buyers': ['Send seasonal re-engagement offer (15% off)', 'Deploy cart abandonment retargeting', 'Create FOMO limited-time bundles'],
    'Discount-Driven Shoppers': ['Run flash sales during peak season', 'Create bulk-buy bundle deals', 'Cap discounts at 25% to protect margins'],
};

const CLV_TIER_COLOR = { Platinum: '#7c3aed', Gold: '#d97706', Silver: '#64748b', Bronze: '#92400e' };
const CLV_TIER_BADGE = { Platinum: 'badge-blue', Gold: 'badge-yellow', Silver: 'badge-gray', Bronze: 'badge-gray' };

function fmt$(v) { const n = safeNum(v); return n === 0 ? '$0.00' : `$${n.toFixed(2)}`; }
function fmtPct(v) { const n = safeNum(v); return `${n.toFixed(1)}%`; }
function fmtK(v) { const n = safeNum(v); return n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : fmt$(n); }

export default function AnalyzerPage() {
    const [form, setForm] = useState(DEFAULT);
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [apiErr, setApiErr] = useState(null);

    const set = (name) => (e) => {
        setForm(f => ({ ...f, [name]: e.target.value }));
        if (errors[name]) setErrors(er => { const c = { ...er }; delete c[name]; return c; });
    };

    const submit = async (e) => {
        e.preventDefault();
        const errs = validate(form);
        if (Object.keys(errs).length) { setErrors(errs); return; }
        setLoading(true); setApiErr(null);
        try {
            const fScore = FREQ_SCORE[form.frequency] || 3;
            const payload = {
                age: +form.age,
                purchase_amount: +form.amount,
                previous_purchases: +form.prev_purchases,
                review_rating: +form.rating,
                discount_applied: form.discount === 'Yes' ? 1 : 0,
                promo_code_used: form.promo === 'Yes' ? 1 : 0,
                subscription_status: form.subscription === 'Yes' ? 1 : 0,
                frequency_score: fScore,
                category: form.category,
                season: form.season,
                gender: form.gender,
                payment_method: form.payment,
                shipping_type: form.shipping,
            };
            const data = await api.analyzeCustomer(payload);
            setResult(data);
        } catch (err) {
            setApiErr(err.message || 'Analysis failed. Check your inputs and try again.');
        } finally {
            setLoading(false);
        }
    };

    const reset = () => { setForm(DEFAULT); setResult(null); setErrors({}); setApiErr(null); };

    /* ── Derived values ─────────────────────────────────── */
    const seg = result?.segment || '';
    const segConf = safeNum(result?.segment_confidence, 0);
    const segColor = SEG_COLORS_ID[Object.entries(SEG_META || {}).find(([, v]) => v.label === seg)?.[0]] || '#2563eb';

    const predicted = safeNum(result?.predicted_revenue, 0);
    const confLow = safeNum(result?.confidence_range?.[0], predicted * 0.85);
    const confHigh = safeNum(result?.confidence_range?.[1], predicted * 1.15);
    const subProb = safeNum(result?.subscription_probability, 0);
    const churnProb = safeNum(result?.churn_probability, 0);
    const churnRisk = result?.churn_risk || 'Unknown';
    const clvValue = safeNum(result?.clv_value, 0);
    const clvTier = result?.clv_tier || 'Bronze';
    const anomScore = safeNum(result?.anomaly_score, 0);
    const anomFlag = result?.anomaly_flag || false;

    const featImps = (result?.feature_importance || []).filter(f => typeof f.importance === 'number' && !isNaN(f.importance));
    const drivers = result?.subscription_drivers || [];
    const modifiers = result?.modifiers || null;
    const aiExpl = result?.ai_explanation || null;

    const churnBadge = churnRisk === 'High' ? 'badge-red' : churnRisk === 'Medium' ? 'badge-yellow' : 'badge-green';
    const tierColor = CLV_TIER_COLOR[clvTier] || '#64748b';
    const tierBadge = CLV_TIER_BADGE[clvTier] || 'badge-gray';

    return (
        <div>
            <div className="page-header">
                <h1>Customer Analyzer</h1>
                <p>Live ML predictions — XGBClassifier (subscription, churn) · XGBRegressor (CLV) · IsolationForest (anomaly) · GenAI insights</p>
            </div>

            <div className="az-layout">
                {/* ── FORM ─────────────────────────────────────────── */}
                <div className="card az-form-card">
                    <form onSubmit={submit} noValidate>
                        <Section title="Behavioral" icon={<BehaviorIcon />}>
                            <Field label="Purchase Frequency" error={null}>
                                <select value={form.frequency} onChange={set('frequency')}>
                                    {FREQUENCIES.map(f => <option key={f}>{f}</option>)}
                                </select>
                            </Field>
                            <Field label="Previous Purchases" error={errors.prev_purchases}>
                                <input type="number" value={form.prev_purchases} onChange={set('prev_purchases')} placeholder="e.g. 12" min="0" />
                            </Field>
                            <Field label="Subscription Status" error={null}>
                                <select value={form.subscription} onChange={set('subscription')}>
                                    <option>No</option><option>Yes</option>
                                </select>
                            </Field>
                            <Field label="Discount Applied" error={null}>
                                <select value={form.discount} onChange={set('discount')}>
                                    <option>No</option><option>Yes</option>
                                </select>
                            </Field>
                            <Field label="Promo Code Used" error={null}>
                                <select value={form.promo} onChange={set('promo')}>
                                    <option>No</option><option>Yes</option>
                                </select>
                            </Field>
                        </Section>

                        <div className="az-divider" />

                        <Section title="Transactional" icon={<TransactIcon />}>
                            <Field label="Purchase Amount ($)" error={errors.amount}>
                                <input type="number" value={form.amount} onChange={set('amount')} placeholder="e.g. 65" min="1" />
                            </Field>
                            <Field label="Review Rating (1–5)" error={errors.rating}>
                                <input type="number" value={form.rating} onChange={set('rating')} placeholder="e.g. 4.2" min="1" max="5" step="0.1" />
                            </Field>
                            <Field label="Payment Method" error={null}>
                                <select value={form.payment} onChange={set('payment')}>
                                    {PAYMENTS.map(p => <option key={p}>{p}</option>)}
                                </select>
                            </Field>
                            <Field label="Shipping Type" error={null}>
                                <select value={form.shipping} onChange={set('shipping')}>
                                    {SHIPPINGS.map(s => <option key={s}>{s}</option>)}
                                </select>
                            </Field>
                        </Section>

                        <div className="az-divider" />

                        <Section title="Contextual" icon={<ContextIcon />}>
                            <Field label="Age" error={errors.age}>
                                <input type="number" value={form.age} onChange={set('age')} placeholder="e.g. 34" min="18" max="90" />
                            </Field>
                            <Field label="Gender" error={null}>
                                <select value={form.gender} onChange={set('gender')}>
                                    {GENDERS.map(g => <option key={g}>{g}</option>)}
                                </select>
                            </Field>
                            <Field label="Category" error={null}>
                                <select value={form.category} onChange={set('category')}>
                                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                                </select>
                            </Field>
                            <Field label="Season" error={null}>
                                <select value={form.season} onChange={set('season')}>
                                    {SEASONS.map(s => <option key={s}>{s}</option>)}
                                </select>
                            </Field>
                        </Section>

                        {apiErr && <div className="error-banner">{apiErr}</div>}

                        <div className="az-form-actions">
                            <button type="submit" className="btn-primary" disabled={loading} style={{ flex: 1 }}>
                                {loading ? <><span className="spinner" style={{ width: 15, height: 15, borderWidth: 2 }} /> Analyzing...</> : 'Analyze Customer'}
                            </button>
                            <button type="button" className="btn-ghost" onClick={reset} disabled={loading}>Reset</button>
                        </div>
                    </form>
                </div>

                {/* ── RESULTS ──────────────────────────────────────── */}
                {result ? (
                    <div className="az-results">

                        {/* Segment */}
                        <div className="card az-seg-card" style={{ borderLeft: `3px solid ${segColor}` }}>
                            <div className="az-seg-label">Predicted Segment</div>
                            <div className="az-seg-name" style={{ color: segColor }}>{seg || '—'}</div>
                            <div className="az-seg-conf">
                                <span>Centroid confidence</span>
                                <div className="conf-bar-wrap">
                                    <div className="conf-bar" style={{ width: `${segConf * 100}%`, background: segColor }} />
                                </div>
                                <span className="conf-pct">{(segConf * 100).toFixed(0)}%</span>
                            </div>
                        </div>

                        {/* KPIs Row — Subscription + Churn + CLV */}
                        <div className="az-kpi-row">
                            <AzKpi
                                label="Sub. Probability"
                                value={fmtPct(subProb * 100)}
                                note={`${result?.subscription_likelihood || ''} likelihood`}
                                color="#059669"
                            />
                            <AzKpi
                                label="Churn Risk"
                                value={churnRisk}
                                note={`${fmtPct(churnProb * 100)} churn probability`}
                                color={churnRisk === 'High' ? '#dc2626' : churnRisk === 'Medium' ? '#d97706' : '#059669'}
                                badge={churnBadge}
                            />
                            <AzKpi
                                label="Lifetime Value"
                                value={fmtK(clvValue)}
                                note={`${clvTier} tier`}
                                color={tierColor}
                                badge={tierBadge}
                            />
                        </div>

                        {/* Anomaly + Predicted Revenue */}
                        <div className="az-kpi-row">
                            <AzKpi
                                label="Predicted Revenue"
                                value={fmt$(predicted)}
                                note={`Range: ${fmt$(confLow)} – ${fmt$(confHigh)} (est.)`}
                                color={segColor}
                            />
                            <AzKpi
                                label="Anomaly Score"
                                value={`${(anomScore * 100).toFixed(0)}%`}
                                note={anomFlag ? '⚠️ Flagged as anomaly' : '✓ Normal behavior'}
                                color={anomFlag ? '#dc2626' : '#059669'}
                                badge={anomFlag ? 'badge-red' : 'badge-green'}
                            />
                        </div>

                        {/* Confidence Range Visual */}
                        <div className="card az-confidence-card">
                            <h4>Spend Confidence Range <span className="badge badge-blue">Estimated</span></h4>
                            <div className="cr-bar-wrap">
                                <span>{fmt$(confLow)}</span>
                                <div className="cr-outer">
                                    <div className="cr-inner" style={{ background: segColor }} />
                                    <div className="cr-marker" style={{ left: `${Math.min(((predicted - confLow) / Math.max(confHigh - confLow, 1)) * 100, 100)}%`, background: segColor }} />
                                </div>
                                <span>{fmt$(confHigh)}</span>
                            </div>
                            <div className="cr-note">Point estimate: <strong>{fmt$(predicted)}</strong> · 85%–115% of segment baseline</div>
                        </div>

                        {/* GenAI Business Explanation */}
                        {aiExpl && (
                            <div className="card az-ai-card">
                                <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span>AI Business Insights</span>
                                    <span className="badge badge-blue">GenAI</span>
                                </h4>
                                <div className="az-ai-grid">
                                    {aiExpl.subscription_insight && (
                                        <AiInsightBlock
                                            icon="📬"
                                            title="Subscription Insight"
                                            body={aiExpl.subscription_insight}
                                            color="#059669"
                                        />
                                    )}
                                    {aiExpl.churn_insight && (
                                        <AiInsightBlock
                                            icon="⚡"
                                            title="Churn Risk Insight"
                                            body={aiExpl.churn_insight}
                                            color={churnRisk === 'High' ? '#dc2626' : '#d97706'}
                                        />
                                    )}
                                    {aiExpl.clv_insight && (
                                        <AiInsightBlock
                                            icon="💎"
                                            title="Customer Value Insight"
                                            body={aiExpl.clv_insight}
                                            color={tierColor}
                                        />
                                    )}
                                    {aiExpl.anomaly_insight && (
                                        <AiInsightBlock
                                            icon="🔍"
                                            title="Behavior Anomaly Insight"
                                            body={aiExpl.anomaly_insight}
                                            color={anomFlag ? '#dc2626' : '#6366f1'}
                                        />
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Strategy */}
                        <div className="card">
                            <h4 style={{ marginBottom: '0.85rem' }}>Personalized Strategy</h4>
                            <ul className="az-strat-list">
                                {(SEG_STRATEGY[seg] || []).map((a, i) => (
                                    <li key={i} className="az-strat-item">
                                        <span className="az-bullet" style={{ background: segColor }} />
                                        {a}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Key Drivers */}
                        {drivers.length > 0 && (
                            <div className="card">
                                <h4 style={{ marginBottom: '0.85rem' }}>Subscription Signals</h4>
                                <ul className="driver-list">
                                    {drivers.map((d, i) => <li key={i} className="driver-item"><span className="check-icon">✓</span>{d}</li>)}
                                </ul>
                            </div>
                        )}

                        {/* Feature Importance */}
                        <div className="card">
                            <h4 style={{ marginBottom: '0.85rem' }}>Revenue Driver Weights</h4>
                            {featImps.length > 0 ? (
                                <div className="az-feat-list">
                                    {featImps.map((f, i) => (
                                        <div key={i} className="az-feat-row">
                                            <span className="az-feat-name">{safeStr(f.feature)}</span>
                                            <div className="az-feat-bar-wrap">
                                                <div className="az-feat-bar" style={{ width: `${(f.importance * 100).toFixed(0)}%`, background: segColor }} />
                                            </div>
                                            <span className="az-feat-pct">{(f.importance * 100).toFixed(0)}%</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>Feature importance data not available.</p>
                            )}
                        </div>

                        {/* Modifiers transparency */}
                        {modifiers && (
                            <div className="card az-modifiers">
                                <h4 style={{ marginBottom: '0.75rem' }}>Prediction Breakdown <span className="badge badge-gray">Transparency</span></h4>
                                <div className="mod-grid">
                                    {Object.entries(modifiers).map(([k, v]) => (
                                        <div key={k} className="mod-item">
                                            <span>{k.replace(/_/g, ' ')}</span>
                                            <strong style={{ color: safeNum(v) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                                {safeNum(v) >= 0 ? '+' : ''}{safeNum(v).toFixed(2)}
                                            </strong>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : !loading && (
                    <div className="card az-empty">
                        <EmptyIcon />
                        <p>Fill in customer attributes and click <strong>Analyze Customer</strong> to view live ML predictions.</p>
                        <p className="az-empty-note">XGBClassifier · XGBRegressor · IsolationForest · GenAI Insights</p>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ── Sub-components ─────────────────────────────────────── */
function Section({ title, icon, children }) {
    return (
        <div className="az-section">
            <div className="az-section-title">{icon}<span>{title}</span></div>
            <div className="az-section-grid">{children}</div>
        </div>
    );
}
function Field({ label, error, children }) {
    return (
        <div className="az-field">
            <label>{label}</label>
            {children}
            {error && <span className="az-error">{error}</span>}
        </div>
    );
}
function AzKpi({ label, value, note, color, badge }) {
    return (
        <div className="card az-kpi">
            <div className="azk-value" style={{ color }}>{value}</div>
            <div className="azk-label">{label}</div>
            {badge && <span className={`badge ${badge}`} style={{ marginBottom: '0.2rem' }}>{value}</span>}
            <div className="azk-note">{note}</div>
        </div>
    );
}
function AiInsightBlock({ icon, title, body, color }) {
    return (
        <div className="az-ai-block" style={{ borderLeft: `3px solid ${color}` }}>
            <div className="az-ai-block-title">
                <span>{icon}</span>
                <strong style={{ color }}>{title}</strong>
            </div>
            <p className="az-ai-block-body">{body}</p>
        </div>
    );
}
function BehaviorIcon() { return <svg width="13" height="13" viewBox="0 0 15 15" fill="none"><path d="M7.5 1.5l6 3-6 3-6-3 6-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>; }
function TransactIcon() { return <svg width="13" height="13" viewBox="0 0 15 15" fill="none"><rect x="1" y="3" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M1 6h13" stroke="currentColor" strokeWidth="1.5" /></svg>; }
function ContextIcon() { return <svg width="13" height="13" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5" /><path d="M2 13c0-3 2.5-4.5 5.5-4.5S13 10 13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>; }
function EmptyIcon() { return <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ opacity: 0.3 }}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>; }
