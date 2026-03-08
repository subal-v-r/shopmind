import os
import json
import requests
from dotenv import load_dotenv

load_dotenv()

API_URL   = "https://router.huggingface.co/v1/chat/completions"
HF_TOKEN  = os.getenv("HF_TOKEN")
MODEL_NAME = "meta-llama/Llama-3.1-8B-Instruct:novita"

headers = {
    "Authorization": f"Bearer {HF_TOKEN}",
    "Content-Type": "application/json"
}


def generate_business_explanation(user_inputs: dict, predictions: dict) -> dict:
    """
    Generate dynamic, structured business explanations for a store owner.
    
    Args:
        user_inputs:  All input fields (age, purchase_amount, etc.)
        predictions:  Model outputs (subscription_probability, churn_probability,
                      clv_value, clv_tier, anomaly_score, anomaly_flag, segment)
    
    Returns:
        dict with keys: subscription_insight, churn_insight, clv_insight, anomaly_insight
        Falls back to rule-based rich text when HF_TOKEN is absent.
    """

    sub_prob   = predictions.get("subscription_probability", 0)
    sub_pct    = round(sub_prob * 100, 1)
    churn_prob = predictions.get("churn_probability", 0)
    churn_pct  = round(churn_prob * 100, 1)
    churn_risk = predictions.get("churn_risk", "Medium")
    clv_value  = predictions.get("clv_value", 0)
    clv_tier   = predictions.get("clv_tier", "Bronze")
    anom_score = predictions.get("anomaly_score", 0)
    anom_flag  = predictions.get("anomaly_flag", False)
    segment    = predictions.get("segment", "Unknown")
    rev        = predictions.get("predicted_revenue", 0)

    # ─── Fallback (no HF token or error) ─────────────────────────────────────
    def _fallback():
        sub_summary = (
            f"This customer has a {sub_pct:.0f}% subscription probability. "
            + ("Strong loyalty signals detected — prioritize retention perks and VIP access." if sub_prob > 0.65
               else "Moderate engagement. Consider targeted subscription trials or limited-time offers." if sub_prob > 0.35
               else "Low subscription likelihood. Focus on re-engagement campaigns and trust-building offers.")
        )
        churn_summary = (
            f"Churn risk is {churn_risk} ({churn_pct:.0f}%). "
            + ("Immediate intervention recommended: personalized win-back campaign, loyalty bonus, or account manager outreach." if churn_risk == "High"
               else "Monitor purchase frequency. Deploy proactive check-in emails and seasonal promotions to retain." if churn_risk == "Medium"
               else "Customer appears stable. Maintain engagement via loyalty rewards and exclusive product previews.")
        )
        clv_summary = (
            f"Predicted CLV: ${clv_value:,.2f} — {clv_tier} tier. "
            + (f"This is a top-tier Platinum customer. Invest in dedicated account management and premium experiences." if clv_tier == "Platinum"
               else f"Gold-tier customer with strong revenue potential. Upsell premium bundles and early-access deals." if clv_tier == "Gold"
               else f"Growing Silver-tier customer. Nurture with loyalty milestones and personalized recommendations." if clv_tier == "Silver"
               else f"Entry-level Bronze customer. Focus on first repurchase incentives and category discovery campaigns.")
        )
        anom_summary = (
            ("⚠️ Behavioral anomaly detected (score: {:.0f}%). ".format(anom_score * 100) +
             "Unusual pattern vs. typical shoppers in this segment — review for data quality, fraud risk, or unique buying behavior.")
            if anom_flag else
            ("No anomaly detected (score: {:.0f}%). ".format(anom_score * 100) +
             "Behavior is consistent with normal segment patterns. No immediate risk flags.")
        )
        return {
            "subscription_insight": sub_summary,
            "churn_insight":        churn_summary,
            "clv_insight":          clv_summary,
            "anomaly_insight":      anom_summary,
        }

    if not HF_TOKEN:
        return _fallback()

    profile_str = json.dumps(user_inputs, indent=2)
    prompt = f"""
You are a senior e-commerce growth strategist. Analyze the following customer and provide FOUR short business insights for the store owner.

Customer Profile:
{profile_str}

ML Prediction Results:
- Segment: {segment}
- Predicted Revenue: ${rev:.2f}
- Subscription Probability: {sub_pct:.1f}%
- Churn Probability: {churn_pct:.1f}% (Risk: {churn_risk})
- Customer Lifetime Value (CLV): ${clv_value:,.2f} (Tier: {clv_tier})
- Anomaly Score: {anom_score:.3f} ({'FLAGGED' if anom_flag else 'Normal'})

Respond in the following EXACT JSON structure with no markdown, no extra text:
{{
  "subscription_insight": "2-3 sentence insight about subscription likelihood and what marketing action to take.",
  "churn_insight": "2-3 sentence insight about churn risk and how to retain this customer.",
  "clv_insight": "2-3 sentence insight about CLV tier and how to maximize lifetime value.",
  "anomaly_insight": "2-3 sentence insight about the behavioral anomaly (or lack thereof) and what action to take."
}}

Be specific, actionable, and speak to a store owner. Use the actual numbers. No generic advice.
"""

    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": "You are a senior e-commerce growth strategist. Respond ONLY with valid JSON."},
            {"role": "user",   "content": prompt}
        ],
        "temperature": 0.7,
        "max_tokens":  600,
    }

    try:
        response = requests.post(API_URL, headers=headers, json=payload, timeout=30)
        if response.status_code != 200:
            return _fallback()

        content = response.json()["choices"][0]["message"]["content"].strip()

        # Extract JSON block even if wrapped in markdown code fences
        if "```" in content:
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()

        parsed = json.loads(content)
        # Validate keys are present
        required = ["subscription_insight", "churn_insight", "clv_insight", "anomaly_insight"]
        if all(k in parsed for k in required):
            return parsed
        return _fallback()

    except Exception:
        return _fallback()


# ── Legacy function (kept for backward-compat) ────────────────────────────────
def generate_advanced_insights(prediction_type: str, data: dict) -> str:
    """Legacy single-string insights generator."""
    if not HF_TOKEN:
        return "HF_TOKEN not configured."

    customer_profile = json.dumps(data.get("customer_input", {}), indent=2)

    if prediction_type == "subscription":
        prob = data.get("probability", 0) * 100
        prompt = f"As an expert marketing analyst, analyze this customer profile:\n{customer_profile}\n\nPredicted Subscription Probability: {prob:.1f}%\nProvide: 1. A brief 2-3 sentence business explanation. 2. One concrete marketing action."
    elif prediction_type == "anomaly":
        prompt = f"As an expert risk analyst, analyze this flagged customer profile:\n{customer_profile}\nProvide: 1. A 2-3 sentence explanation of Why this behavior might be unusual. 2. One recommended review action."
    elif prediction_type == "multi_model":
        clv = data.get("clv", 0)
        churn_prob = data.get("churn_probability", 0) * 100
        sentiment_map = {0: "Negative", 1: "Neutral", 2: "Positive"}
        sentiment_str = sentiment_map.get(data.get("sentiment", 1))
        prompt = f"As a senior business strategist, analyze this customer:\n{customer_profile}\nPredicted CLV: ${clv:,.2f}\nChurn Probability: {churn_prob:.1f}%\nSentiment: {sentiment_str}\nProvide: 1. A 3-4 sentence strategic summary. 2. One high-impact business action."
    else:
        return "Invalid prediction type."

    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": "You are a senior e-commerce growth strategist."},
            {"role": "user",   "content": prompt}
        ],
        "temperature": 0.7,
        "max_tokens":  500,
    }

    try:
        response = requests.post(API_URL, headers=headers, json=payload, timeout=30)
        if response.status_code != 200:
            return f"HF API Error: {response.json()}"
        return response.json()["choices"][0]["message"]["content"]
    except Exception as e:
        return f"Error generating insights: {str(e)}"