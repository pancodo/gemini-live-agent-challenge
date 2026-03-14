"""Shared GCS signing credentials helper for the agent orchestrator.

Supports both service account keys (direct signing) and user/ADC
credentials (IAM signBlob via service account impersonation).
"""
from __future__ import annotations

import os

import google.auth

_signing_creds = None


def get_signing_credentials():
    """Return credentials capable of signing GCS URLs."""
    global _signing_creds
    if _signing_creds is not None:
        return _signing_creds

    credentials, project = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    if hasattr(credentials, "signer") and hasattr(credentials, "service_account_email"):
        _signing_creds = credentials
    else:
        from google.auth import impersonated_credentials
        sa_email = os.environ.get(
            "SIGNING_SERVICE_ACCOUNT",
            f"historian-api@{project}.iam.gserviceaccount.com",
        )
        _signing_creds = impersonated_credentials.Credentials(
            source_credentials=credentials,
            target_principal=sa_email,
            target_scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
    return _signing_creds
