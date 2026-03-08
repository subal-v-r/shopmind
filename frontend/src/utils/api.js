const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  };
  const response = await fetch(url, config);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${response.status}: ${body}`);
  }
  return response.json();
}

export const api = {
  // Health
  health: () => request('/health'),

  // Segments
  getSegments: () => request('/segments'),
  getSegment: (id) => request(`/segments/${id}`),
  getProjection: () => request('/segments/projection/all'),

  // Affinity
  getAffinity: () => request('/affinity'),
  getAffinityRules: (minLift = 1.0) => request(`/affinity/rules?min_lift=${minLift}`),
  getSegmentAffinity: (id) => request(`/affinity/segment/${id}`),

  // Sentiment
  getSentiment: () => request('/sentiment'),
  getSegmentSentiment: (id) => request(`/sentiment/segment/${id}`),

  // Predictions
  analyzeCustomer: (data) => request('/predictions/analyze', { method: 'POST', body: JSON.stringify(data) }),
  predictRevenue: (data) => request('/predictions/revenue', { method: 'POST', body: JSON.stringify(data) }),
  predictSubscription: (data) => request('/predictions/subscription', { method: 'POST', body: JSON.stringify(data) }),
  getFeatureImportance: () => request('/predictions/revenue/feature-importance'),

  // Strategy
  getStrategies: () => request('/strategy'),
  getStrategy: (id) => request(`/strategy/segment/${id}`),
  compareStrategies: (s1, s2) => request(`/strategy/compare/${s1}/${s2}`),

  // Model Metrics (new)
  getModelMetrics: () => request('/model-metrics'),
};
