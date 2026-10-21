"""Tunable settings for the recommender."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = Path(os.getenv("MF_FRONTEND_DIR", str(BASE_DIR.parent / "frontend")))
CACHE_DIR = Path(os.getenv("MF_CACHE_DIR", str(BASE_DIR / "data" / "cache")))
RAW_DIR = CACHE_DIR / "raw"
MASTER_PATH = CACHE_DIR / "master.pkl"
DATASET_PATH = CACHE_DIR / "dataset.pkl"

API_URL = "https://api.mfapi.in/mf"
DISCLAIMER = "Not investment advice. Historical returns do not predict future returns."

TOP_N = 200
BASE_QUOTA = 40
MIN_YEARS = 1.5
MIN_OBS = 300
RISK_FREE = 0.065
REFRESH_DAYS = 2

CATEGORIES = ("large", "mid", "small", "flexi", "index")

SCORE_WEIGHTS = {
    "cagr_3y": 0.15,
    "cagr_5y": 0.10,
    "sip_xirr": 0.15,
    "sharpe_3y": 0.12,
    "sortino_3y": 0.10,
    "calmar_3y": 0.08,
    "consistency": 0.12,
    "max_drawdown": 0.08,
    "momentum_12m": 0.10,
}

PROFILES = {
    "conservative": {
        "large": 0.40,
        "index": 0.25,
        "flexi": 0.25,
        "mid": 0.10,
        "small": 0.00,
    },
    "moderate": {
        "large": 0.25,
        "index": 0.20,
        "flexi": 0.30,
        "mid": 0.18,
        "small": 0.07,
    },
    "aggressive": {
        "large": 0.15,
        "index": 0.10,
        "flexi": 0.25,
        "mid": 0.28,
        "small": 0.22,
    },
}

RISK_AVERSION = {1: 8.0, 2: 6.0, 3: 4.5, 4: 3.5, 5: 2.5}
VOL_BUDGET = {1: 0.14, 2: 0.15, 3: 0.17, 4: 0.19, 5: 0.21}
