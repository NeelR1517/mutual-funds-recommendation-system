"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api import funds, recommend, system
from .config import FRONTEND_DIR
from .store import DataStore

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    store = DataStore()
    app.state.store = store

    if store.load():
        logger.info("Loaded cached dataset")
    else:
        logger.info("No cached dataset; building in background")
        store.start_refresh()

    yield


app = FastAPI(
    title="Mutual Fund Recommender API",
    description="Category-relative fund scoring and investor-specific portfolios from mfapi.in data.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router)
app.include_router(funds.router)
app.include_router(recommend.router)

# Serve the UI from the same origin so the frontend can use relative API paths.
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
