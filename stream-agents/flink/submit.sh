#!/bin/bash
# Submit the Flink materializer job using Flink SQL Client
# No local Python/PyFlink required - runs entirely in Docker

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Check if Flink cluster is running
if ! docker compose -f docker-compose.flink.yml ps --status running 2>/dev/null | grep -q jobmanager; then
    echo "Error: Flink cluster is not running."
    echo "Start it with: bun run flink:start"
    exit 1
fi

# Load environment variables (handles spaces and special characters)
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# Validate required env vars
if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL not set in .env"
    exit 1
fi

if [ -z "$KAFKA_BROKERS" ]; then
    echo "Error: KAFKA_BROKERS not set in .env"
    exit 1
fi

# Convert DATABASE_URL to JDBC format
# DATABASE_URL format: postgresql://user:pass@host:port/db
# JDBC URL format: jdbc:postgresql://host:port/db (credentials passed separately via 'username' and 'password' table options)
# However, Flink JDBC connector also accepts credentials in URL, but we need to extract them for the sink DDL

# Extract components from DATABASE_URL
DB_URL="$DATABASE_URL"
# Remove protocol prefix
if [[ "$DB_URL" == postgres://* ]]; then
    DB_URL="${DB_URL#postgres://}"
elif [[ "$DB_URL" == postgresql://* ]]; then
    DB_URL="${DB_URL#postgresql://}"
fi

# Extract user:pass@host:port/db parts
# Format: user:pass@host:port/db
DB_USER=$(echo "$DB_URL" | sed -E 's/^([^:]+):.*/\1/')
DB_PASS=$(echo "$DB_URL" | sed -E 's/^[^:]+:([^@]+)@.*/\1/')
DB_HOST_PORT_DB=$(echo "$DB_URL" | sed -E 's/^[^@]+@(.*)/\1/')

# Build JDBC URL without credentials (host:port/db)
# - prepareThreshold=0: disable prepared statements (required for Supabase PgBouncer)
# - stringtype=unspecified: let PostgreSQL infer types (needed for jsonb columns)
# Note: & is escaped as \& in the sed replacement to avoid interpretation as "matched pattern"
JDBC_URL="jdbc:postgresql://${DB_HOST_PORT_DB}?prepareThreshold=0\\&stringtype=unspecified"

echo "DB User: $DB_USER"
echo "DB Host: $DB_HOST_PORT_DB"

echo "=========================================="
echo "Submitting Flink Materializer Job"
echo "=========================================="
echo "Kafka: $KAFKA_BROKERS"
echo "JDBC:  ${JDBC_URL:0:60}..."
echo ""

# Create a temporary SQL file with variables substituted
TMP_SQL=$(mktemp)
trap "rm -f $TMP_SQL" EXIT

sed \
    -e "s|\${KAFKA_BROKERS}|$KAFKA_BROKERS|g" \
    -e "s|\${KAFKA_SASL_USERNAME}|$KAFKA_SASL_USERNAME|g" \
    -e "s|\${KAFKA_SASL_PASSWORD}|$KAFKA_SASL_PASSWORD|g" \
    -e "s|\${JDBC_URL}|$JDBC_URL|g" \
    -e "s|\${DB_USER}|$DB_USER|g" \
    -e "s|\${DB_PASS}|$DB_PASS|g" \
    flink/materializer.sql > "$TMP_SQL"

# Copy the processed SQL file into the container and execute
docker cp "$TMP_SQL" "$(docker compose -f docker-compose.flink.yml ps -q jobmanager)":/tmp/materializer.sql

echo "Submitting SQL job..."
docker compose -f docker-compose.flink.yml exec -T jobmanager \
    /opt/flink/bin/sql-client.sh -f /tmp/materializer.sql

echo ""
echo "=========================================="
echo "Job submitted!"
echo "View status at: http://localhost:8081"
echo "=========================================="
