# Stream Agents

Personal Life Stream processing framework (DB -> Kafka -> Agents).

## Infrastructure (Amazon MSK)

We use Terraform to manage the Kafka cluster.

### Prerequisites
- Terraform installed
- AWS Credentials configured (profile `irbull-msk`)

### 🚀 Starting the Cluster (The "Two-Step")
Because of AWS limitations, enabling Public Access requires a specific sequence:

1. **Create Cluster** (Public Access DISABLED):
   ```bash
   export AWS_PROFILE=irbull-msk
   cd infrastructure
   terraform apply
   ```
   *Wait ~30-40 mins.*

2. **Enable Public Access**:
   ```bash
   terraform apply -var="public_access_type=SERVICE_PROVIDED_EIPS"
   ```
   *Wait ~15-20 mins.*

### 🛑 Stopping the Cluster
To save money (~$2/day), destroy the cluster when not in use:
```bash
export AWS_PROFILE=irbull-msk
cd infrastructure
terraform destroy
```

### Connection Details
Run this to get the connection string:
```bash
cd infrastructure
terraform output bootstrap_brokers_public_sasl_iam
```
