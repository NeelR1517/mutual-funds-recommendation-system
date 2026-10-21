"""Health, overview, rebuild and metadata endpoints."""

from fastapi import APIRouter, Depends

from ..config import (
    BASE_QUOTA,
    CATEGORIES,
    DISCLAIMER,
    MIN_OBS,
    MIN_YEARS,
    PROFILES,
    RISK_FREE,
    SCORE_WEIGHTS,
    TOP_N,
)
from ..schemas import HealthResponse, MetaResponse, OverviewResponse, RefreshResponse
from ..store import Dataset, DataStore
from .deps import get_dataset, get_store

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthResponse)
def health(store: DataStore = Depends(get_store)):
    return store.snapshot()


@router.post("/refresh", response_model=RefreshResponse, status_code=202)
def refresh(store: DataStore = Depends(get_store)):
    started = store.start_refresh()
    return {"started": started, "status": store.status}


@router.get("/overview", response_model=OverviewResponse)
def overview(
    store: DataStore = Depends(get_store),
    dataset: Dataset = Depends(get_dataset),
):
    snapshot = store.snapshot()
    funds = dataset.funds
    category_counts = funds["category"].value_counts().to_dict()
    top_counts = (
        funds.loc[funds["selected"], "category"].value_counts().to_dict()
        if "selected" in funds
        else {}
    )
    return {
        **snapshot,
        "stats": dataset.stats,
        "category_counts": {
            category: int(category_counts.get(category, 0)) for category in CATEGORIES
        },
        "top_category_counts": {
            category: int(top_counts.get(category, 0)) for category in CATEGORIES
        },
        "categories": list(CATEGORIES),
        "score_weights": SCORE_WEIGHTS,
        "risk_free": RISK_FREE,
        "disclaimer": DISCLAIMER,
    }


@router.get("/meta", response_model=MetaResponse)
def meta():
    return {
        "risk_free": RISK_FREE,
        "top_n": TOP_N,
        "base_quota": BASE_QUOTA,
        "min_years": MIN_YEARS,
        "min_obs": MIN_OBS,
        "categories": list(CATEGORIES),
        "score_weights": SCORE_WEIGHTS,
        "profiles": PROFILES,
        "disclaimer": DISCLAIMER,
    }
