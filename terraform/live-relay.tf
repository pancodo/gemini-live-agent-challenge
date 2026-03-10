data "google_project" "project" {}

# Secret Manager: Store the Gemini API key
resource "google_secret_manager_secret" "gemini_api_key" {
  secret_id = "gemini-api-key"

  replication {
    auto {}
  }
}

# Secret Manager: Store the API key version
resource "google_secret_manager_secret_version" "gemini_api_key" {
  secret      = google_secret_manager_secret.gemini_api_key.id
  secret_data = var.gemini_api_key
}

# Cloud Run Service: live-relay WebSocket proxy
resource "google_cloud_run_v2_service" "live_relay" {
  name     = "live-relay"
  location = var.region

  template {
    containers {
      image = "gcr.io/${var.project_id}/live-relay:latest"

      ports {
        container_port = 8080
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

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }
    }

    timeout = "3600s"
    max_instance_request_concurrency = 100
    session_affinity = true

    service_account = google_service_account.live_relay.email
  }

  scaling {
    min_instance_count = 0
    max_instance_count = 5
  }

  depends_on = [google_secret_manager_secret_version.gemini_api_key]
}

# Service Account for live-relay
resource "google_service_account" "live_relay" {
  account_id   = "live-relay-service"
  display_name = "Service account for live-relay Cloud Run service"
}

# IAM: Allow unauthenticated access to live-relay
resource "google_cloud_run_v2_service_iam_member" "live_relay_public" {
  service  = google_cloud_run_v2_service.live_relay.name
  location = google_cloud_run_v2_service.live_relay.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# IAM: Grant live-relay service account access to Secret Manager
resource "google_project_iam_member" "live_relay_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.live_relay.email}"
}

# Output: live-relay service URL
output "live_relay_url" {
  description = "The URL of the live-relay Cloud Run service"
  value       = google_cloud_run_v2_service.live_relay.uri
}
