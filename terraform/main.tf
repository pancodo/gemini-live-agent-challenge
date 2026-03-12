# ============================================================
# AI Historian — Complete Google Cloud Infrastructure
# ============================================================
# Usage:
#   cp terraform.tfvars.example terraform.tfvars
#   # edit terraform.tfvars with real values
#   terraform init
#   terraform plan
#   terraform apply
#
# First deploy: Cloud Run services use gcr.io/cloudrun/hello
# as a placeholder image. Push real images to Artifact Registry
# then re-apply or use `gcloud run deploy`.
# ============================================================

terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.44"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.44"
    }
  }

  # Uncomment after creating the state bucket manually or via:
  #   gsutil mb -l us-central1 gs://YOUR_PROJECT-tf-state
  #   gsutil versioning set on gs://YOUR_PROJECT-tf-state
  #
  # backend "gcs" {
  #   bucket = "YOUR_PROJECT-tf-state"
  #   prefix = "historian"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# ─────────────────────────────────────────────
# Variables
# ─────────────────────────────────────────────

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "Primary GCP region"
  type        = string
  default     = "us-central1"
}

variable "gemini_api_key" {
  description = "Google AI (Gemini) API key for live-relay — stored in Secret Manager"
  type        = string
  sensitive   = true
  default     = ""
}

variable "environment" {
  description = "Deployment environment label"
  type        = string
  default     = "production"
}

# Placeholder image used on first terraform apply before real
# container images are pushed to Artifact Registry.
variable "placeholder_image" {
  description = "Container image used before real images exist"
  type        = string
  default     = "gcr.io/cloudrun/hello"
}

variable "deploy_real_images" {
  description = "Set true after pushing images to Artifact Registry"
  type        = bool
  default     = false
}

locals {
  # When deploy_real_images=false, all three services use the
  # placeholder. Flip to true after CI pushes real images.
  registry_prefix = "${var.region}-docker.pkg.dev/${var.project_id}/historian"
  images = {
    historian_api      = var.deploy_real_images ? "${local.registry_prefix}/historian-api:latest" : var.placeholder_image
    agent_orchestrator = var.deploy_real_images ? "${local.registry_prefix}/agent-orchestrator:latest" : var.placeholder_image
    live_relay         = var.deploy_real_images ? "${local.registry_prefix}/live-relay:latest" : var.placeholder_image
  }

  # Common labels applied to every resource that supports them.
  common_labels = {
    project     = "ai-historian"
    environment = var.environment
    managed_by  = "terraform"
  }
}

# ─────────────────────────────────────────────
# Enable Required APIs
# ─────────────────────────────────────────────

locals {
  required_apis = [
    "run.googleapis.com",
    "firestore.googleapis.com",
    "storage.googleapis.com",
    "pubsub.googleapis.com",
    "documentai.googleapis.com",
    "secretmanager.googleapis.com",
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com",
    "generativelanguage.googleapis.com",
    "iam.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.required_apis)
  service            = each.key
  disable_on_destroy = false
}

# ─────────────────────────────────────────────
# Service Account
# ─────────────────────────────────────────────

resource "google_service_account" "historian_sa" {
  account_id   = "historian-backend"
  display_name = "AI Historian Backend Service Account"

  depends_on = [google_project_service.apis["iam.googleapis.com"]]
}

# IAM roles needed by all three Cloud Run services.
locals {
  sa_roles = [
    "roles/datastore.user",           # Firestore read/write
    "roles/storage.admin",            # GCS upload/download/signed URLs
    "roles/pubsub.editor",           # Pub/Sub publish + subscribe
    "roles/aiplatform.user",         # Vertex AI (Imagen 3, Veo 2, Gemini)
    "roles/documentai.apiUser",      # Document AI OCR
    "roles/secretmanager.secretAccessor", # Read secrets at runtime
    "roles/run.invoker",             # Service-to-service calls
    "roles/logging.logWriter",       # Structured logging from Cloud Run
  ]
}

resource "google_project_iam_member" "sa_roles" {
  for_each = toset(local.sa_roles)

  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.historian_sa.email}"
}

# ─────────────────────────────────────────────
# Secret Manager
# ─────────────────────────────────────────────

resource "google_secret_manager_secret" "gemini_api_key" {
  secret_id = "gemini-api-key"

  replication {
    auto {}
  }

  labels = local.common_labels

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "gemini_api_key_v1" {
  secret      = google_secret_manager_secret.gemini_api_key.id
  secret_data = var.gemini_api_key

  lifecycle {
    # After initial creation the key is managed in Console / CLI.
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret" "documentai_processor" {
  secret_id = "document-ai-processor-name"

  replication {
    auto {}
  }

  labels = local.common_labels

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

# Note: Document AI processor name secret version must be created
# manually after setting up the processor:
#   echo -n "projects/P/locations/us/processors/X" | \
#     gcloud secrets versions add document-ai-processor-name --data-file=-

# ─────────────────────────────────────────────
# Firestore Database
# ─────────────────────────────────────────────

resource "google_firestore_database" "historian" {
  provider = google-beta

  project                     = var.project_id
  name                        = "(default)"
  location_id                 = "nam5"
  type                        = "FIRESTORE_NATIVE"
  concurrency_mode            = "OPTIMISTIC"
  app_engine_integration_mode = "DISABLED"

  depends_on = [google_project_service.apis["firestore.googleapis.com"]]
}

# Composite index for session queries (status + createdAt ordering).
resource "google_firestore_index" "sessions_by_status" {
  provider = google-beta

  project    = var.project_id
  database   = google_firestore_database.historian.name
  collection = "sessions"

  fields {
    field_path = "status"
    order      = "ASCENDING"
  }
  fields {
    field_path = "createdAt"
    order      = "DESCENDING"
  }

  depends_on = [google_firestore_database.historian]
}

# ─────────────────────────────────────────────
# GCS Buckets
# ─────────────────────────────────────────────

resource "google_storage_bucket" "historian_docs" {
  name                        = "historian-docs-${var.project_id}"
  location                    = "US-CENTRAL1"
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  force_destroy               = false

  labels = local.common_labels

  cors {
    origin          = ["*"]
    method          = ["GET", "PUT", "POST", "HEAD"]
    response_header = ["Content-Type", "Authorization", "Content-Length"]
    max_age_seconds = 3600
  }

  # Uploaded documents expire after 30 days.
  lifecycle_rule {
    action { type = "Delete" }
    condition { age = 30 }
  }

  depends_on = [google_project_service.apis["storage.googleapis.com"]]
}

resource "google_storage_bucket" "historian_assets" {
  name                        = "historian-assets-${var.project_id}"
  location                    = "US-CENTRAL1"
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  force_destroy               = false

  labels = local.common_labels

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type", "Content-Length"]
    max_age_seconds = 3600
  }

  # Generated images and videos expire after 7 days.
  lifecycle_rule {
    action { type = "Delete" }
    condition { age = 7 }
  }

  depends_on = [google_project_service.apis["storage.googleapis.com"]]
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
  labels   = local.common_labels

  depends_on = [google_project_service.apis["pubsub.googleapis.com"]]
}

resource "google_pubsub_subscription" "subscriptions" {
  for_each = toset(local.pubsub_topics)
  name     = "${each.key}-sub"
  topic    = google_pubsub_topic.topics[each.key].name
  labels   = local.common_labels

  ack_deadline_seconds       = 60
  message_retention_duration = "3600s"
  expiration_policy {
    ttl = "" # never expires
  }

  retry_policy {
    minimum_backoff = "5s"
    maximum_backoff = "60s"
  }
}

# ─────────────────────────────────────────────
# Artifact Registry
# ─────────────────────────────────────────────

resource "google_artifact_registry_repository" "historian" {
  location      = var.region
  repository_id = "historian"
  description   = "AI Historian Docker images"
  format        = "DOCKER"
  labels        = local.common_labels

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"

    most_recent_versions {
      keep_count = 5
    }
  }

  depends_on = [google_project_service.apis["artifactregistry.googleapis.com"]]
}

# ─────────────────────────────────────────────
# Cloud Run — historian-api (FastAPI gateway)
# ─────────────────────────────────────────────

resource "google_cloud_run_v2_service" "historian_api" {
  name     = "historian-api"
  location = var.region
  labels   = local.common_labels

  template {
    service_account                  = google_service_account.historian_sa.email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    max_instance_request_concurrency = 80
    timeout                          = "300s"

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    containers {
      image = local.images.historian_api

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
        cpu_idle = true # scale down CPU when idle (cost saving)
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
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      # AGENT_ORCHESTRATOR_URL is set after first apply via:
      #   gcloud run services update historian-api --region=REGION \
      #     --update-env-vars AGENT_ORCHESTRATOR_URL=$(terraform output -raw agent_orchestrator_url)
      # Cannot reference agent_orchestrator.uri here (circular dependency).
      env {
        name  = "AGENT_ORCHESTRATOR_URL"
        value = "https://agent-orchestrator-placeholder.${var.region}.run.app"
      }
      env {
        name = "DOCUMENT_AI_PROCESSOR_NAME"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.documentai_processor.secret_id
            version = "latest"
          }
        }
      }

      ports {
        container_port = 8080
      }

      startup_probe {
        http_get { path = "/health" }
        initial_delay_seconds = 5
        period_seconds        = 3
        failure_threshold     = 10
      }

      liveness_probe {
        http_get { path = "/health" }
        period_seconds = 30
      }
    }
  }

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_service_account.historian_sa,
    google_secret_manager_secret.documentai_processor,
  ]

  lifecycle {
    ignore_changes = [
      # CI/CD updates the image tag directly via gcloud.
      template[0].containers[0].image,
    ]
  }
}

# Allow unauthenticated access (judges + frontend need to reach it).
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
  labels   = local.common_labels

  template {
    service_account                  = google_service_account.historian_sa.email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    max_instance_request_concurrency = 10
    # Pipeline runs can take several minutes (OCR + research + visuals).
    timeout = "900s"

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = local.images.agent_orchestrator

      resources {
        limits = {
          cpu    = "4"
          memory = "4Gi"
        }
        cpu_idle          = false # keep CPU allocated during pipeline
        startup_cpu_boost = true  # faster cold start
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
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name = "DOCUMENT_AI_PROCESSOR_NAME"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.documentai_processor.secret_id
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
        failure_threshold     = 12
      }

      liveness_probe {
        http_get { path = "/health" }
        period_seconds = 60
      }
    }
  }

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_service_account.historian_sa,
    google_secret_manager_secret.documentai_processor,
  ]

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
    ]
  }
}

# Agent orchestrator is called by historian-api (service-to-service),
# but also allow public for SSE streaming to frontend.
resource "google_cloud_run_v2_service_iam_member" "agent_orchestrator_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.agent_orchestrator.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─────────────────────────────────────────────
# Cloud Run — live-relay (Node.js WebSocket proxy)
# ─────────────────────────────────────────────

resource "google_cloud_run_v2_service" "live_relay" {
  name     = "live-relay"
  location = var.region
  labels   = local.common_labels

  template {
    service_account                  = google_service_account.historian_sa.email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    max_instance_request_concurrency = 50
    # WebSocket sessions last up to 15 minutes.
    timeout = "3600s"
    session_affinity = true # sticky sessions for WebSocket

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    containers {
      image = local.images.live_relay

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        cpu_idle = false # keep CPU for active WebSocket connections
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
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
      env {
        name  = "HISTORIAN_API_URL"
        value = google_cloud_run_v2_service.historian_api.uri
      }

      ports {
        container_port = 8080
      }

      startup_probe {
        http_get { path = "/health" }
        initial_delay_seconds = 3
        period_seconds        = 3
        failure_threshold     = 5
      }

      liveness_probe {
        http_get { path = "/health" }
        period_seconds = 30
      }
    }
  }

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_service_account.historian_sa,
    google_secret_manager_secret_version.gemini_api_key_v1,
  ]

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "live_relay_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.live_relay.name
  role     = "roles/run.invoker"
  member   = "allUsers"
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

output "service_account_email" {
  description = "Shared service account email for all Cloud Run services"
  value       = google_service_account.historian_sa.email
}

output "firestore_database" {
  description = "Firestore database name"
  value       = google_firestore_database.historian.name
}

output "project_id" {
  description = "GCP project ID"
  value       = var.project_id
}

output "region" {
  description = "GCP region"
  value       = var.region
}
