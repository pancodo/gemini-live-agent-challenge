"""FastAPI application entry point for historian_api.

Deployed as a Cloud Run service. Mounts all route routers.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import session as session_router
from .routes import pipeline as pipeline_router
from .routes import retrieve as retrieve_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Historian API", version="1.0.0")

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


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
