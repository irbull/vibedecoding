# Flink Materializer

Flink SQL-based materializer that consumes events from Kafka and materializes them to PostgreSQL using Flink's exactly-once semantics.

## Prerequisites

- Docker & Docker Compose
- Access to Kafka cluster (kafka.vibedecoding.io:9093)
- Database credentials in `.env`

**No local Python or PyFlink installation required!** The job is submitted via Flink's SQL Client running inside Docker.

## Quick Start

```bash
# 1. Start local Flink cluster
bun run flink:start

# 2. Open Flink Web UI (optional)
bun run flink:ui  # Opens http://localhost:8081

# 3. Submit the materializer job
bun run flink:submit

# 4. View logs
bun run flink:logs

# 5. Stop cluster when done
bun run flink:stop
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  Your Machine                                               │
│                                                             │
│  bun run flink:submit                                       │
│       │                                                     │
│       ▼                                                     │
│  ./flink/submit.sh                                          │
│       │  1. Loads .env variables                            │
│       │  2. Substitutes variables into materializer.sql     │
│       │  3. Copies SQL to Docker container                  │
│       │  4. Runs sql-client.sh inside container             │
│       ▼                                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Docker: Flink Cluster                               │   │
│  │                                                      │   │
│  │  JobManager ◄──── sql-client.sh -f materializer.sql  │   │
│  │      │                                               │   │
│  │      ▼                                               │   │
│  │  TaskManager (executes the job)                      │   │
│  │      │                                               │   │
│  │      ├──► Kafka (events.raw)                         │   │
│  │      │                                               │   │
│  │      └──► PostgreSQL (lifestream.*)                  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

The submit script:
1. Reads your `.env` file
2. Substitutes variables (`${KAFKA_BROKERS}`, etc.) into `materializer.sql`
3. Copies the processed SQL into the Docker container
4. Executes it via Flink's built-in SQL Client

**No Python required** - everything runs inside the Flink Docker containers.

## Event Types Handled

| Event Type | Target Tables |
|------------|---------------|
| `link.added` | subjects, links |
| `content.fetched` | link_content, links |
| `enrichment.completed` | link_metadata, links, publish_state |
| `publish.completed` | publish_state, links |
| `temp.reading_recorded` | subjects, temperature_readings, temperature_latest |
| `todo.created` | subjects, todos |
| `todo.completed` | todos |
| `link.visibility_changed` | links, subjects |
| `annotation.added` | subjects, annotations |

## Configuration

Environment variables (loaded from `.env`):

```bash
# Kafka
KAFKA_BROKERS=kafka.vibedecoding.io:9093
KAFKA_SASL_USERNAME=<username>
KAFKA_SASL_PASSWORD=<password>

# PostgreSQL
DATABASE_URL=postgresql://...
```

## Co-existence with Bun Materializer

During migration, both materializers can run simultaneously:

- **Bun materializer** (EC2): consumer group `materializer-v1`
- **Flink materializer** (local): consumer group `flink-materializer-v1`

Each consumer group receives all messages independently. Since all SQL upserts are idempotent, both can write to the same tables safely.

## Checkpointing

Flink uses checkpointing for exactly-once semantics:

- Interval: 30 seconds
- Backend: RocksDB
- Storage: `./checkpoints/` (local filesystem)

On restart, Flink resumes from the last checkpoint automatically.

## Troubleshooting

### View Flink logs
```bash
bun run flink:logs
```

### Check job status
Open http://localhost:8081 and navigate to "Running Jobs"

### Reset checkpoint state
```bash
rm -rf ./checkpoints/*
```

### Common issues

1. **Kafka connection timeout**
   - Verify `KAFKA_BROKERS` is correct
   - Check SASL credentials
   - Ensure TLS is working (port 9093)

2. **JDBC sink errors**
   - Verify `DATABASE_URL` format
   - Check table permissions
   - Ensure lifestream schema exists

3. **Job submission hangs**
   - Check that Flink cluster is running: `docker compose -f docker-compose.flink.yml ps`
   - View container logs: `bun run flink:logs`

4. **NOT NULL constraint violations during historical replay**
   - The Flink materializer uses `latest-offset` by default to avoid issues with out-of-order events
   - For historical replay (`earliest-offset`), partial update events (like `enrichment.completed`) may arrive before the initial `link.added` event, causing constraint violations
   - Solution: Keep the Bun materializer running in parallel to handle historical data

### JDBC Configuration Notes

The submit script configures these JDBC URL parameters:
- `prepareThreshold=0`: Disables prepared statements (required for Supabase's PgBouncer)
- `stringtype=unspecified`: Lets PostgreSQL infer types (needed for jsonb columns)

## File Structure

```
flink/
├── README.md           # This file
├── submit.sh           # Job submission script (runs in Docker)
├── materializer.sql    # Flink SQL job definition
└── connectors/         # Downloaded JAR files (gitignored)
```

## Next Steps

1. **Test locally** - Run Flink alongside Bun materializer
2. **Monitor** - Use Flink Web UI to verify processing
3. **Cutover** - Stop Bun materializer on EC2
4. **Cleanup** - Remove `event_ingest_dedupe` and `kafka_offsets` tables
