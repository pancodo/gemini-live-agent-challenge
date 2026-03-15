"""FastAPI application entry point for historian_api."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from .routes import session as session_router
from .routes import pipeline as pipeline_router
from .routes import retrieve as retrieve_router
from .routes import illustrate as illustrate_router
from .routes import narrate as narrate_router
from .routes import demo_interleaved as demo_router

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


class AccessCodeMiddleware(BaseHTTPMiddleware):
    """Reject requests to /api/* that lack a valid access code.

    When the ACCESS_CODE env var is unset or empty, all requests pass through
    (dev mode).  Otherwise the code must be provided via:
      - ``X-Access-Code`` header  (REST calls), **or**
      - ``access_code`` query parameter  (SSE EventSource, which cannot send headers).
    """

    async def dispatch(self, request: Request, call_next):
        access_code = os.environ.get("ACCESS_CODE", "")

        # Dev mode — no protection when the env var is absent.
        if not access_code:
            return await call_next(request)

        path = request.url.path

        # Health endpoint is always open.
        if path == "/health":
            return await call_next(request)

        # Only gate /api/* paths.
        if path.startswith("/api"):
            provided = (
                request.headers.get("X-Access-Code")
                or request.query_params.get("access_code")
            )
            if provided != access_code:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Invalid access code"},
                )

        return await call_next(request)


app = FastAPI(title="AI Historian API", version="1.0.0", lifespan=lifespan)

app.add_middleware(AccessCodeMiddleware)

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
app.include_router(narrate_router.router, prefix="/api")
app.include_router(demo_router.router, prefix="/api")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
