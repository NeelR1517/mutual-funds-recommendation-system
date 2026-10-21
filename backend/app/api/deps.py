"""Shared route dependencies."""

from fastapi import Depends, HTTPException, Request

from ..store import Dataset, DataStore


def get_store(request: Request) -> DataStore:
    return request.app.state.store


def get_dataset(store: DataStore = Depends(get_store)) -> Dataset:
    dataset = store.dataset
    if dataset is None:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "Dataset is not ready.",
                "status": store.status,
                "error": store.error,
            },
        )
    return dataset
