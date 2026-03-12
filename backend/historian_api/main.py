"""FastAPI application entry point for historian_api."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import session as session_router
from .routes import pipeline as pipeline_router
from .routes import retrieve as retrieve_router
from .routes import illustrate as illustrate_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Warm up lazy singletons before first request."""
    try:
        retrieve_router._get_db()
        retrieve_router._get_client()
        logger.info("Startup: retrieve singletons warmed up")
    except Exception as exc:
        logger.warning("Startup warmup failed (non-fatal): %s", exc)
    yield


app = FastAPI(title="AI Historian API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(session_router.router, prefix="/api")
app.include_router(pipeline_router.router, prefix="/api")
app.include_router(retrieve_router.router, prefix="/api")
app.include_router(illustrate_router.router, prefix="/api")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
