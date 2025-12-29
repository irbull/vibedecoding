/**
 * Seed Database Script
 * 
 * Creates deterministic test data for:
 * - Links (with subjects, events, content, metadata)
 * - Temperature readings (time-series)
 * - Todos (open and completed)
 * 
 * Run with: bun run scripts/seed_db.ts
 * Run with clean: bun run scripts/seed_db.ts --clean
 */

import { supabase, type Subject, type Event, type Link, type LinkContent, type LinkMetadata, type Todo, type TemperatureReading, type TemperatureLatest } from "../src/lib/db";
import { linkSubjectId, normalizeUrl, sensorSubjectId, todoSubjectId } from "../src/lib/subject_id";

// ============================================================
// Test Data Definitions
// ============================================================

const SEED_LINKS = [
  {
    url: "https://example.com/blog/rust-async-programming",
    title: "Understanding Async/Await in Rust",
    tags: ["rust", "programming", "async"],
    summary: "A comprehensive guide to asynchronous programming in Rust.",
    source: "chrome",
    status: "published" as const,
  },
  {
    url: "https://news.ycombinator.com/item?id=12345",
    title: "Show HN: A New Way to Build Web Apps",
    tags: ["hackernews", "webdev", "startup"],
    summary: "Interesting discussion about modern web development frameworks.",
    source: "phone",
    status: "enriched" as const,
  },
  {
    url: "https://docs.github.com/en/actions/quickstart",
    title: "GitHub Actions Quickstart",
    tags: ["github", "ci-cd", "devops"],
    summary: "Getting started with GitHub Actions for CI/CD workflows.",
    source: "chrome",
    status: "fetched" as const,
  },
  {
    url: "https://www.typescriptlang.org/docs/handbook/2/types-from-types.html",
    title: "TypeScript: Creating Types from Types",
    tags: ["typescript", "programming", "types"],
    summary: "Learn about advanced type manipulation in TypeScript.",
    source: "chrome",
    status: "published" as const,
  },
  {
    url: "https://blog.cloudflare.com/workers-ai/",
    title: "Cloudflare Workers AI: Running LLMs at the Edge",
    tags: ["cloudflare", "ai", "edge-computing"],
    summary: "How Cloudflare is bringing AI inference to their edge network.",
    source: "phone",
    status: "new" as const,
  },
  {
    url: "https://www.postgresql.org/docs/current/indexes.html",
    title: "PostgreSQL: Indexes",
    tags: ["postgresql", "database", "performance"],
    summary: "Complete guide to PostgreSQL indexing strategies.",
    source: "chrome",
    status: "enriched" as const,
  },
  {
    url: "https://kafka.apache.org/documentation/#gettingStarted",
    title: "Apache Kafka Documentation - Getting Started",
    tags: ["kafka", "streaming", "messaging"],
    summary: "Official getting started guide for Apache Kafka.",
    source: "agent:discovery",
    status: "fetched" as const,
  },
  {
    url: "https://supabase.com/docs/guides/database/overview",
    title: "Supabase Database Overview",
    tags: ["supabase", "postgresql", "database"],
    summary: "Introduction to Supabase's PostgreSQL database features.",
    source: "chrome",
    status: "published" as const,
  },
  {
    url: "https://bun.sh/docs",
    title: "Bun Documentation",
    tags: ["bun", "javascript", "runtime"],
    summary: "Official documentation for the Bun JavaScript runtime.",
    source: "phone",
    status: "new" as const,
  },
  {
    url: "https://astro.build/blog/astro-4/",
    title: "Astro 4.0 Release",
    tags: ["astro", "frontend", "static-site"],
    summary: "What's new in Astro 4.0 static site generator.",
    source: "chrome",
    status: "enriched" as const,
  },
];

const SEED_SENSORS = [
  { location: "living_room", baseTemp: 21.5, baseHumidity: 45 },
  { location: "bedroom", baseTemp: 19.0, baseHumidity: 50 },
];

const SEED_TODOS = [
  { id: "1001", title: "Review PR for auth module", project: "work", labels: ["code-review", "urgent"], status: "done" as const },
  { id: "1002", title: "Update documentation for API v2", project: "work", labels: ["documentation"], status: "open" as const },
  { id: "1003", title: "Fix memory leak in worker process", project: "work", labels: ["bug", "performance"], status: "done" as const },
  { id: "1004", title: "Write blog post about Kafka learnings", project: "personal", labels: ["writing", "tech"], status: "open" as const },
  { id: "1005", title: "Set up monitoring dashboard", project: "work", labels: ["devops", "monitoring"], status: "open" as const },
  { id: "1006", title: "Grocery shopping", project: "personal", labels: ["errands"], status: "done" as const },
  { id: "1007", title: "Research vector databases", project: "personal", labels: ["learning", "ai"], status: "open" as const },
  { id: "1008", title: "Schedule dentist appointment", project: "personal", labels: ["health"], status: "open" as const },
  { id: "1009", title: "Refactor database schema", project: "work", labels: ["database", "tech-debt"], status: "done" as const },
  { id: "1010", title: "Plan weekend hiking trip", project: "personal", labels: ["outdoor", "planning"], status: "open" as const },
];

// ============================================================
// Helper Functions
// ============================================================

const NOW = new Date();

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

// ============================================================
// Seeding Functions
// ============================================================

async function seedLinks(): Promise<void> {
  console.log("\n📎 Seeding links...");
  
  const subjects: Subject[] = [];
  const events: Event[] = [];
  const links: Link[] = [];
  const linkContents: LinkContent[] = [];
  const linkMetadatas: LinkMetadata[] = [];

  for (let i = 0; i < SEED_LINKS.length; i++) {
    const link = SEED_LINKS[i];
    const urlNorm = normalizeUrl(link.url);
    const subjectId = linkSubjectId(link.url);
    const createdAt = daysAgo(SEED_LINKS.length - i); // Older links first

    // Subject
    subjects.push({
      subject: "link",
      subject_id: subjectId,
      created_at: createdAt,
      display_name: link.title,
      visibility: "public",
      meta: {},
    });

    // Link
    links.push({
      subject_id: subjectId,
      url: link.url,
      url_norm: urlNorm,
      created_at: createdAt,
      source: link.source,
      status: link.status,
      visibility: "public",
      pinned: i === 0, // Pin the first link
    });

    // Event: link.added
    events.push({
      occurred_at: createdAt,
      source: link.source,
      subject: "link",
      subject_id: subjectId,
      event_type: "link.added",
      payload: { url: link.url, url_norm: urlNorm },
    });

    // Content (for fetched+ statuses)
    if (link.status !== "new") {
      linkContents.push({
        subject_id: subjectId,
        final_url: link.url,
        title: link.title,
        text_content: `Sample content for: ${link.title}`,
        html_storage_key: null,
        fetched_at: hoursAgo((SEED_LINKS.length - i) * 12),
        fetch_error: null,
      });

      events.push({
        occurred_at: hoursAgo((SEED_LINKS.length - i) * 12),
        source: "agent:fetcher",
        subject: "link",
        subject_id: subjectId,
        event_type: "content.fetched",
        payload: { title: link.title },
      });
    }

    // Metadata (for enriched+ statuses)
    if (link.status === "enriched" || link.status === "published") {
      linkMetadatas.push({
        subject_id: subjectId,
        tags: link.tags,
        summary_short: link.summary,
        summary_long: `Extended summary: ${link.summary} This is additional context about the link.`,
        language: "en",
        model_version: "gpt-4-turbo-preview",
      });

      events.push({
        occurred_at: hoursAgo((SEED_LINKS.length - i) * 6),
        source: "agent:enricher",
        subject: "link",
        subject_id: subjectId,
        event_type: "enrichment.completed",
        payload: { tags: link.tags, summary: link.summary },
      });
    }

    // Published event
    if (link.status === "published") {
      events.push({
        occurred_at: hoursAgo((SEED_LINKS.length - i) * 3),
        source: "agent:publisher",
        subject: "link",
        subject_id: subjectId,
        event_type: "publish.completed",
        payload: {},
      });
    }
  }

  // Insert subjects
  const { error: subjectsError } = await supabase
    .from("subjects")
    .upsert(subjects, { onConflict: "subject,subject_id" });
  if (subjectsError) throw new Error(`Failed to insert subjects: ${subjectsError.message}`);

  // Insert links
  const { error: linksError } = await supabase
    .from("links")
    .upsert(links, { onConflict: "subject_id" });
  if (linksError) throw new Error(`Failed to insert links: ${linksError.message}`);

  // Insert link content
  const { error: contentError } = await supabase
    .from("link_content")
    .upsert(linkContents, { onConflict: "subject_id" });
  if (contentError) throw new Error(`Failed to insert link_content: ${contentError.message}`);

  // Insert link metadata
  const { error: metadataError } = await supabase
    .from("link_metadata")
    .upsert(linkMetadatas, { onConflict: "subject_id" });
  if (metadataError) throw new Error(`Failed to insert link_metadata: ${metadataError.message}`);

  // Insert events
  const { error: eventsError } = await supabase.from("events").insert(events);
  if (eventsError) throw new Error(`Failed to insert events: ${eventsError.message}`);

  console.log(`  ✓ Inserted ${links.length} links`);
  console.log(`  ✓ Inserted ${linkContents.length} link contents`);
  console.log(`  ✓ Inserted ${linkMetadatas.length} link metadatas`);
  console.log(`  ✓ Inserted ${events.length} link events`);
}

async function seedTemperature(): Promise<void> {
  console.log("\n🌡️  Seeding temperature readings...");

  const subjects: Subject[] = [];
  const events: Event[] = [];
  const readings: TemperatureReading[] = [];
  const latests: TemperatureLatest[] = [];

  for (const sensor of SEED_SENSORS) {
    const subjectId = sensorSubjectId(sensor.location);

    // Subject
    subjects.push({
      subject: "sensor",
      subject_id: subjectId,
      created_at: daysAgo(30),
      display_name: `Temperature - ${sensor.location.replace("_", " ")}`,
      visibility: "private",
      meta: { type: "temperature", unit: "celsius" },
    });

    // Generate 24 hours of readings (every 10 minutes = 144 readings)
    let latestReading: TemperatureReading | null = null;
    
    for (let i = 144; i >= 0; i--) {
      const occurredAt = new Date(NOW.getTime() - i * 10 * 60 * 1000).toISOString();
      
      // Add some variation to temperature
      const variation = Math.sin(i / 12) * 2 + (Math.random() - 0.5);
      const celsius = Math.round((sensor.baseTemp + variation) * 10) / 10;
      const humidity = Math.round((sensor.baseHumidity + (Math.random() - 0.5) * 5) * 10) / 10;

      const reading: TemperatureReading = {
        subject_id: subjectId,
        occurred_at: occurredAt,
        celsius,
        humidity,
        battery: 95 - i * 0.01, // Slowly decreasing battery
      };

      readings.push(reading);
      latestReading = reading;

      // Only create events for every 6th reading (hourly) to avoid too many events
      if (i % 6 === 0) {
        events.push({
          occurred_at: occurredAt,
          source: "homeassistant",
          subject: "sensor",
          subject_id: subjectId,
          event_type: "temp.reading_recorded",
          payload: { celsius, humidity },
        });
      }
    }

    // Latest reading
    if (latestReading) {
      latests.push({
        subject_id: subjectId,
        occurred_at: latestReading.occurred_at,
        celsius: latestReading.celsius,
        humidity: latestReading.humidity,
        battery: latestReading.battery,
      });
    }
  }

  // Insert subjects
  const { error: subjectsError } = await supabase
    .from("subjects")
    .upsert(subjects, { onConflict: "subject,subject_id" });
  if (subjectsError) throw new Error(`Failed to insert subjects: ${subjectsError.message}`);

  // Insert readings
  const { error: readingsError } = await supabase
    .from("temperature_readings")
    .upsert(readings, { onConflict: "subject_id,occurred_at" });
  if (readingsError) throw new Error(`Failed to insert temperature_readings: ${readingsError.message}`);

  // Insert latest
  const { error: latestError } = await supabase
    .from("temperature_latest")
    .upsert(latests, { onConflict: "subject_id" });
  if (latestError) throw new Error(`Failed to insert temperature_latest: ${latestError.message}`);

  // Insert events
  const { error: eventsError } = await supabase.from("events").insert(events);
  if (eventsError) throw new Error(`Failed to insert events: ${eventsError.message}`);

  console.log(`  ✓ Inserted ${readings.length} temperature readings`);
  console.log(`  ✓ Inserted ${latests.length} latest readings`);
  console.log(`  ✓ Inserted ${events.length} temperature events`);
}

async function seedTodos(): Promise<void> {
  console.log("\n✅ Seeding todos...");

  const subjects: Subject[] = [];
  const events: Event[] = [];
  const todos: Todo[] = [];

  for (let i = 0; i < SEED_TODOS.length; i++) {
    const todo = SEED_TODOS[i];
    const subjectId = todoSubjectId("todoist", todo.id);
    const createdAt = daysAgo(SEED_TODOS.length - i);
    const completedAt = todo.status === "done" ? hoursAgo((SEED_TODOS.length - i) * 4) : null;

    // Subject
    subjects.push({
      subject: "todo",
      subject_id: subjectId,
      created_at: createdAt,
      display_name: todo.title,
      visibility: "private",
      meta: { source: "todoist" },
    });

    // Todo
    todos.push({
      subject_id: subjectId,
      title: todo.title,
      project: todo.project,
      labels: todo.labels,
      status: todo.status,
      due_at: todo.status === "open" ? daysAgo(-Math.floor(Math.random() * 7)) : null, // Future due dates
      completed_at: completedAt,
      meta: { todoist_id: todo.id },
    });

    // Event: todo.created
    events.push({
      occurred_at: createdAt,
      source: "todoist",
      subject: "todo",
      subject_id: subjectId,
      event_type: "todo.created",
      payload: { title: todo.title, project: todo.project, labels: todo.labels },
    });

    // Event: todo.completed (if done)
    if (todo.status === "done" && completedAt) {
      events.push({
        occurred_at: completedAt,
        source: "todoist",
        subject: "todo",
        subject_id: subjectId,
        event_type: "todo.completed",
        payload: {},
      });
    }
  }

  // Insert subjects
  const { error: subjectsError } = await supabase
    .from("subjects")
    .upsert(subjects, { onConflict: "subject,subject_id" });
  if (subjectsError) throw new Error(`Failed to insert subjects: ${subjectsError.message}`);

  // Insert todos
  const { error: todosError } = await supabase
    .from("todos")
    .upsert(todos, { onConflict: "subject_id" });
  if (todosError) throw new Error(`Failed to insert todos: ${todosError.message}`);

  // Insert events
  const { error: eventsError } = await supabase.from("events").insert(events);
  if (eventsError) throw new Error(`Failed to insert events: ${eventsError.message}`);

  console.log(`  ✓ Inserted ${todos.length} todos`);
  console.log(`  ✓ Inserted ${events.length} todo events`);
}

async function verifyCounts(): Promise<void> {
  console.log("\n📊 Verifying data counts...");

  const tables = [
    "subjects",
    "events", 
    "links",
    "link_content",
    "link_metadata",
    "temperature_readings",
    "temperature_latest",
    "todos",
  ];

  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    
    if (error) {
      console.log(`  ⚠️  ${table}: Error - ${error.message}`);
    } else {
      console.log(`  ✓ ${table}: ${count} rows`);
    }
  }
}

// ============================================================
// Clean Function
// ============================================================

async function cleanDatabase(): Promise<void> {
  console.log("\n🧹 Cleaning database (truncating all tables)...");

  // Order matters due to foreign key constraints
  // Truncate in reverse dependency order
  const tables = [
    "events",           // No dependencies
    "annotations",      // Depends on links
    "link_metadata",    // Depends on links
    "link_content",     // Depends on links
    "publish_state",    // No FK but related to links
    "links",            // Depends on subjects (soft)
    "temperature_latest",
    "temperature_readings",
    "todos",
    "subjects",         // Base table
  ];

  for (const table of tables) {
    const { error } = await supabase.from(table).delete().neq("subject_id", "___never_match___");
    if (error) {
      // Try alternative delete for tables without subject_id
      if (table === "events") {
        const { error: err2 } = await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
        if (err2) console.log(`  ⚠️  ${table}: ${err2.message}`);
        else console.log(`  ✓ Cleaned ${table}`);
      } else {
        console.log(`  ⚠️  ${table}: ${error.message}`);
      }
    } else {
      console.log(`  ✓ Cleaned ${table}`);
    }
  }
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cleanFlag = args.includes("--clean");
  const cleanOnlyFlag = args.includes("--clean-only");

  console.log("🌱 Starting database operations...");
  console.log(`   Timestamp: ${NOW.toISOString()}`);
  
  if (cleanOnlyFlag) {
    console.log("   Mode: CLEAN ONLY (will truncate all tables)");
  } else if (cleanFlag) {
    console.log("   Mode: CLEAN + SEED (will truncate all tables, then seed)");
  } else {
    console.log("   Mode: SEED (upsert data)");
  }

  try {
    if (cleanFlag || cleanOnlyFlag) {
      await cleanDatabase();
    }

    if (!cleanOnlyFlag) {
      await seedLinks();
      await seedTemperature();
      await seedTodos();
    }
    
    await verifyCounts();

    if (cleanOnlyFlag) {
      console.log("\n✨ Clean completed successfully!");
    } else {
      console.log("\n✨ Seed completed successfully!");
    }
  } catch (error) {
    console.error("\n❌ Operation failed:", error);
    process.exit(1);
  }
}

main();
