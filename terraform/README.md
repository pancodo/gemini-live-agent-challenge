## Deploy

1. Install Terraform >= 1.6
2. Copy and fill in variables:
   ```
   cp terraform.tfvars.example terraform.tfvars
   ```
3. Initialize and apply:
   ```
   terraform init
   terraform plan
   terraform apply
   ```
4. After first apply, update the historian-api service with the real orchestrator URL:
   ```
   gcloud run services update historian-api \
     --region=$(terraform output -raw region 2>/dev/null || echo us-central1) \
     --update-env-vars AGENT_ORCHESTRATOR_URL=$(terraform output -raw agent_orchestrator_url)
   ```
5. (Optional) Enable remote state backend by uncommenting the `backend "gcs"` block in `main.tf` and creating the bucket:
   ```
   gsutil mb -l us-central1 gs://YOUR_PROJECT-tf-state
   gsutil versioning set on gs://YOUR_PROJECT-tf-state
   terraform init -migrate-state
   ```
