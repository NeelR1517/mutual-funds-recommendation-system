"""Portfolio recommendation endpoint."""

from fastapi import APIRouter, Depends

from ..schemas import RecommendRequest, RecommendResponse
from ..services.recommendation import build_recommendation
from ..store import Dataset
from .deps import get_dataset

router = APIRouter(tags=["recommendation"])


@router.post("/recommend", response_model=RecommendResponse)
def recommend(payload: RecommendRequest, dataset: Dataset = Depends(get_dataset)):
    return build_recommendation(
        dataset,
        age=payload.age,
        horizon=payload.horizon_years,
        risk=payload.risk_tolerance,
        mode=payload.mode,
        amount=payload.amount,
    )
