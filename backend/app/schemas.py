"""Request and response models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class FundOut(BaseModel):
    code: int
    name: str
    amc: str
    category: str
    selected: bool = True
    rank: int | None = None

    years: float | None = None
    n_obs: int | None = None
    first_date: str | None = None
    last_date: str | None = None

    score: float | None = None
    n_metrics: int | None = None
    cagr_1y: float | None = None
    cagr_3y: float | None = None
    cagr_5y: float | None = None
    vol_3y: float | None = None
    sharpe_3y: float | None = None
    sortino_3y: float | None = None
    max_drawdown: float | None = None
    calmar_3y: float | None = None
    positive_months: float | None = None
    consistency: float | None = None
    sip_xirr: float | None = None
    momentum_12m: float | None = None
    beta: float | None = None
    alpha: float | None = None


class Allocation(FundOut):
    weight: float
    equity_share: float
    amount: float


class RecommendRequest(BaseModel):
    age: int = Field(30, ge=18, le=100)
    horizon_years: int = Field(15, ge=1, le=40)
    risk_tolerance: int = Field(4, ge=1, le=5)
    mode: Literal["sip", "lumpsum"] = "sip"
    amount: float = Field(10_000, gt=0)


class RecommendationInputs(BaseModel):
    age: int
    horizon_years: int
    risk_tolerance: int
    mode: str
    amount: float


class Bucket(BaseModel):
    bucket: str
    share: float
    amount: float


class Performance(BaseModel):
    cagr: float | None
    volatility: float | None
    sharpe: float | None
    max_drawdown: float | None


class BacktestPoint(BaseModel):
    date: str
    portfolio: float
    market: float


class Backtest(BaseModel):
    portfolio: Performance
    market: Performance
    sip_xirr: float | None
    history: list[BacktestPoint] = Field(default_factory=list)


class ProjectionBand(BaseModel):
    month: int
    p5: float
    p25: float
    p50: float
    p75: float
    p95: float


class Projection(BaseModel):
    months: int
    invested: float
    median: float
    p5: float
    p95: float
    prob_below_contributions: float
    median_max_drawdown: float
    worst_5pct_drawdown: float
    bands: list[ProjectionBand] = Field(default_factory=list)
    invested_path: list[float] = Field(default_factory=list)


class RecommendResponse(BaseModel):
    inputs: RecommendationInputs
    equity_target: float
    debt_gap: float
    category_targets: dict[str, float]
    allocations: list[Allocation]
    buckets: list[Bucket]
    backtest: Backtest
    projection: Projection
    warnings: list[str]
    disclaimer: str


class HealthResponse(BaseModel):
    status: Literal["empty", "building", "ready", "error"]
    funds: int
    selected: int
    built_at: str | None = None
    error: str | None = None


class RefreshResponse(BaseModel):
    started: bool
    status: str


class MetaResponse(BaseModel):
    risk_free: float
    top_n: int
    base_quota: int
    min_years: float
    min_obs: int
    categories: list[str]
    score_weights: dict[str, float]
    profiles: dict[str, dict[str, float]]
    disclaimer: str


class OverviewResponse(BaseModel):
    status: str
    funds: int
    selected: int
    built_at: str | None = None
    error: str | None = None
    stats: dict = Field(default_factory=dict)
    category_counts: dict[str, int] = Field(default_factory=dict)
    top_category_counts: dict[str, int] = Field(default_factory=dict)
    categories: list[str] = Field(default_factory=list)
    score_weights: dict[str, float] = Field(default_factory=dict)
    risk_free: float
    disclaimer: str


class NavPoint(BaseModel):
    date: str
    nav: float


class FundNavResponse(BaseModel):
    code: int
    name: str
    points: list[NavPoint]


class ScorePart(BaseModel):
    metric: str
    label: str
    value: float | None
    percentile: float | None
    weight: float
    contribution: float | None


class ScoreResponse(BaseModel):
    code: int
    name: str
    category: str
    score: float | None
    rank: int | None
    available_weight: float
    parts: list[ScorePart]
    missing: list[str]
