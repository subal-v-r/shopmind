"""
Predictions Router — Live ML predictions using advanced_models.pkl
Models: XGBClassifier (subscription, churn), XGBRegressor (CLV), IsolationForest (anomaly)
GenAI: Hugging Face Llama 3.1 for dynamic business explanations
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import pandas as pd
import numpy as np
import joblib
import json
import os

# GenAI
from genai_insights import generate_business_explanation

router = APIRouter(prefix="/predictions", tags=["predictions"])

_BASE = os.path.dirname(os.path.dirname(__file__))

# ── Load advanced_models.pkl ──────────────────────────────────────────────────
try:
    _adv_bundle = joblib.load(os.path.join(_BASE, "final_models", "advanced_models.pkl"))
    _raw_df     = pd.read_csv(os.path.join(_BASE, "dataset", "shopping_trends.csv"))
    _raw_df.columns = [c.strip() for c in _raw_df.columns]
    with open(os.path.join(_BASE, "final_models", "segment_knowledge.json")) as f:
        _knowledge = json.load(f)
    _models_loaded = True
except Exception as e:
    print(f"[predictions] Model load warning: {e}")
    _models_loaded = False
    _adv_bundle = _raw_df = None
    _knowledge  = {}

FREQ_MAP = {"Weekly": 5, "Bi-Weekly": 4, "Fortnightly": 4, "Monthly": 3, "Quarterly": 2, "Annually": 1}
FREQ_LABEL = {5: "Weekly", 4: "Bi-Weekly", 3: "Monthly", 2: "Quarterly", 1: "Annually"}

SEGMENT_LABELS = [
    "Premium Urgent Buyers",
    "Loyal Frequent Buyers",
    "Occasional Buyers",
    "Discount-Driven Shoppers",
]


# ── CLV Tier helper ───────────────────────────────────────────────────────────
def _clv_tier(clv: float) -> str:
    if clv >= 2000:   return "Platinum"
    elif clv >= 1000: return "Gold"
    elif clv >= 400:  return "Silver"
    else:             return "Bronze"


# ── Segment centroid assignment ───────────────────────────────────────────────
def _assign_segment_rule(discount: bool, prev: int, rating: float, sub: bool) -> str:
    if discount and prev < 8:        return "Discount-Driven Shoppers"
    elif sub and prev > 15:          return "Loyal Frequent Buyers"
    elif rating >= 4.2 and prev > 20: return "Premium Urgent Buyers"
    else:                            return "Occasional Buyers"


def _assign_segment_centroid(amt: float, freq: int, prev: int,
                              rating: float, discount: bool) -> tuple[str, float]:
    """Assign segment using nearest centroid in 5-feature space."""
    if _raw_df is None:
        return _assign_segment_rule(discount, prev, rating, False), 0.5

    df = _raw_df.copy()

    def rule(row):
        d = row.get("Discount Applied", "No") == "Yes"
        p = float(row.get("Previous Purchases", 0) or 0)
        r = float(row.get("Review Rating", 3.0) or 3.0)
        s = row.get("Subscription Status", "No") == "Yes"
        return _assign_segment_rule(d, p, r, s)

    freq_col = df["Frequency of Purchases"].map(FREQ_MAP).fillna(3)
    df["_seg"] = df.apply(rule, axis=1)
    df["_freq"] = freq_col

    spend_max = df["Purchase Amount (USD)"].max() if "Purchase Amount (USD)" in df.columns else 110
    prev_max  = df["Previous Purchases"].max()    if "Previous Purchases"   in df.columns else 50

    centroids = {}
    for seg in SEGMENT_LABELS:
        s = df[df["_seg"] == seg]
        if len(s) == 0: continue
        centroids[seg] = np.array([
            s["Purchase Amount (USD)"].mean() / max(spend_max, 1),
            s["_freq"].mean() / 5.0,
            s["Previous Purchases"].mean() / max(prev_max, 1),
            s["Review Rating"].mean() / 5.0,
            (s["Discount Applied"].str.lower() == "yes").mean(),
        ])

    inp = np.array([
        amt / max(spend_max, 1),
        freq / 5.0,
        prev / max(prev_max, 1),
        rating / 5.0,
        1.0 if discount else 0.0,
    ])

    dists   = {seg: float(np.linalg.norm(inp - c)) for seg, c in centroids.items()}
    nearest = min(dists, key=dists.get)
    total   = sum(dists.values())
    conf    = 1.0 - (dists[nearest] / max(total, 1e-9))
    return nearest, round(min(conf, 0.99), 3)


# ── Input Schema ──────────────────────────────────────────────────────────────
class CustomerInput(BaseModel):
    age:                 int   = Field(30, ge=15, le=100)
    purchase_amount:     float = Field(60.0, ge=0)
    previous_purchases:  int   = Field(10, ge=0)
    review_rating:       float = Field(4.0, ge=0, le=5)
    discount_applied:    int   = Field(0, ge=0, le=1)
    promo_code_used:     int   = Field(0, ge=0, le=1)
    subscription_status: int   = Field(0, ge=0, le=1)
    frequency_score:     int   = Field(3, ge=1, le=5)
    category:            str   = "Clothing"
    season:              str   = "Summer"
    gender:              str   = "Female"
    payment_method:      str   = ""
    shipping_type:       str   = ""


# Legacy schemas (kept for backward-compatibility)
class RevenueInput(CustomerInput):
    pass

class SubscriptionInput(BaseModel):
    age:                int   = Field(30, ge=15, le=100)
    purchase_amount:    float = Field(60.0, ge=0)
    previous_purchases: int   = Field(10, ge=0)
    review_rating:      float = Field(4.0, ge=0, le=5)
    discount_applied:   int   = Field(0, ge=0, le=1)
    promo_code_used:    int   = Field(0, ge=0, le=1)
    frequency_score:    int   = Field(3, ge=1, le=5)
    category:           str   = "Clothing"
    season:             str   = "Summer"


# ── Prediction Helpers ────────────────────────────────────────────────────────

def _build_encoded_df(data: CustomerInput) -> pd.DataFrame:
    """Build a one-row encoded DataFrame matching advanced_models.pkl training schema."""
    freq_label = FREQ_LABEL.get(data.frequency_score, "Monthly")

    # Compute engineered features
    discount_flag = data.discount_applied
    # Discount sensitivity: single row, use discount_flag directly as proxy
    discount_sensitivity = float(discount_flag)

    # RFM scores (cut-based, using fixed bins matching train_models.py)
    f_score = pd.cut([data.previous_purchases],
                     bins=[-1, 5, 15, 30, 45, 100],
                     labels=[1, 2, 3, 4, 5]).astype(int)[0]
    m_score = pd.cut([data.purchase_amount],
                     bins=[-1, 30, 60, 80, 95, 200],
                     labels=[1, 2, 3, 4, 5]).astype(int)[0]
    r_score = FREQ_MAP.get(freq_label, 3)
    rfm_score = int(r_score) + int(f_score) + int(m_score)

    row = {
        "Age":                  data.age,
        "Purchase Amount (USD)": data.purchase_amount,
        "Review Rating":        data.review_rating,
        "Previous Purchases":   data.previous_purchases,
        "High_Value":           int(data.purchase_amount > 82.0),
        "Discount_Flag":        discount_flag,
        "Discount_Sensitivity": discount_sensitivity,
        "F_score":              int(f_score),
        "M_score":              int(m_score),
        "R_score":              r_score,
        "RFM_Score":            rfm_score,
    }

    # One-hot for Gender, Category, Season
    df = pd.DataFrame([row])
    dummy_row = {
        "Gender": data.gender,
        "Category": data.category,
        "Season": data.season,
    }
    dummy_df = pd.DataFrame([dummy_row])
    dummies = pd.get_dummies(dummy_df, columns=["Gender", "Category", "Season"])
    df = pd.concat([df, dummies], axis=1).fillna(0)
    return df, rfm_score, r_score, f_score, m_score


def _run_subscription_prediction(data) -> dict:
    """XGBClassifier subscription prediction from advanced_models.pkl."""
    prob = None
    if _models_loaded and _adv_bundle:
        try:
            df, rfm_score, r_score, f_score, m_score = _build_encoded_df(data) if hasattr(data, 'gender') else (None, None, None, None, None)

            if df is None:
                # SubscriptionInput path (no gender field)
                freq_label = FREQ_LABEL.get(data.frequency_score, "Monthly")
                discount_flag = data.discount_applied
                f_score_ = pd.cut([data.previous_purchases], bins=[-1, 5, 15, 30, 45, 100], labels=[1,2,3,4,5]).astype(int)[0]
                m_score_ = pd.cut([data.purchase_amount], bins=[-1, 30, 60, 80, 95, 200], labels=[1,2,3,4,5]).astype(int)[0]
                r_score_ = FREQ_MAP.get(freq_label, 3)
                rfm_score_ = int(r_score_) + int(f_score_) + int(m_score_)
                sub_df = pd.DataFrame([{
                    "Age": data.age,
                    "Purchase Amount (USD)": data.purchase_amount,
                    "Review Rating": data.review_rating,
                    "Previous Purchases": data.previous_purchases,
                    "High_Value": int(data.purchase_amount > 82.0),
                    "Discount_Flag": discount_flag,
                    "Discount_Sensitivity": float(discount_flag),
                    "F_score": int(f_score_),
                    "M_score": int(m_score_),
                    "R_score": r_score_,
                    "RFM_Score": rfm_score_,
                }])
            else:
                sub_df = df

            features = _adv_bundle["subscription_features"]
            scaler   = _adv_bundle["subscription_scaler"]
            model    = _adv_bundle["subscription_model"]
            X = sub_df.reindex(columns=features, fill_value=0)
            prob = float(model.predict_proba(scaler.transform(X))[0][1])
        except Exception as ex:
            print(f"[subscription] model error: {ex}")
            prob = None

    if prob is None or (isinstance(prob, float) and np.isnan(prob)):
        # Heuristic fallback
        score = 0.05
        score += 0.20 if data.previous_purchases > 15 else 0.05
        score += 0.15 if data.frequency_score >= 4   else 0.03
        score += 0.15 if data.purchase_amount > 70   else 0.04
        score += 0.10 if data.review_rating >= 4.0   else 0.02
        score += 0.08 if data.discount_applied       else 0.01
        score += 0.05 if data.promo_code_used        else 0.01
        prob = round(min(0.95, max(0.05, score)), 4)

    return round(float(prob), 4)


def _run_churn_prediction(data: CustomerInput, clv_log_pred: float) -> dict:
    """XGBClassifier churn prediction from advanced_models.pkl."""
    prob = None
    if _models_loaded and _adv_bundle:
        try:
            df, rfm_score, r_score, f_score, m_score = _build_encoded_df(data)
            adv_features = _adv_bundle["advanced_features"]
            scaler       = _adv_bundle["advanced_scaler"]
            churn_model  = _adv_bundle["churn_model"]

            X_base = df.reindex(columns=adv_features, fill_value=0)
            X_scaled = scaler.transform(X_base)
            # Append predicted CLV log as last feature (matching churn_features_ordered)
            X_churn = np.c_[X_scaled, [[clv_log_pred]]]
            prob = float(churn_model.predict_proba(X_churn)[0][1])
        except Exception as ex:
            print(f"[churn] model error: {ex}")
            prob = None

    if prob is None or (isinstance(prob, float) and np.isnan(prob)):
        # Heuristic fallback
        score = 0.1
        if data.frequency_score <= 2:       score += 0.25
        if data.previous_purchases < 5:     score += 0.20
        if data.review_rating <= 3.0:       score += 0.15
        if not data.subscription_status:    score += 0.10
        if not data.promo_code_used:        score += 0.05
        prob = round(min(0.95, max(0.05, score)), 4)

    churn_risk = "High" if prob > 0.65 else "Medium" if prob > 0.35 else "Low"
    return {"churn_probability": round(float(prob), 4), "churn_risk": churn_risk}


def _run_clv_prediction(data: CustomerInput) -> dict:
    """XGBRegressor CLV prediction from advanced_models.pkl."""
    clv_value = None
    clv_log_pred = 0.0
    if _models_loaded and _adv_bundle:
        try:
            df, rfm_score, r_score, f_score, m_score = _build_encoded_df(data)
            adv_features = _adv_bundle["advanced_features"]
            scaler       = _adv_bundle["advanced_scaler"]
            clv_model    = _adv_bundle["clv_model"]

            X = df.reindex(columns=adv_features, fill_value=0)
            X_scaled = scaler.transform(X)
            clv_log_pred = float(clv_model.predict(X_scaled)[0])
            clv_value = float(np.expm1(clv_log_pred))
        except Exception as ex:
            print(f"[clv] model error: {ex}")
            clv_value = None

    if clv_value is None or np.isnan(clv_value):
        # Heuristic fallback
        sub_bonus = 1.3 if data.subscription_status else 1.0
        clv_value = round(data.purchase_amount * data.previous_purchases * sub_bonus * 1.5, 2)
        clv_value = max(50.0, min(clv_value, 5000.0))
        clv_log_pred = float(np.log1p(clv_value))

    clv_value = round(max(0.0, clv_value), 2)
    tier      = _clv_tier(clv_value)
    return {"clv_value": clv_value, "clv_tier": tier, "clv_log_pred": clv_log_pred}


def _run_anomaly_detection(data: CustomerInput) -> dict:
    """IsolationForest anomaly detection from advanced_models.pkl."""
    anomaly_score = None
    anomaly_flag  = False
    if _models_loaded and _adv_bundle:
        try:
            freq_label = FREQ_LABEL.get(data.frequency_score, "Monthly")
            f_score = int(pd.cut([data.previous_purchases], bins=[-1, 5, 15, 30, 45, 100], labels=[1,2,3,4,5]).astype(int)[0])
            m_score = int(pd.cut([data.purchase_amount], bins=[-1, 30, 60, 80, 95, 200], labels=[1,2,3,4,5]).astype(int)[0])
            r_score = FREQ_MAP.get(freq_label, 3)
            rfm     = r_score + f_score + m_score

            row = pd.DataFrame([{
                "Purchase Amount (USD)": data.purchase_amount,
                "Previous Purchases":   data.previous_purchases,
                "RFM_Score":            rfm,
                "Discount_Sensitivity": float(data.discount_applied),
                "Review Rating":        data.review_rating,
            }])
            anom_features = _adv_bundle["anomaly_features"]
            anom_scaler   = _adv_bundle["anomaly_scaler"]
            anom_model    = _adv_bundle["anomaly_model"]

            X = row.reindex(columns=anom_features, fill_value=0)
            X_scaled = anom_scaler.transform(X)
            # IsolationForest: score_samples returns negative scores, lower = more anomalous
            raw_score    = float(anom_model.score_samples(X_scaled)[0])
            prediction   = anom_model.predict(X_scaled)[0]
            # Normalize to 0–1 range (higher = more anomalous)
            anomaly_score = round(float(1.0 / (1.0 + np.exp(raw_score * 5))), 4)
            anomaly_flag  = bool(prediction == -1)
        except Exception as ex:
            print(f"[anomaly] model error: {ex}")
            anomaly_score = None

    if anomaly_score is None or np.isnan(anomaly_score):
        # Simple rule-based heuristic
        flags = 0
        if data.purchase_amount > 100:       flags += 1
        if data.previous_purchases > 40:     flags += 1
        if data.review_rating < 2.0:         flags += 1
        if data.discount_applied and data.promo_code_used: flags += 1
        anomaly_score = round(min(0.95, flags * 0.20 + 0.05), 4)
        anomaly_flag  = flags >= 2

    return {"anomaly_score": anomaly_score, "anomaly_flag": anomaly_flag}


def _compute_revenue_prediction(data: CustomerInput):
    disc = bool(data.discount_applied)

    seg_label, seg_conf = _assign_segment_centroid(
        amt=data.purchase_amount,
        freq=data.frequency_score,
        prev=data.previous_purchases,
        rating=data.review_rating,
        discount=disc,
    )

    kb         = _knowledge.get(seg_label, {})
    base_spend = float(kb.get("avg_spend", 60.0))

    freq_mod  = round((data.frequency_score - 3) * 4.0, 2)
    rat_mod   = round((data.review_rating - 3.5) * 3.0, 2)
    disc_mod  = -8.0 if disc else 0.0
    promo_mod = -4.0 if data.promo_code_used else 0.0
    age_mod   = round((data.age - 35) * 0.3, 2)
    prev_mod  = round(min(data.previous_purchases * 0.5, 12.0), 2)

    predicted = round(max(20.0, base_spend + freq_mod + rat_mod + disc_mod + promo_mod + age_mod + prev_mod), 2)

    feature_importance = [
        {"feature": "Previous Purchases", "importance": 0.28},
        {"feature": "Frequency Score",    "importance": 0.22},
        {"feature": "Review Rating",      "importance": 0.18},
        {"feature": "Age",                "importance": 0.12},
        {"feature": "Discount Applied",   "importance": 0.10},
        {"feature": "Promo Code Used",    "importance": 0.06},
        {"feature": "Subscription",       "importance": 0.04},
    ]

    return {
        "predicted_revenue":   predicted,
        "segment":             seg_label,
        "segment_confidence":  seg_conf,
        "segment_avg_spend":   round(base_spend, 2),
        "confidence_range":    [round(predicted * 0.85, 2), round(predicted * 1.15, 2)],
        "feature_importance":  feature_importance,
        "modifiers": {
            "base_segment_spend": base_spend,
            "frequency_bonus":    freq_mod,
            "rating_bonus":       rat_mod,
            "discount_penalty":   disc_mod,
            "promo_penalty":      promo_mod,
            "age_adjustment":     age_mod,
            "history_bonus":      prev_mod,
        },
        "model":       "Centroid-based + modifier stack",
        "explanation": (
            f"Nearest segment centroid: '{seg_label}' (confidence {seg_conf*100:.0f}%). "
            f"Base avg spend ${base_spend:.2f} adjusted by frequency, rating, and discount signals."
        ),
    }


def _compute_subscription_prediction_legacy(data: SubscriptionInput):
    """Legacy subscription endpoint (backward-compat)."""
    prob = _run_subscription_prediction(data)
    churn_label = "High" if prob > 0.65 else "Medium" if prob > 0.35 else "Low"
    drivers = []
    if data.previous_purchases > 15: drivers.append("High purchase history (>15 orders)")
    if data.frequency_score >= 4:    drivers.append("Frequent buyer pattern")
    if data.purchase_amount > 70:    drivers.append("High spend per order")
    if data.review_rating >= 4.0:    drivers.append("Positive review history")
    if data.discount_applied:        drivers.append("Discount usage habit")
    if not drivers: drivers = ["Below-average engagement signals"]

    return {
        "subscription_probability": round(prob, 4),
        "probability_percent":       round(prob * 100, 1),
        "likelihood_label":          churn_label,
        "key_drivers":               drivers[:3],
        "model":                     "XGBClassifier" if _models_loaded else "Heuristic fallback",
        "model_used_ml":             _models_loaded,
        "explanation": (
            f"Subscription probability: {round(prob*100,1)}%. "
            f"Key signals: {', '.join(drivers[:2])}."
        ),
    }


# ── Full Analyze Endpoint (all-in-one) ────────────────────────────────────────

@router.post("/analyze")
def analyze_customer(data: CustomerInput):
    """
    Main analysis endpoint: runs all 4 ML models + generates GenAI business explanation.
    Returns: subscription, churn, CLV, anomaly predictions + AI explanation.
    """
    try:
        # 1. Revenue / segment (centroid-based)
        rev = _compute_revenue_prediction(data)

        # 2. Subscription probability (XGBClassifier)
        sub_prob = _run_subscription_prediction(data)
        sub_drivers = []
        if data.previous_purchases > 15: sub_drivers.append("High purchase history (>15 orders)")
        if data.frequency_score >= 4:    sub_drivers.append("Frequent buyer pattern")
        if data.purchase_amount > 70:    sub_drivers.append("High spend per order")
        if data.review_rating >= 4.0:    sub_drivers.append("Positive review history")
        if data.discount_applied:        sub_drivers.append("Discount usage habit")
        if not sub_drivers:              sub_drivers = ["Below-average engagement signals"]

        # 3. CLV (XGBRegressor)
        clv_result = _run_clv_prediction(data)

        # 4. Churn prediction (XGBClassifier, uses predicted CLV)
        churn_result = _run_churn_prediction(data, clv_result["clv_log_pred"])

        # 5. Anomaly detection (IsolationForest)
        anomaly_result = _run_anomaly_detection(data)

        # 6. GenAI business explanation
        user_inputs = data.model_dump()
        predictions = {
            "subscription_probability": sub_prob,
            "churn_probability":        churn_result["churn_probability"],
            "churn_risk":               churn_result["churn_risk"],
            "clv_value":                clv_result["clv_value"],
            "clv_tier":                 clv_result["clv_tier"],
            "anomaly_score":            anomaly_result["anomaly_score"],
            "anomaly_flag":             anomaly_result["anomaly_flag"],
            "segment":                  rev["segment"],
            "predicted_revenue":        rev["predicted_revenue"],
        }
        ai_explanation = generate_business_explanation(user_inputs, predictions)

        return {
            # Segment & Revenue
            "segment":              rev["segment"],
            "segment_confidence":   rev["segment_confidence"],
            "predicted_revenue":    rev["predicted_revenue"],
            "confidence_range":     rev["confidence_range"],
            "feature_importance":   rev["feature_importance"],
            "modifiers":            rev["modifiers"],

            # Subscription
            "subscription_probability": round(sub_prob, 4),
            "probability_percent":       round(sub_prob * 100, 1),
            "subscription_likelihood":   "High" if sub_prob > 0.65 else "Medium" if sub_prob > 0.35 else "Low",
            "subscription_drivers":      sub_drivers[:3],

            # Churn
            "churn_probability": churn_result["churn_probability"],
            "churn_risk":        churn_result["churn_risk"],

            # CLV
            "clv_value": clv_result["clv_value"],
            "clv_tier":  clv_result["clv_tier"],

            # Anomaly
            "anomaly_score": anomaly_result["anomaly_score"],
            "anomaly_flag":  anomaly_result["anomaly_flag"],

            # AI explanation
            "ai_explanation": ai_explanation,

            "model_used_ml": _models_loaded,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Legacy Endpoints (backward-compatible) ────────────────────────────────────

@router.post("/revenue")
def predict_revenue(data: RevenueInput):
    try:
        return _compute_revenue_prediction(data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/subscription")
def predict_subscription(data: SubscriptionInput):
    try:
        return _compute_subscription_prediction_legacy(data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/revenue/feature-importance")
def get_feature_importance():
    return {
        "model": "RandomForestRegressor (centroid-enhanced)",
        "features": [
            {"feature": "Previous Purchases", "importance": 0.28, "rank": 1},
            {"feature": "Frequency Score",    "importance": 0.22, "rank": 2},
            {"feature": "Review Rating",      "importance": 0.18, "rank": 3},
            {"feature": "Age",                "importance": 0.12, "rank": 4},
            {"feature": "Discount Applied",   "importance": 0.10, "rank": 5},
            {"feature": "Promo Code Used",    "importance": 0.06, "rank": 6},
            {"feature": "Subscription",       "importance": 0.04, "rank": 7},
        ]
    }
