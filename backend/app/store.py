"""Dataset build, persistence and readiness state."""

from __future__ import annotations

import logging
import pickle
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from .config import DATASET_PATH
from .services.metrics import benchmark_returns, compute_metrics
from .services.mfapi import fetch_master
from .services.scoring import score_funds, select_top
from .services.universe import (
    candidate_schemes,
    load_funds,
    load_navs,
    monthly_returns,
    quality_filter,
)

logger = logging.getLogger(__name__)


@dataclass
class Dataset:
    funds: pd.DataFrame
    returns: pd.DataFrame
    market: pd.Series
    stats: dict
    built_at: str


def build_dataset() -> Dataset:
    logger.info("Fetching scheme list")
    master = fetch_master()
    candidates = candidate_schemes(master)

    logger.info("Loading %s Direct-Growth schemes", len(candidates))
    funds = load_funds(candidates)
    categorized = len(funds)

    logger.info("Loading NAV history for %s funds", categorized)
    navs = load_navs(funds["code"].tolist())
    funds, navs = quality_filter(funds, navs)

    monthly_nav, returns = monthly_returns(navs)
    market = benchmark_returns(returns, funds)
    funds = compute_metrics(funds, returns, monthly_nav, navs, market)
    funds = select_top(score_funds(funds))

    stats = {
        "schemes_total": len(master),
        "direct_growth": len(candidates),
        "categorized": int(categorized),
        "quality": len(funds),
        "selected": int(funds["selected"].sum()),
        "nav_points": len(navs),
        "last_nav_date": funds["last"].max().date().isoformat(),
    }

    logger.info(
        "Dataset ready: %s funds, %s selected", stats["quality"], stats["selected"]
    )
    return Dataset(
        funds=funds,
        returns=returns,
        market=market,
        stats=stats,
        built_at=datetime.now(UTC).isoformat(timespec="seconds"),
    )


def _save(path: Path, dataset: Dataset) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with open(temporary, "wb") as file:
        pickle.dump(dataset, file)
    temporary.replace(path)


def _load(path: Path) -> Dataset:
    with open(path, "rb") as file:
        return pickle.load(file)


class DataStore:
    def __init__(self, path: Path = DATASET_PATH):
        self.path = path
        self._dataset: Dataset | None = None
        self._status = "empty"
        self._error: str | None = None
        self._lock = threading.Lock()

    @property
    def dataset(self) -> Dataset | None:
        with self._lock:
            return self._dataset

    @property
    def status(self) -> str:
        with self._lock:
            return self._status

    @property
    def error(self) -> str | None:
        with self._lock:
            return self._error

    def snapshot(self) -> dict:
        with self._lock:
            dataset = self._dataset
            stats = dataset.stats if dataset else {}
            return {
                "status": self._status,
                "funds": len(dataset.funds) if dataset else 0,
                "selected": int(stats.get("selected", 0)),
                "built_at": dataset.built_at if dataset else None,
                "error": self._error,
            }

    def load(self) -> bool:
        if not self.path.exists():
            return False

        try:
            dataset = _load(self.path)
        except Exception as exc:
            logger.warning("Could not read dataset cache: %s", exc)
            return False

        with self._lock:
            self._dataset = dataset
            self._status = "ready"
        return True

    def start_refresh(self) -> bool:
        with self._lock:
            if self._status == "building":
                return False
            self._status = "building"
            self._error = None

        threading.Thread(target=self._build, daemon=True, name="dataset-build").start()
        return True

    def _build(self) -> None:
        try:
            dataset = build_dataset()
            _save(self.path, dataset)
        except Exception as exc:
            logger.exception("Dataset build failed")
            with self._lock:
                self._status = "error"
                self._error = str(exc)
            return

        with self._lock:
            self._dataset = dataset
            self._status = "ready"
            self._error = None
