"""Global rate limiter for Gemini and Imagen API calls.

Provides a ``GlobalRateLimiter`` that wraps an ``asyncio.Semaphore`` with
in-flight tracking and logging, and a ``rate_limited_generate`` helper that
adds automatic retry with exponential backoff for 429/503/500 errors.

Usage::

    gemini_limiter = GlobalRateLimiter(limit=12, label="gemini")
    imagen_limiter = GlobalRateLimiter(limit=8, label="imagen")

    # Direct semaphore usage
    async with gemini_limiter.acquire(caller="script_agent"):
        response = await client.aio.models.generate_content(...)

    # Or use the retry helper
    response = await rate_limited_generate(
        client, gemini_limiter,
        model="gemini-2.0-flash",
        contents="...",
        caller="fact_validator",
    )
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator
from typing import Any

logger = logging.getLogger(__name__)


class GlobalRateLimiter:
    """Concurrency limiter with in-flight tracking and wait-time warnings.

    Wraps an ``asyncio.Semaphore`` and adds:
    - In-flight request counter (``in_flight`` property).
    - Logging when a caller is queued (semaphore full).
    - Warning when a caller waits longer than 10 seconds.

    Args:
        limit: Maximum concurrent requests (semaphore value).
        label: Human-readable label for logging (e.g. "gemini", "imagen").
    """

    def __init__(self, limit: int = 12, label: str = "gemini") -> None:
        self._sem = asyncio.Semaphore(limit)
        self._limit = limit
        self._label = label
        self._in_flight: int = 0

    @property
    def in_flight(self) -> int:
        """Current number of in-flight requests."""
        return self._in_flight

    @property
    def limit(self) -> int:
        """Configured concurrency limit."""
        return self._limit

    @asynccontextmanager
    async def acquire(self, caller: str = "") -> AsyncGenerator[None, None]:
        """Acquire a rate-limit slot with tracking and logging.

        Args:
            caller: Descriptive label for the caller (for log messages).

        Yields:
            None -- the caller proceeds with its API call inside the context.
        """
        caller_label = f"[{self._label}] {caller}" if caller else f"[{self._label}]"

        # Check if we need to wait
        if self._sem.locked():
            logger.info(
                "%s queued (%d/%d in flight)",
                caller_label,
                self._in_flight,
                self._limit,
            )

        t_wait_start = time.monotonic()

        await self._sem.acquire()
        self._in_flight += 1

        t_waited = time.monotonic() - t_wait_start
        if t_waited > 10.0:
            logger.warning(
                "%s waited %.1fs for rate-limit slot (%d/%d in flight)",
                caller_label,
                t_waited,
                self._in_flight,
                self._limit,
            )

        try:
            yield
        finally:
            self._in_flight -= 1
            self._sem.release()


# ---------------------------------------------------------------------------
# Backoff schedule: attempt 0 -> 1.0s, attempt 1 -> 2.5s, attempt 2 -> 4.5s
# ---------------------------------------------------------------------------

_BACKOFF_SCHEDULE: list[float] = [1.0, 2.5, 4.5]

# HTTP status codes that trigger a retry
_RETRYABLE_STATUS_CODES: set[int] = {429, 500, 503}


def _extract_retry_after(exc: Exception) -> float | None:
    """Try to extract a Retry-After hint (in seconds) from an API exception.

    Checks for:
    - ``exc.retry_delay`` (``datetime.timedelta``, used by ``google.api_core``
      ``ResourceExhausted`` exceptions).
    - ``exc.retry_after`` (numeric seconds).
    - ``exc.headers["Retry-After"]`` (HTTP header string, numeric seconds).

    Returns:
        The delay in seconds if found and > 0, otherwise ``None``.
    """
    # google.api_core.exceptions.ResourceExhausted → retry_delay (timedelta)
    retry_delay = getattr(exc, "retry_delay", None)
    if retry_delay is not None:
        try:
            seconds = retry_delay.total_seconds()
            if seconds > 0:
                return float(seconds)
        except (AttributeError, TypeError):
            pass

    # Some exception types expose retry_after directly as a number
    retry_after = getattr(exc, "retry_after", None)
    if retry_after is not None:
        try:
            val = float(retry_after)
            if val > 0:
                return val
        except (TypeError, ValueError):
            pass

    # HTTP response headers
    headers = getattr(exc, "headers", None)
    if headers is not None:
        raw = None
        if hasattr(headers, "get"):
            raw = headers.get("Retry-After") or headers.get("retry-after")
        if raw is not None:
            try:
                val = float(raw)
                if val > 0:
                    return val
            except (TypeError, ValueError):
                pass

    return None


def _is_retryable_error(exc: Exception) -> bool:
    """Check if an exception represents a retryable API error.

    Looks for HTTP status codes in common Google API exception formats.
    """
    # google.api_core.exceptions have a .code attribute
    code = getattr(exc, "code", None)
    if code is not None and int(code) in _RETRYABLE_STATUS_CODES:
        return True

    # google-genai may wrap errors with a status_code attribute
    status_code = getattr(exc, "status_code", None)
    if status_code is not None and int(status_code) in _RETRYABLE_STATUS_CODES:
        return True

    # Check the string representation as a fallback
    exc_str = str(exc).lower()
    if "429" in exc_str or "resource exhausted" in exc_str:
        return True
    if "503" in exc_str or "service unavailable" in exc_str:
        return True
    if "500" in exc_str or "internal server error" in exc_str:
        return True

    return False


async def rate_limited_generate(
    client: Any,
    rate_limiter: GlobalRateLimiter,
    *,
    model: str,
    contents: Any,
    config: Any | None = None,
    caller: str = "",
    max_retries: int = 3,
) -> Any:
    """Call ``client.aio.models.generate_content`` with rate limiting and retry.

    Acquires a slot from the rate limiter before each attempt. On retryable
    errors (429, 500, 503), waits according to the backoff schedule and
    retries up to ``max_retries`` times.

    Args:
        client: A ``google.genai.Client`` instance.
        rate_limiter: The ``GlobalRateLimiter`` to use.
        model: Model ID string (e.g. "gemini-2.0-flash").
        contents: Prompt contents for ``generate_content``.
        config: Optional ``GenerateContentConfig``.
        caller: Descriptive label for logging.
        max_retries: Maximum number of retry attempts.

    Returns:
        The ``GenerateContentResponse`` from the API.

    Raises:
        The last exception if all retries are exhausted.
    """
    last_exc: Exception | None = None

    for attempt in range(max_retries):
        try:
            async with rate_limiter.acquire(caller=caller):
                kwargs: dict[str, Any] = {
                    "model": model,
                    "contents": contents,
                }
                if config is not None:
                    kwargs["config"] = config

                response = await client.aio.models.generate_content(**kwargs)
                return response

        except Exception as exc:
            last_exc = exc

            if not _is_retryable_error(exc):
                logger.error(
                    "[%s] %s non-retryable error on attempt %d: %s",
                    rate_limiter._label,  # noqa: SLF001
                    caller,
                    attempt + 1,
                    exc,
                )
                raise

            backoff = (
                _BACKOFF_SCHEDULE[attempt]
                if attempt < len(_BACKOFF_SCHEDULE)
                else _BACKOFF_SCHEDULE[-1]
            )

            # Honor Retry-After from the API if it exceeds our schedule
            retry_after = _extract_retry_after(exc)
            if retry_after is not None and retry_after > backoff:
                logger.info(
                    "[%s] %s server requested Retry-After=%.1fs "
                    "(exceeds backoff=%.1fs)",
                    rate_limiter._label,  # noqa: SLF001
                    caller,
                    retry_after,
                    backoff,
                )
                backoff = retry_after

            logger.warning(
                "[%s] %s retryable error on attempt %d/%d: %s. "
                "Backing off %.1fs.",
                rate_limiter._label,  # noqa: SLF001
                caller,
                attempt + 1,
                max_retries,
                exc,
                backoff,
            )

            await asyncio.sleep(backoff)

    # All retries exhausted
    assert last_exc is not None  # noqa: S101 -- guaranteed by loop logic
    logger.error(
        "[%s] %s all %d retries exhausted. Last error: %s",
        rate_limiter._label,  # noqa: SLF001
        caller,
        max_retries,
        last_exc,
    )
    raise last_exc
