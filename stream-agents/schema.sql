-- =============================================================
-- Personal Life Stream Schema
-- Schema: lifestream
-- =============================================================

-- Create the lifestream schema
create schema if not exists lifestream;

-- Set search path for this session
set search_path to lifestream;

-- -----------------------------
-- 1) Canonical subjects registry
-- -----------------------------
create table if not exists subjects (
  subject         text not null,           -- e.g. "link", "todo.item", "home.temperature", "annotation"
  subject_id      text not null,           -- stable key (string). examples:
                                           --  - link: "link:<sha256(url_norm)>"
                                           --  - sensor: "sensor:living_room"
                                           --  - todo: "todoist:12345"
                                           --  - annotation: "anno:<uuid>"
  created_at      timestamptz not null default now(),
  display_name    text null,
  visibility      text not null default 'private', -- private|public (handy for site filtering)
  meta            jsonb not null default '{}'::jsonb,

  primary key (subject, subject_id)
);

create index if not exists subjects_visibility_idx
  on subjects(visibility, subject, created_at desc);


-- -----------------------------
-- 2) Event ledger (append-only)
-- -----------------------------
create table if not exists events (
  id              uuid primary key default gen_random_uuid(),

  occurred_at      timestamptz not null,          -- when it happened at the source
  received_at      timestamptz not null default now(), -- when we stored it

  source           text not null,                 -- "phone", "chrome", "homeassistant", "todoist", "agent:summarizer"
  subject          text not null,                 -- matches subjects.subject
  subject_id       text not null,                 -- matches subjects.subject_id

  event_type       text not null,                 -- "created", "reading.recorded", "item.completed", "republish.requested"
  schema_version   int  not null default 1,

  payload          jsonb not null default '{}'::jsonb,

  -- tracing (optional but great)
  correlation_id   uuid null,                     -- ties together a pipeline run
  causation_id     uuid null,                     -- which prior event caused this event

  -- Kafka lineage (optional)
  kafka_topic      text null,
  kafka_partition  int  null,
  kafka_offset     bigint null,

  -- Kafka publication tracking (for DB->Kafka forwarder)
  published_to_kafka boolean not null default false
);

-- Fast timeline queries + per-entity queries
create index if not exists events_subject_idx
  on events(subject, subject_id, occurred_at desc);

create index if not exists events_type_idx
  on events(event_type, occurred_at desc);

create index if not exists events_source_idx
  on events(source, occurred_at desc);

-- Partial index for unpublished events (used by kafka:publish forwarder)
create index if not exists events_unpublished_idx
  on events(received_at) where published_to_kafka = false;

-- Optional: payload GIN for ad-hoc searches (can be heavy; enable only if you need it)
-- create index events_payload_gin on events using gin(payload);

-- Optional: enforce referential-ish consistency (softly) by ensuring subject exists.
-- (We can't FK to subjects because subjects has composite PK; we can, but it's noisy.)
-- If you want it, uncomment:
-- alter table events
--   add constraint events_subject_fk
--   foreign key (subject, subject_id) references subjects(subject, subject_id);


-- ---------------------------------------------------------
-- 3) Kafka ingestion bookkeeping (recommended)
-- ---------------------------------------------------------
-- If you have a consumer writing events into Postgres, this prevents double writes on restarts.

-- Track last committed offset per consumer group
create table if not exists kafka_offsets (
  consumer_group  text not null,
  topic           text not null,
  partition       int  not null,
  last_offset     bigint not null,
  updated_at      timestamptz not null default now(),
  primary key (consumer_group, topic, partition)
);

-- NOTE: publisher_checkpoint table has been removed.
-- Events now track their Kafka publication status via the published_to_kafka column.

-- Extra dedupe barrier for events:
-- Ensures we never insert the same Kafka record twice even if offset tracking gets weird.
create table if not exists event_ingest_dedupe (
  topic           text not null,
  partition       int  not null,
  kafka_offset    bigint not null,
  inserted_at     timestamptz not null default now(),
  primary key (topic, partition, kafka_offset)
);


-- -----------------------------
-- 4) Links domain (state)
-- -----------------------------
create table if not exists links (
  subject_id      text primary key,       -- "link:<sha256(url_norm)>"
  url             text not null,
  url_norm        text not null,
  created_at      timestamptz not null default now(),
  source          text null,

  status          text not null default 'new',      -- new|fetched|enriched|published|error
  visibility      text not null default 'public',   -- private|public

  pinned          boolean not null default false,

  -- Retry tracking for failed links
  retry_count     int not null default 0,
  last_error_at   timestamptz null,
  last_error      text null              -- human-readable error message
);

create unique index if not exists links_url_norm_uq on links(url_norm);
create index if not exists links_visibility_idx on links(visibility, created_at desc);

create table if not exists link_content (
  subject_id        text primary key references links(subject_id) on delete cascade,
  final_url         text null,
  title             text null,
  text_content      text null,
  html_storage_key  text null,
  fetched_at        timestamptz null,
  fetch_error       text null
);

create table if not exists link_metadata (
  subject_id        text primary key references links(subject_id) on delete cascade,
  tags              text[] not null default '{}',
  summary_short     text null,
  summary_long      text null,
  language          text null,
  model_version     text null,
  updated_at        timestamptz not null default now()
);

-- Publishing / debouncing republish
create table if not exists publish_state (
  subject_id         text primary key, -- applies to links now, but keep generic
  desired_version    int not null default 0,
  published_version  int not null default 0,
  dirty              boolean not null default false,
  last_published_at  timestamptz null
);

create index if not exists publish_state_dirty_idx
  on publish_state(dirty) where dirty = true;


-- -----------------------------
-- 5) Annotations domain (state)
-- -----------------------------
create table if not exists annotations (
  annotation_id   uuid primary key default gen_random_uuid(),
  subject_id      text not null,           -- "anno:<uuid>" (also register in subjects)
  link_subject_id text not null references links(subject_id) on delete cascade,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- for highlights/quotes:
  quote           text null,
  note            text null,

  -- optional selectors (kept generic; different readers store different shapes)
  selector        jsonb not null default '{}'::jsonb,

  visibility      text not null default 'private'  -- private|public
);

create index if not exists annotations_link_idx
  on annotations(link_subject_id, created_at desc);


-- -----------------------------
-- 6) Todos domain (state)
-- -----------------------------
create table if not exists todos (
  subject_id      text primary key,       -- "todoist:12345"
  title           text not null,
  project         text null,
  labels          text[] not null default '{}',

  status          text not null default 'open',  -- open|done|archived
  due_at          timestamptz null,
  completed_at    timestamptz null,

  updated_at      timestamptz not null default now(),
  meta            jsonb not null default '{}'::jsonb
);

create index if not exists todos_status_idx
  on todos(status, updated_at desc);


-- -----------------------------
-- 7) Temperature domain (time-series + latest)
-- -----------------------------
create table if not exists temperature_readings (
  subject_id      text not null,           -- "sensor:living_room"
  occurred_at     timestamptz not null,
  celsius         double precision not null,
  humidity        double precision null,
  battery         double precision null,

  primary key (subject_id, occurred_at)
);

create index if not exists temperature_readings_idx
  on temperature_readings(subject_id, occurred_at desc);

create table if not exists temperature_latest (
  subject_id      text primary key,
  occurred_at     timestamptz not null,
  celsius         double precision not null,
  humidity        double precision null,
  battery         double precision null,
  updated_at      timestamptz not null default now()
);


-- -----------------------------
-- 8) Site build tracking (optional but handy)
-- -----------------------------
create table if not exists site_builds (
  build_id        uuid primary key default gen_random_uuid(),
  requested_at    timestamptz not null default now(),
  started_at      timestamptz null,
  finished_at     timestamptz null,

  status          text not null default 'requested', -- requested|running|success|failed
  reason          text null,                         -- "republish", "manual", etc.
  meta            jsonb not null default '{}'::jsonb
);


-- -----------------------------
-- 9) Flink Materializer Support
-- -----------------------------
-- Views with INSTEAD OF INSERT triggers for partial updates from Flink.
-- Flink's JDBC connector uses upsert semantics (INSERT ON CONFLICT UPDATE).
-- When the target row doesn't exist, it inserts with NULL for missing columns,
-- violating NOT NULL constraints. These views intercept INSERTs and convert
-- them to UPDATEs, which safely do nothing if the row doesn't exist.

-- Status update view
create or replace view lifestream.flink_links_status_update as
select subject_id, status from lifestream.links;

create or replace function flink_links_status_update_fn()
returns trigger as $$
begin
    update lifestream.links set status = NEW.status where subject_id = NEW.subject_id;
    return NEW;
end;
$$ language plpgsql;

drop trigger if exists flink_links_status_update_trigger on lifestream.flink_links_status_update;
create trigger flink_links_status_update_trigger
instead of insert on lifestream.flink_links_status_update
for each row execute function flink_links_status_update_fn();

-- Error update view
create or replace view lifestream.flink_links_error_update as
select subject_id, status, retry_count, last_error_at, last_error from lifestream.links;

create or replace function flink_links_error_update_fn()
returns trigger as $$
begin
    update lifestream.links
    set status = NEW.status,
        retry_count = coalesce(retry_count, 0) + 1,
        last_error_at = NEW.last_error_at,
        last_error = NEW.last_error
    where subject_id = NEW.subject_id;
    return NEW;
end;
$$ language plpgsql;

drop trigger if exists flink_links_error_update_trigger on lifestream.flink_links_error_update;
create trigger flink_links_error_update_trigger
instead of insert on lifestream.flink_links_error_update
for each row execute function flink_links_error_update_fn();

-- Visibility update view
create or replace view lifestream.flink_links_visibility_update as
select subject_id, visibility from lifestream.links;

create or replace function flink_links_visibility_update_fn()
returns trigger as $$
begin
    update lifestream.links set visibility = NEW.visibility where subject_id = NEW.subject_id;
    return NEW;
end;
$$ language plpgsql;

drop trigger if exists flink_links_visibility_update_trigger on lifestream.flink_links_visibility_update;
create trigger flink_links_visibility_update_trigger
instead of insert on lifestream.flink_links_visibility_update
for each row execute function flink_links_visibility_update_fn();

-- Link metadata view (converts JSON string tags to array)
-- Flink JDBC connector doesn't support PostgreSQL ARRAY types, so we accept
-- tags as a JSON string and convert to text[] in the trigger.
create or replace view lifestream.flink_link_metadata as
select subject_id, null::text as tags_json, summary_short, summary_long, language, model_version, updated_at
from lifestream.link_metadata;

create or replace function flink_link_metadata_fn()
returns trigger as $$
declare
    v_tags text[];
begin
    -- Convert JSON array string to PostgreSQL array
    if NEW.tags_json is not null and NEW.tags_json != '' and NEW.tags_json != 'null' then
        select array_agg(elem)
        into v_tags
        from jsonb_array_elements_text(NEW.tags_json::jsonb) as elem;
    else
        v_tags := '{}';
    end if;

    insert into lifestream.link_metadata (subject_id, tags, summary_short, summary_long, language, model_version, updated_at)
    values (
        NEW.subject_id,
        coalesce(v_tags, '{}'),
        NEW.summary_short,
        NEW.summary_long,
        NEW.language,
        NEW.model_version,
        NEW.updated_at
    )
    on conflict (subject_id) do update set
        tags = coalesce(v_tags, lifestream.link_metadata.tags),
        summary_short = coalesce(NEW.summary_short, lifestream.link_metadata.summary_short),
        summary_long = coalesce(NEW.summary_long, lifestream.link_metadata.summary_long),
        language = coalesce(NEW.language, lifestream.link_metadata.language),
        model_version = coalesce(NEW.model_version, lifestream.link_metadata.model_version),
        updated_at = NEW.updated_at;
    return NEW;
end;
$$ language plpgsql;

drop trigger if exists flink_link_metadata_trigger on lifestream.flink_link_metadata;
create trigger flink_link_metadata_trigger
instead of insert on lifestream.flink_link_metadata
for each row execute function flink_link_metadata_fn();

-- Todos view (converts JSON string labels to array)
create or replace view lifestream.flink_todos as
select subject_id, title, project, null::text as labels_json, status, due_at, completed_at, updated_at, meta::text
from lifestream.todos;

create or replace function flink_todos_fn()
returns trigger as $$
declare
    v_labels text[];
begin
    -- Convert JSON array string to PostgreSQL array
    if NEW.labels_json is not null and NEW.labels_json != '' and NEW.labels_json != 'null' then
        select array_agg(elem)
        into v_labels
        from jsonb_array_elements_text(NEW.labels_json::jsonb) as elem;
    else
        v_labels := '{}';
    end if;

    insert into lifestream.todos (subject_id, title, project, labels, status, due_at, completed_at, updated_at, meta)
    values (
        NEW.subject_id,
        NEW.title,
        NEW.project,
        coalesce(v_labels, '{}'),
        NEW.status,
        NEW.due_at,
        NEW.completed_at,
        NEW.updated_at,
        coalesce(NEW.meta::jsonb, '{}'::jsonb)
    )
    on conflict (subject_id) do update set
        title = coalesce(NEW.title, lifestream.todos.title),
        project = coalesce(NEW.project, lifestream.todos.project),
        labels = coalesce(v_labels, lifestream.todos.labels),
        status = coalesce(NEW.status, lifestream.todos.status),
        due_at = coalesce(NEW.due_at, lifestream.todos.due_at),
        completed_at = coalesce(NEW.completed_at, lifestream.todos.completed_at),
        updated_at = NEW.updated_at,
        meta = coalesce(NEW.meta::jsonb, lifestream.todos.meta);
    return NEW;
end;
$$ language plpgsql;

drop trigger if exists flink_todos_trigger on lifestream.flink_todos;
create trigger flink_todos_trigger
instead of insert on lifestream.flink_todos
for each row execute function flink_todos_fn();
