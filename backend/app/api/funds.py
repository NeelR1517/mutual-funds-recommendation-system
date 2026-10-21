"""Fund listing, details and NAV history."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from ..config import CATEGORIES
from ..schemas import FundNavResponse, FundOut, NavPoint, ScoreResponse
from ..serializers import fund_payload
from ..services.mfapi import fetch_scheme
from ..services.scoring import score_breakdown
from ..store import Dataset
from .deps import get_dataset

router = APIRouter(tags=["funds"])

SORT_FIELDS = {
    "score",
    "cagr_3y",
    "cagr_5y",
    "sharpe_3y",
    "sip_xirr",
    "max_drawdown",
    "years",
    "name",
}


@router.get("/funds", response_model=list[FundOut])
def list_funds(
    category: str | None = None,
    selected_only: bool = True,
    sort: str = "score",
    order: Literal["asc", "desc"] = "desc",
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    dataset: Dataset = Depends(get_dataset),
):
    if category is not None and category not in CATEGORIES:
        raise HTTPException(400, f"category must be one of: {', '.join(CATEGORIES)}")
    if sort not in SORT_FIELDS:
        raise HTTPException(
            400, f"sort must be one of: {', '.join(sorted(SORT_FIELDS))}"
        )

    funds = dataset.funds
    if selected_only:
        funds = funds[funds["selected"]]
    if category:
        funds = funds[funds["category"] == category]

    funds = funds.sort_values(sort, ascending=order == "asc")
    rows = funds.iloc[offset : offset + limit]
    return [fund_payload(row) for _, row in rows.iterrows()]


@router.get("/funds/{code}", response_model=FundOut)
def get_fund(code: int, dataset: Dataset = Depends(get_dataset)):
    rows = dataset.funds[dataset.funds["code"] == code]
    if rows.empty:
        raise HTTPException(404, "Fund not found.")
    return fund_payload(rows.iloc[0])


@router.get("/funds/{code}/score", response_model=ScoreResponse)
def get_fund_score(code: int, dataset: Dataset = Depends(get_dataset)):
    result = score_breakdown(dataset.funds, code)
    if result is None:
        raise HTTPException(404, "Fund not found.")
    return result


@router.get("/funds/{code}/nav", response_model=FundNavResponse)
def get_fund_nav(
    code: int,
    limit: int = Query(500, ge=1, le=10_000),
    dataset: Dataset = Depends(get_dataset),
):
    rows = dataset.funds[dataset.funds["code"] == code]
    if rows.empty:
        raise HTTPException(404, "Fund not found.")

    try:
        raw = fetch_scheme(code)
    except Exception as exc:
        raise HTTPException(502, "Could not load NAV history.") from exc

    points = []
    for point in reversed(raw.get("data") or []):
        try:
            points.append(
                NavPoint(
                    date=datetime.strptime(point["date"], "%d-%m-%Y")
                    .date()
                    .isoformat(),
                    nav=float(point["nav"]),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue

    return FundNavResponse(
        code=code,
        name=str(rows.iloc[0]["name"]),
        points=points[-limit:],
    )
