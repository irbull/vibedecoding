# Stream Agents

Personal Life Stream processing framework (DB -> Kafka -> Agents).

## Infrastructure

We use Terraform to manage the infrastructure. You can choose between **Amazon MSK** (Managed) or **EC2 Kafka** (Self-Managed).

### Prerequisites
- Terraform installed
- AWS Credentials configured

---

### Option A: Amazon MSK (Managed Cluster)
*   **Cost**: ~$70/month (2x t3.small brokers)
*   **Pros**: Fully managed, high availability (Multi-AZ), IAM Auth.
*   **Cons**: Expensive for learning, slow to create.

#### 🚀 Starting MSK (The "Two-Step")
1. **Create Cluster** (Public Access DISABLED):
   ```bash
   cd infrastructure/msk
   terraform apply
   ```
   *Wait ~30-40 mins.*

2. **Enable Public Access**:
   ```bash
   terraform apply -var="public_access_type=SERVICE_PROVIDED_EIPS"
   ```
   *Wait ~15-20 mins.*

#### 🛑 Stopping MSK
```bash
cd infrastructure/msk
terraform destroy
```

---

### Option B: EC2 Kafka (Single Node)
*   **Cost**: ~$15/month (1x t3.small EC2 + EIP)
*   **Pros**: Cheap, fast to spin up (~2 mins).
*   **Cons**: Single point of failure, manual Docker management.

#### 🚀 Starting EC2 Kafka
```bash
cd infrastructure/ec2-kafka
terraform apply
```
*Wait ~2 mins for instance to boot and Docker to pull the image.*

#### 🛑 Stopping EC2 Kafka
```bash
cd infrastructure/ec2-kafka
terraform destroy
```

---

### Connection Details
After starting either option, run:
```bash
terraform output
```
to see the connection string (brokers).

### Auto-Reset on Provisioning
Both Terraform configurations include a `null_resource` that automatically runs `kafka:reset` after the cluster is created. This clears stale DB state (`event_ingest_dedupe`, `kafka_offsets`, `published_to_kafka`) that would otherwise cause the materializer to skip events.

**Requirements** for auto-reset to work:
- `bun` installed on the machine running `terraform apply`
- `.env` file with `DATABASE_URL` and Kafka credentials
- Network access to both Kafka and Postgres

If the auto-reset fails, you can run it manually:
```bash
bun run kafka:reset
```

## Kafka Integration

This project includes scripts to manage topics and stream events from Postgres to Kafka.

### Prerequisites
- **Environment**: Ensure `.env` contains `KAFKA_BROKERS` and `KAFKA_AUTH_METHOD=aws-iam`.

### Architecture

The system uses a **Work Topics** pattern that separates "facts" (events) from "tasks" (work messages):

```
                         events.raw
                             │
                        [ROUTER]
              (idempotency + retry logic)
                             │
        ┌────────────────────┼────────────────────┐
        ↓                    ↓                    ↓
   work.fetch_link     work.enrich_link    work.publish_link
        │                    │                    │
        ↓                    ↓                    ↓
   [Fetcher]            [Enricher]          [Publisher]
        │                    │                    │
        └────────────────────┼────────────────────┘
                             │
                        events.raw
                             │
                       [Materializer]
```

### Topics

| Topic | Purpose | Partitions | Retention |
|-------|---------|------------|-----------|
| `events.raw` | All domain events (facts) | 3 | 7 days |
| `tags.catalog` | Tag vocabulary (compacted) | 1 | Compacted |
| `work.fetch_link` | Fetch work queue | 3 | 7 days |
| `work.enrich_link` | Enrich work queue | 3 | 7 days |
| `work.publish_link` | Publish work queue | 3 | 7 days |
| `work.dead_letter` | Failed work (after retries) | 1 | 30 days |

### Scripts

#### 1. Initialize Topics
Creates all topics (`events.raw`, `tags.catalog`, and work topics). Idempotent.
```bash
bun run kafka:init
```

#### 2. Start Publisher (Forwarder)
Polls the database for new events and publishes them to Kafka. Tracks publication status via `published_to_kafka` column on events table.
```bash
bun run kafka:publish
```

#### 3. Start Router
Consumes events from `events.raw`, performs idempotency checks, and emits work messages to agent-specific topics. Also handles retries and dead-lettering.
```bash
bun run router
```

#### 4. Start Materializer (Consumer)
Consumes events from Kafka and materializes them into Postgres state tables. Idempotent (safe to replay).
```bash
bun run kafka:materialize
```

Handles these event types:
| Event | Tables Updated |
|-------|----------------|
| `link.added` | `subjects`, `links` |
| `content.fetched` | `link_content`, `links.status` |
| `enrichment.completed` | `link_metadata`, `links.status`, `publish_state` |
| `publish.completed` | `publish_state`, `links.status` |
| `work.failed` | (handled by router for retry) |
| `temp.reading_recorded` | `temperature_readings`, `temperature_latest` |
| `todo.created` | `subjects`, `todos` |
| `todo.completed` | `todos.completed_at` |
| `annotation.added` | `subjects`, `annotations` |

#### 5. Start Agents
Each agent consumes from its dedicated work topic:
```bash
bun run agent:fetcher    # Consumes work.fetch_link
bun run agent:enricher   # Consumes work.enrich_link
bun run agent:publisher  # Consumes work.publish_link
```

### Running the Full Pipeline

Start these in separate terminals:
```bash
# Infrastructure
bun run kafka:publish      # DB → Kafka forwarder
bun run kafka:materialize  # Kafka → DB state sync
bun run router             # events.raw → work.* topics

# Agents
bun run agent:fetcher      # Fetches URLs, extracts content
bun run agent:enricher     # Calls OpenAI for tags/summaries
bun run agent:publisher    # Marks links as published
```

### Retry Logic

- Agents emit `work.failed` events on failure
- Router checks attempt count (max 3) and either retries or dead-letters
- Dead letter queue retains failed messages for 30 days
- Failed work can be inspected/replayed manually

### Known Issues
- **TimeoutNegativeWarning**: When running with Bun, you may see `TimeoutNegativeWarning: ... is a negative number` at startup. This is a benign warning caused by strict timer validation in the runtime interacting with the KafkaJS library. It does not affect functionality.

### Troubleshooting

#### DNS Resolution Fails After Terraform Destroy/Apply
After tearing down and spinning up infrastructure, you may encounter DNS resolution failures:
```
openssl s_client -connect kafka.vibedecoding.io:9093
# Error: nodename nor servname provided, or not known
```

Even though `nslookup` resolves correctly, tools like `ping`, `nc`, and `openssl` may fail. This is a **DNS cache issue** — your system cached a stale/empty result during the destroy.

**Fix (macOS):**
```bash
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
```

Then verify:
```bash
ping -c 1 kafka.vibedecoding.io
openssl s_client -connect kafka.vibedecoding.io:9093 -servername kafka.vibedecoding.io
```
