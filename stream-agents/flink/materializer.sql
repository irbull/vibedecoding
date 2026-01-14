-- Flink SQL Materializer
-- Consumes events from Kafka and materializes them to PostgreSQL
--
-- Usage:
--   docker compose -f docker-compose.flink.yml exec jobmanager \
--     /opt/flink/bin/sql-client.sh -f /opt/flink/jobs/materializer.sql
--
-- Environment variables must be set in the Flink cluster config

-- ============================================================
-- Configuration
-- ============================================================

SET 'execution.checkpointing.interval' = '30s';
SET 'execution.checkpointing.mode' = 'EXACTLY_ONCE';
SET 'state.backend.type' = 'rocksdb';
SET 'parallelism.default' = '1';

-- ============================================================
-- Kafka Source
-- ============================================================

CREATE TABLE events_raw (
    id STRING,
    occurred_at TIMESTAMP_LTZ(3),
    received_at TIMESTAMP_LTZ(3),
    source STRING,
    subject STRING,
    subject_id STRING,
    event_type STRING,
    schema_version INT,
    payload STRING,
    correlation_id STRING,
    causation_id STRING,
    event_time AS occurred_at,
    WATERMARK FOR event_time AS event_time - INTERVAL '5' MINUTE
) WITH (
    'connector' = 'kafka',
    'topic' = 'events.raw',
    'properties.bootstrap.servers' = '${KAFKA_BROKERS}',
    'properties.group.id' = 'flink-materializer-v1',
    'properties.security.protocol' = 'SASL_SSL',
    'properties.sasl.mechanism' = 'PLAIN',
    'properties.sasl.jaas.config' = 'org.apache.flink.kafka.shaded.org.apache.kafka.common.security.plain.PlainLoginModule required username="${KAFKA_SASL_USERNAME}" password="${KAFKA_SASL_PASSWORD}";',
    'properties.enable.auto.commit' = 'true',
    'properties.auto.commit.interval.ms' = '30000',
    'scan.startup.mode' = 'group-offsets',
    'format' = 'json',
    'json.fail-on-missing-field' = 'false',
    'json.ignore-parse-errors' = 'false',
    'json.timestamp-format.standard' = 'ISO-8601'
);

-- ============================================================
-- JDBC Sinks
-- ============================================================

CREATE TABLE subjects_sink (
    subject STRING,
    subject_id STRING,
    created_at TIMESTAMP(3),
    display_name STRING,
    visibility STRING,
    meta STRING,
    PRIMARY KEY (subject, subject_id) NOT ENFORCED
) WITH (
    'connector' = 'jdbc',
    'url' = '${JDBC_URL}',
    'username' = '${DB_USER}',
    'password' = '${DB_PASS}',
    'table-name' = 'lifestream.subjects',
    'sink.buffer-flush.max-rows' = '100',
    'sink.buffer-flush.interval' = '1s',
    'sink.max-retries' = '3'
);

-- Partial update sink for visibility changes
CREATE TABLE subjects_visibility_sink (
    subject STRING,
    subject_id STRING,
    visibility STRING,
    PRIMARY KEY (subject, subject_id) NOT ENFORCED
) WITH (
    'connector' = 'jdbc',
    'url' = '${JDBC_URL}',
    'username' = '${DB_USER}',
    'password' = '${DB_PASS}',
    'table-name' = 'lifestream.subjects',
    'sink.buffer-flush.max-rows' = '100',
    'sink.buffer-flush.interval' = '1s',
    'sink.max-retries' = '3'
);

-- Full links sink for initial inserts
CREATE TABLE links_sink (
    subject_id STRING PRIMARY KEY NOT ENFORCED,
    url STRING,
    url_norm STRING,
    created_at TIMESTAMP(3),
    source STRING,
    status STRING,
    visibility STRING,
    pinned BOOLEAN,
    retry_count INT,
    last_error_at TIMESTAMP(3),
    last_error STRING
) WITH (
    'connector' = 'jdbc',
    'url' = '${JDBC_URL}',
    'username' = '${DB_USER}',
    'password' = '${DB_PASS}',
    'table-name' = 'lifestream.links',
    'sink.buffer-flush.max-rows' = '100',
    'sink.buffer-flush.interval' = '1s',
    'sink.max-retries' = '3'
);

-- Note: Partial updates to the links table require special handling because Flink's
-- JDBC connector uses upsert semantics (INSERT ON CONFLICT UPDATE). When the row
-- doesn't exist yet, it inserts with NULL for missing columns, violating NOT NULL
-- constraints on 'url'.
--
-- Solution: Use PostgreSQL views with INSTEAD OF INSERT triggers that execute
-- UPDATE statements. Flink thinks it's inserting, but PostgreSQL runs an UPDATE.
-- These views must be created in PostgreSQL before running this job:
--
--   CREATE VIEW lifestream.flink_links_status_update AS SELECT subject_id, status FROM lifestream.links;
--   CREATE FUNCTION lifestream.flink_links_status_update_fn() RETURNS TRIGGER AS $$
--   BEGIN UPDATE lifestream.links SET status = NEW.status WHERE subject_id = NEW.subject_id; RETURN NEW; END;
--   $$ LANGUAGE plpgsql;
--   CREATE TRIGGER flink_links_status_update_trigger INSTEAD OF INSERT ON lifestream.flink_links_status_update
--   FOR EACH ROW EXECUTE FUNCTION lifestream.flink_links_status_update_fn();

-- Sink for status-only updates (uses view with INSTEAD OF trigger)
CREATE TABLE links_status_update (
    subject_id STRING,
    status STRING
) WITH (
    'connector' = 'jdbc',
    'url' = '${JDBC_URL}',
    'username' = '${DB_USER}',
    'password' = '${DB_PASS}',
    'table-name' = 'lifestream.flink_links_status_update',
    'sink.buffer-flush.max-rows' = '100',
    'sink.buffer-flush.interval' = '1s',
    'sink.max-retries' = '3'
);

-- Sink for error updates (uses view with INSTEAD OF trigger)
CREATE TABLE links_error_update (
    subject_id STRING,
    status STRING,
    retry_count INT,
    last_error_at TIMESTAMP(3),
    last_error STRING
) WITH (
    'connector' = 'jdbc',
    'url' = '${JDBC_URL}',
    'username' = '${DB_USER}',
    'password' = '${DB_PASS}',
    'table-name' = 'lifestream.flink_links_error_update',
    'sink.buffer-flush.max-rows' = '100',
    'sink.buffer-flush.interval' = '1s',
    'sink.max-retries' = '3'
);

-- Sink for visibility updates (uses view with INSTEAD OF trigger)
CREATE TABLE links_visibility_update (
    subject_id STRING,
    visibility STRING
) WITH (
    'connector' = 'jdbc',
    'url' = '${JDBC_URL}',
    'username' = '${DB_USER}',
    'password' = '${DB_PASS}',
    'table-name' = 'lifestream.flink_links_visibility_update',
    'sink.buffer-flush.max-rows' = '100',
    'sink.buffer-flush.interval' = '1s',
    'sink.max-retries' = '3'
);

CREATE TABLE link_content_sink (
    subject_id STRING PRIMARY KEY NOT ENFORCED,
    final_url STRING,
    title STRING,
    text_content STRING,
    html_storage_key STRING,
    fetched_at TIMESTAMP(3),
    fetch_error STRING
) WITH (
    'connector' = 'jdbc',
    'url' = '${JDBC_URL}',
    'username' = '${DB_USER}',
    'password' = '${DB_PASS}',
    'table-name' = 'lifestream.link_content',
    'sink.buffer-flush.max-rows' = '100',
    'sink.buffer-flush.interval' = '1s',
    'sink.max-retries' = '3'
);

-- Note: Flink JDBC doesn't support PostgreSQL ARRAY types.
-- Use a view with INSTEAD OF INSERT trigger that converts JSON string to array.
-- No PRIMARY KEY here - the view's trigger handles upsert logic, so we just INSERT.
CREATE TABLE link_metadata_sink (
    subject_id STRING,
    tags_json STRING,
    summary_short STRING,
    summary_long STRING,
    `language` STRING,
    model_version STRING,
    updated_at TIMESTAMP(3)
) WITH (
    'connector' = 'jdbc',
    'url' = '${JDBC_URL}',
    'username' = '${DB_USER}',
    'password' = '${DB_PASS}',
    'table-name' = 'lifestream.flink_link_metadata',
    'sink.buffer-flush.max-rows' = '100',
    'sink.buffer-flush.interval' = '1s',
    'sink.max-retries' = '3'
);

-- Full publish_state sink for initial inserts (from enrichment.completed)
CREATE TABLE publish_state_sink (
    subject_id STRING PRIMARY KEY NOT ENFORCED,
    desired_version INT,
    published_version INT,
    dirty BOOLEAN,
    last_published_at TIMESTAMP(3)
) WITH (
    'connector' = 'jdbc',
    'url' = '${JDBC_URL}',
    'username' = '${DB_USER}',
    'password' = '${DB_PASS}',
    'table-name' = 'lifestream.publish_state',
    'sink.buffer-flush.max-rows' = '100',
    'sink.buffer-flush.interval' = '1s',
    'sink.max-retries' = '3'
);

-- Partial update sink for publish completion
CREATE TABLE publish_state_published_sink (
    subject_id STRING PRIMARY KEY NOT ENFORCED,
    published_version INT,
    dirty BOOLEAN,
    last_published_at TIMESTAMP(3)
) WITH (
    'connector' = 'jdbc',
    'url' = '${JDBC_URL}',
    'username' = '${DB_USER}',
    'password' = '${DB_PASS}',
    'table-name' = 'lifestream.publish_state',
    'sink.buffer-flush.max-rows' = '100',
    'sink.buffer-flush.interval' = '1s',
    'sink.max-retries' = '3'
);

CREATE TABLE temperature_readings_sink (
    subject_id STRING,
    occurred_at TIMESTAMP(3),
    celsius DOUBLE,
    humidity DOUBLE,
    battery DOUBLE,
    PRIMARY KEY (subject_id, occurred_at) NOT ENFORCED
) WITH (
    'connector' = 'jdbc',
    'url' = '${JDBC_URL}',
    'username' = '${DB_USER}',
    'password' = '${DB_PASS}',
    'table-name' = 'lifestream.temperature_readings',
    'sink.buffer-flush.max-rows' = '200',
    'sink.buffer-flush.interval' = '5s',
    'sink.max-retries' = '3'
);

CREATE TABLE temperature_latest_sink (
    subject_id STRING PRIMARY KEY NOT ENFORCED,
    occurred_at TIMESTAMP(3),
    celsius DOUBLE,
    humidity DOUBLE,
    battery DOUBLE,
    updated_at TIMESTAMP(3)
) WITH (
    'connector' = 'jdbc',
    'url' = '${JDBC_URL}',
    'username' = '${DB_USER}',
    'password' = '${DB_PASS}',
    'table-name' = 'lifestream.temperature_latest',
    'sink.buffer-flush.max-rows' = '50',
    'sink.buffer-flush.interval' = '2s',
    'sink.max-retries' = '3'
);

-- Note: Flink JDBC doesn't support PostgreSQL ARRAY types.
-- Use a view with INSTEAD OF INSERT trigger that converts JSON string to array.
-- No PRIMARY KEY here - the view's trigger handles upsert logic, so we just INSERT.
CREATE TABLE todos_sink (
    subject_id STRING,
    title STRING,
    project STRING,
    labels_json STRING,
    status STRING,
    due_at TIMESTAMP(3),
    completed_at TIMESTAMP(3),
    updated_at TIMESTAMP(3),
    meta STRING
) WITH (
    'connector' = 'jdbc',
    'url' = '${JDBC_URL}',
    'username' = '${DB_USER}',
    'password' = '${DB_PASS}',
    'table-name' = 'lifestream.flink_todos',
    'sink.buffer-flush.max-rows' = '100',
    'sink.buffer-flush.interval' = '1s',
    'sink.max-retries' = '3'
);

-- Partial update sink for todo completion
CREATE TABLE todos_completed_sink (
    subject_id STRING PRIMARY KEY NOT ENFORCED,
    status STRING,
    completed_at TIMESTAMP(3),
    updated_at TIMESTAMP(3)
) WITH (
    'connector' = 'jdbc',
    'url' = '${JDBC_URL}',
    'username' = '${DB_USER}',
    'password' = '${DB_PASS}',
    'table-name' = 'lifestream.todos',
    'sink.buffer-flush.max-rows' = '100',
    'sink.buffer-flush.interval' = '1s',
    'sink.max-retries' = '3'
);

CREATE TABLE annotations_sink (
    annotation_id STRING PRIMARY KEY NOT ENFORCED,
    subject_id STRING,
    link_subject_id STRING,
    created_at TIMESTAMP(3),
    updated_at TIMESTAMP(3),
    quote STRING,
    note STRING,
    selector STRING,
    visibility STRING
) WITH (
    'connector' = 'jdbc',
    'url' = '${JDBC_URL}',
    'username' = '${DB_USER}',
    'password' = '${DB_PASS}',
    'table-name' = 'lifestream.annotations',
    'sink.buffer-flush.max-rows' = '100',
    'sink.buffer-flush.interval' = '1s',
    'sink.max-retries' = '3'
);

-- ============================================================
-- Statement Set: All transforms run as a single job
-- ============================================================

BEGIN STATEMENT SET;

-- link.added: Insert subject
INSERT INTO subjects_sink
SELECT
    'link' AS subject,
    subject_id,
    occurred_at AS created_at,
    CAST(NULL AS STRING) AS display_name,
    'public' AS visibility,
    '{}' AS meta
FROM events_raw
WHERE event_type = 'link.added';

-- link.added: Insert link
INSERT INTO links_sink
SELECT
    subject_id,
    JSON_VALUE(payload, '$.url') AS url,
    COALESCE(JSON_VALUE(payload, '$.url_norm'), JSON_VALUE(payload, '$.url')) AS url_norm,
    occurred_at AS created_at,
    source,
    'new' AS status,
    'public' AS visibility,
    FALSE AS pinned,
    0 AS retry_count,
    CAST(NULL AS TIMESTAMP(3)) AS last_error_at,
    CAST(NULL AS STRING) AS last_error
FROM events_raw
WHERE event_type = 'link.added';

-- content.fetched: Upsert link_content
INSERT INTO link_content_sink
SELECT
    subject_id,
    JSON_VALUE(payload, '$.final_url') AS final_url,
    JSON_VALUE(payload, '$.title') AS title,
    JSON_VALUE(payload, '$.text_content') AS text_content,
    JSON_VALUE(payload, '$.html_storage_key') AS html_storage_key,
    occurred_at AS fetched_at,
    JSON_VALUE(payload, '$.fetch_error') AS fetch_error
FROM events_raw
WHERE event_type = 'content.fetched';

-- content.fetched (success): Update links status
INSERT INTO links_status_update
SELECT
    subject_id,
    'fetched' AS status
FROM events_raw
WHERE event_type = 'content.fetched'
  AND JSON_VALUE(payload, '$.fetch_error') IS NULL;

-- content.fetched (error): Update links status with error info
INSERT INTO links_error_update
SELECT
    subject_id,
    'error' AS status,
    0 AS retry_count,  -- Trigger increments this, so we pass 0
    occurred_at AS last_error_at,
    JSON_VALUE(payload, '$.fetch_error') AS last_error
FROM events_raw
WHERE event_type = 'content.fetched'
  AND JSON_VALUE(payload, '$.fetch_error') IS NOT NULL;

-- enrichment.completed: Upsert link_metadata
INSERT INTO link_metadata_sink
SELECT
    subject_id,
    JSON_QUERY(payload, '$.tags') AS tags_json,
    COALESCE(JSON_VALUE(payload, '$.summary_short'), JSON_VALUE(payload, '$.summary')) AS summary_short,
    JSON_VALUE(payload, '$.summary_long') AS summary_long,
    JSON_VALUE(payload, '$.language') AS `language`,
    JSON_VALUE(payload, '$.model_version') AS model_version,
    occurred_at AS updated_at
FROM events_raw
WHERE event_type = 'enrichment.completed';

-- enrichment.completed: Update links status
INSERT INTO links_status_update
SELECT
    subject_id,
    'enriched' AS status
FROM events_raw
WHERE event_type = 'enrichment.completed';

-- enrichment.completed: Update publish_state
INSERT INTO publish_state_sink
SELECT
    subject_id,
    1 AS desired_version,
    0 AS published_version,
    TRUE AS dirty,
    CAST(NULL AS TIMESTAMP(3)) AS last_published_at
FROM events_raw
WHERE event_type = 'enrichment.completed';

-- publish.completed: Update publish_state
INSERT INTO publish_state_published_sink
SELECT
    subject_id,
    1 AS published_version,
    FALSE AS dirty,
    occurred_at AS last_published_at
FROM events_raw
WHERE event_type = 'publish.completed';

-- publish.completed: Update links status
INSERT INTO links_status_update
SELECT
    subject_id,
    'published' AS status
FROM events_raw
WHERE event_type = 'publish.completed';

-- temp.reading_recorded: Insert subject
INSERT INTO subjects_sink
SELECT
    'sensor' AS subject,
    subject_id,
    occurred_at AS created_at,
    CAST(NULL AS STRING) AS display_name,
    'private' AS visibility,
    '{"type": "temperature"}' AS meta
FROM events_raw
WHERE event_type = 'temp.reading_recorded'
  AND JSON_VALUE(payload, '$.celsius') IS NOT NULL;

-- temp.reading_recorded: Append to time-series
INSERT INTO temperature_readings_sink
SELECT
    subject_id,
    occurred_at,
    CAST(JSON_VALUE(payload, '$.celsius') AS DOUBLE) AS celsius,
    CAST(JSON_VALUE(payload, '$.humidity') AS DOUBLE) AS humidity,
    CAST(JSON_VALUE(payload, '$.battery') AS DOUBLE) AS battery
FROM events_raw
WHERE event_type = 'temp.reading_recorded'
  AND JSON_VALUE(payload, '$.celsius') IS NOT NULL;

-- temp.reading_recorded: Upsert to latest
INSERT INTO temperature_latest_sink
SELECT
    subject_id,
    occurred_at,
    CAST(JSON_VALUE(payload, '$.celsius') AS DOUBLE) AS celsius,
    CAST(JSON_VALUE(payload, '$.humidity') AS DOUBLE) AS humidity,
    CAST(JSON_VALUE(payload, '$.battery') AS DOUBLE) AS battery,
    CURRENT_TIMESTAMP AS updated_at
FROM events_raw
WHERE event_type = 'temp.reading_recorded'
  AND JSON_VALUE(payload, '$.celsius') IS NOT NULL;

-- todo.created: Insert subject
INSERT INTO subjects_sink
SELECT
    'todo' AS subject,
    subject_id,
    occurred_at AS created_at,
    JSON_VALUE(payload, '$.title') AS display_name,
    'private' AS visibility,
    '{}' AS meta
FROM events_raw
WHERE event_type = 'todo.created'
  AND JSON_VALUE(payload, '$.title') IS NOT NULL;

-- todo.created: Insert todo
INSERT INTO todos_sink
SELECT
    subject_id,
    JSON_VALUE(payload, '$.title') AS title,
    JSON_VALUE(payload, '$.project') AS project,
    JSON_QUERY(payload, '$.labels') AS labels_json,
    'open' AS status,
    CAST(NULL AS TIMESTAMP(3)) AS due_at,
    CAST(NULL AS TIMESTAMP(3)) AS completed_at,
    occurred_at AS updated_at,
    CONCAT('{"source": "', source, '"}') AS meta
FROM events_raw
WHERE event_type = 'todo.created'
  AND JSON_VALUE(payload, '$.title') IS NOT NULL;

-- todo.completed: Update todo
INSERT INTO todos_completed_sink
SELECT
    subject_id,
    'done' AS status,
    occurred_at AS completed_at,
    occurred_at AS updated_at
FROM events_raw
WHERE event_type = 'todo.completed';

-- link.visibility_changed: Update links
INSERT INTO links_visibility_update
SELECT
    subject_id,
    JSON_VALUE(payload, '$.visibility') AS visibility
FROM events_raw
WHERE event_type = 'link.visibility_changed'
  AND JSON_VALUE(payload, '$.visibility') IN ('public', 'private');

-- link.visibility_changed: Update subjects
INSERT INTO subjects_visibility_sink
SELECT
    'link' AS subject,
    subject_id,
    JSON_VALUE(payload, '$.visibility') AS visibility
FROM events_raw
WHERE event_type = 'link.visibility_changed'
  AND JSON_VALUE(payload, '$.visibility') IN ('public', 'private');

-- annotation.added: Insert subject
INSERT INTO subjects_sink
SELECT
    'annotation' AS subject,
    subject_id,
    occurred_at AS created_at,
    CAST(NULL AS STRING) AS display_name,
    COALESCE(JSON_VALUE(payload, '$.visibility'), 'private') AS visibility,
    '{}' AS meta
FROM events_raw
WHERE event_type = 'annotation.added';

-- annotation.added: Insert annotation
INSERT INTO annotations_sink
SELECT
    JSON_VALUE(payload, '$.annotation_id') AS annotation_id,
    subject_id,
    JSON_VALUE(payload, '$.link_subject_id') AS link_subject_id,
    occurred_at AS created_at,
    occurred_at AS updated_at,
    JSON_VALUE(payload, '$.quote') AS quote,
    JSON_VALUE(payload, '$.note') AS note,
    JSON_VALUE(payload, '$.selector') AS selector,
    COALESCE(JSON_VALUE(payload, '$.visibility'), 'private') AS visibility
FROM events_raw
WHERE event_type = 'annotation.added';

END;
