terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ─────────────────────────────────────────────
# Variables
# ─────────────────────────────────────────────

variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "reference-tine-482314-c6"
}

variable "region" {
  description = "Primary GCP region"
  type        = string
  default     = "us-central1"
}

variable "gemini_api_key" {
  description = "Google AI (Gemini) API key — stored in Secret Manager"
  type        = string
  sensitive   = true
  default     = ""
}

# ─────────────────────────────────────────────
# Enable Required APIs
# ─────────────────────────────────────────────

resource "google_project_service" "run" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "firestore" {
  service            = "firestore.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "storage" {
  service            = "storage.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "pubsub" {
  service            = "pubsub.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "documentai" {
  service            = "documentai.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "vertexai" {
  service            = "aiplatform.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifactregistry" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

# ─────────────────────────────────────────────
# Service Account
# ─────────────────────────────────────────────

resource "google_service_account" "historian_sa" {
  account_id   = "historian-backend"
  display_name = "AI Historian Backend Service Account"
}

resource "google_project_iam_member" "sa_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.historian_sa.email}"
}

resource "google_project_iam_member" "sa_storage" {
  project = var.project_id
  role    = "roles/storage.admin"
  member  = "serviceAccount:${google_service_account.historian_sa.email}"
}

resource "google_project_iam_member" "sa_pubsub" {
  project = var.project_id
  role    = "roles/pubsub.editor"
  member  = "serviceAccount:${google_service_account.historian_sa.email}"
}

resource "google_project_iam_member" "sa_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.historian_sa.email}"
}

resource "google_project_iam_member" "sa_documentai" {
  project = var.project_id
  role    = "roles/documentai.apiUser"
  member  = "serviceAccount:${google_service_account.historian_sa.email}"
}

resource "google_project_iam_member" "sa_secretmanager" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.historian_sa.email}"
}

resource "google_project_iam_member" "sa_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.historian_sa.email}"
}

# ─────────────────────────────────────────────
# Secret Manager — Gemini API Key
# ─────────────────────────────────────────────

resource "google_secret_manager_secret" "gemini_api_key" {
  secret_id = "gemini-api-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "gemini_api_key_v1" {
  secret      = google_secret_manager_secret.gemini_api_key.id
  secret_data = var.gemini_api_key

  lifecycle {
    ignore_changes = [secret_data]
  }
}

# ─────────────────────────────────────────────
# Firestore Database
# ─────────────────────────────────────────────

resource "google_firestore_database" "historian" {
  name        = "(default)"
  location_id = "us-central"
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.firestore]
}

# ─────────────────────────────────────────────
# GCS Buckets
# ─────────────────────────────────────────────

resource "google_storage_bucket" "historian_docs" {
  name                        = "historian-docs-${var.project_id}"
  location                    = "US-CENTRAL1"
  uniform_bucket_level_access = true
  force_destroy               = false

  cors {
    origin          = ["*"]
    method          = ["GET", "PUT", "POST", "HEAD"]
    response_header = ["Content-Type", "Authorization"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    action { type = "Delete" }
    condition { age = 30 }
  }

  depends_on = [google_project_service.storage]
}

resource "google_storage_bucket" "historian_assets" {
  name                        = "historian-assets-${var.project_id}"
  location                    = "US-CENTRAL1"
  uniform_bucket_level_access = true
  force_destroy               = false

  cors {
    origin          = ["*"]
    method          = ["GET"]
    response_header = ["Content-Type"]
    max_age_seconds = 3600
  }

  depends_on = [google_project_service.storage]
}

# ─────────────────────────────────────────────
# Pub/Sub Topics & Subscriptions
# ─────────────────────────────────────────────

locals {
  pubsub_topics = [
    "document-scanned",
    "scan-complete",
    "segment-ready",
    "session-ended",
  ]
}

resource "google_pubsub_topic" "topics" {
  for_each = toset(local.pubsub_topics)
  name     = each.key

  depends_on = [google_project_service.pubsub]
}

resource "google_pubsub_subscription" "subscriptions" {
  for_each = toset(local.pubsub_topics)
  name     = "${each.key}-sub"
  topic    = google_pubsub_topic.topics[each.key].name

  ack_deadline_seconds       = 60
  message_retention_duration = "3600s"

  retry_policy {
    minimum_backoff = "5s"
    maximum_backoff = "60s"
  }
}

# ─────────────────────────────────────────────
# Artifact Registry — Docker images
# ─────────────────────────────────────────────

resource "google_artifact_registry_repository" "historian" {
  location      = var.region
  repository_id = "historian"
  format        = "DOCKER"

  depends_on = [google_project_service.artifactregistry]
}

# ─────────────────────────────────────────────
# Cloud Run — historian-api (FastAPI gateway)
# ─────────────────────────────────────────────

resource "google_cloud_run_v2_service" "historian_api" {
  name     = "historian-api"
  location = var.region

  template {
    service_account = google_service_account.historian_sa.email

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/historian/historian-api:latest"

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCS_BUCKET_NAME"
        value = google_storage_bucket.historian_docs.name
      }
      env {
        name  = "GCS_ASSETS_BUCKET"
        value = google_storage_bucket.historian_assets.name
      }
      env {
        name  = "VERTEX_AI_LOCATION"
        value = var.region
      }
      env {
        name  = "GOOGLE_GENAI_USE_VERTEXAI"
        value = "1"
      }
      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = var.region
      }
      env {
        name = "DOCUMENT_AI_PROCESSOR_NAME"
        value_source {
          secret_key_ref {
            secret  = "document-ai-processor-name"
            version = "latest"
          }
        }
      }

      ports {
        container_port = 8080
      }

      startup_probe {
        http_get { path = "/health" }
        initial_delay_seconds = 10
        period_seconds        = 5
        failure_threshold     = 10
      }

      liveness_probe {
        http_get { path = "/health" }
        period_seconds = 30
      }
    }
  }

  depends_on = [
    google_project_service.run,
    google_service_account.historian_sa,
  ]
}

# Allow unauthenticated access to historian-api (judges need to reach it)
resource "google_cloud_run_v2_service_iam_member" "historian_api_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.historian_api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─────────────────────────────────────────────
# Cloud Run — agent-orchestrator (ADK pipeline)
# ─────────────────────────────────────────────

resource "google_cloud_run_v2_service" "agent_orchestrator" {
  name     = "agent-orchestrator"
  location = var.region

  template {
    service_account = google_service_account.historian_sa.email

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/historian/agent-orchestrator:latest"

      resources {
        limits = {
          cpu    = "4"
          memory = "4Gi"
        }
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCS_BUCKET_NAME"
        value = google_storage_bucket.historian_docs.name
      }
      env {
        name  = "GCS_ASSETS_BUCKET"
        value = google_storage_bucket.historian_assets.name
      }
      env {
        name  = "VERTEX_AI_LOCATION"
        value = var.region
      }
      env {
        name  = "GOOGLE_GENAI_USE_VERTEXAI"
        value = "1"
      }
      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = var.region
      }

      ports {
        container_port = 8080
      }

      startup_probe {
        http_get { path = "/health" }
        initial_delay_seconds = 15
        period_seconds        = 5
        failure_threshold     = 12
      }
    }
  }

  depends_on = [
    google_project_service.run,
    google_service_account.historian_sa,
  ]
}

# ─────────────────────────────────────────────
# Cloud Run — live-relay (Node.js WebSocket proxy)
# ─────────────────────────────────────────────

resource "google_cloud_run_v2_service" "live_relay" {
  name     = "live-relay"
  location = var.region

  template {
    service_account = google_service_account.historian_sa.email

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/historian/live-relay:latest"

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.gemini_api_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "GEMINI_MODEL"
        value = "gemini-2.5-flash-native-audio-preview-12-2025"
      }

      ports {
        container_port = 8080
      }
    }
  }

  depends_on = [
    google_project_service.run,
    google_service_account.historian_sa,
    google_secret_manager_secret_version.gemini_api_key_v1,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "live_relay_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.live_relay.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─────────────────────────────────────────────
# Document AI secret (processor name)
# ─────────────────────────────────────────────

resource "google_secret_manager_secret" "documentai_processor" {
  secret_id = "document-ai-processor-name"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

# ─────────────────────────────────────────────
# Outputs
# ─────────────────────────────────────────────

output "historian_api_url" {
  description = "historian-api Cloud Run URL"
  value       = google_cloud_run_v2_service.historian_api.uri
}

output "agent_orchestrator_url" {
  description = "agent-orchestrator Cloud Run URL"
  value       = google_cloud_run_v2_service.agent_orchestrator.uri
}

output "live_relay_url" {
  description = "live-relay Cloud Run URL"
  value       = google_cloud_run_v2_service.live_relay.uri
}

output "historian_docs_bucket" {
  description = "GCS bucket for uploaded documents"
  value       = google_storage_bucket.historian_docs.name
}

output "historian_assets_bucket" {
  description = "GCS bucket for generated images and videos"
  value       = google_storage_bucket.historian_assets.name
}

output "artifact_registry" {
  description = "Docker image registry path"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/historian"
}
